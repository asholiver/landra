import { randomInt } from "node:crypto";
import pg from "pg";

/**
 * Integration-test database isolation (owner-approved mechanism, WORK-001).
 *
 * Tests run only against the disposable `postgres-test` Compose server (127.0.0.1:5434, tmpfs,
 * started with `-c app.disposable_test_server=on`). Each run creates its own database
 * `it_<12 random chars>`, migrates it, and removes only that database afterwards. The name is
 * generated in this process and held in memory: it is never read from env, arguments or files.
 * Every safeguard is re-checked immediately before the cleanup statement.
 */

export const DISPOSABLE_TEST_PORT = "5434";
export const MARKER_SETTING = "app.disposable_test_server";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_]+$/;
const MAINTENANCE_DATABASE = "postgres";
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const RUN_DATABASE_NAME_PATTERN = /^it_[a-z0-9]{12}$/;
const NAME_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

type Environment = Record<string, string | undefined>;

export class UnsafeTestTargetError extends Error {
  constructor(reason: string) {
    super(`Refusing to run integration tests: ${reason}`);
    this.name = "UnsafeTestTargetError";
  }
}

/** The explicit maintenance connection to the disposable server. No fallback, ever. */
export function testDatabaseUrl(env: Environment = process.env): string {
  const url = env.TEST_DATABASE_URL?.trim();
  if (!url) {
    throw new UnsafeTestTargetError(
      "TEST_DATABASE_URL is not set. Set it to the disposable test server, for example " +
        "postgresql://app:app@127.0.0.1:5434/postgres (see .env.example).",
    );
  }
  return url;
}

export type TargetParts = {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  search: string;
  hash: string;
};

export function describeTarget(connectionString: string): TargetParts {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new UnsafeTestTargetError("TEST_DATABASE_URL is not a valid URL.");
  }
  return {
    // `new URL` keeps the brackets on IPv6 literals; the checks and pg need the bare address.
    host: url.hostname.replace(/^\[(.*)\]$/, "$1"),
    port: url.port,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    search: url.search,
    hash: url.hash,
  };
}

function sameTarget(a: string, b: string): boolean {
  try {
    const left = describeTarget(a);
    const right = describeTarget(b);
    const normaliseHost = (host: string) => (host === "localhost" ? "127.0.0.1" : host);
    return (
      normaliseHost(left.host) === normaliseHost(right.host) &&
      (left.port || "5432") === (right.port || "5432") &&
      left.user === right.user &&
      left.database === right.database
    );
  } catch {
    return false;
  }
}

/** Connection settings handed to pg. Always explicit parts, never a connection string. */
export type VerifiedConnection = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /**
   * Fixed and harmless. pg falls back to the ambient PGOPTIONS only when `options` is falsy
   * (checked in pg 8.23.1 connection-parameters.js), so this blocks that fallback.
   */
  options: string;
};

const FIXED_STARTUP_OPTIONS = "-c application_name=landra_integration_tests";

/**
 * Pure checks on the target URL and environment. Throws UnsafeTestTargetError on any doubt and
 * returns the explicit connection settings to use.
 *
 * Trust assumption for the marker: `SHOW app.disposable_test_server` proves the server was
 * started with that setting only if nothing else can set it for this session. A URL query
 * (`?options=-c app.disposable_test_server=on`, `?host=...`) or ambient PGOPTIONS could, so
 * queries and fragments are rejected, PGOPTIONS must be unset, and connections use explicit
 * parts with a fixed `options` value. A role- or database-level setting on a server someone
 * else controls would also satisfy the check, which is why the host and port must be the
 * local Compose service as well.
 */
export function assertDisposableTarget(
  connectionString: string,
  env: Environment,
): VerifiedConnection {
  const target = describeTarget(connectionString);
  // The raw check also catches a bare trailing "?" or "#", which URL parsing reports as empty.
  if (target.search !== "" || target.hash !== "" || /[?#]/.test(connectionString)) {
    throw new UnsafeTestTargetError(
      "TEST_DATABASE_URL must not contain a query string or fragment.",
    );
  }
  if (!LOOPBACK_HOSTS.has(target.host)) {
    throw new UnsafeTestTargetError(`host "${target.host}" is not a loopback address.`);
  }
  if (/neon/i.test(target.host)) {
    throw new UnsafeTestTargetError("the host looks like a Neon host.");
  }
  if (target.port !== DISPOSABLE_TEST_PORT) {
    throw new UnsafeTestTargetError(
      `port must be exactly ${DISPOSABLE_TEST_PORT} (the postgres-test service).`,
    );
  }
  // The decoded user and database go into the startup packet. A %00 inside them would inject
  // extra startup parameters (and so spoof the marker), so only plain identifiers are accepted
  // and the database is pinned to the maintenance database this mechanism uses.
  if (!IDENTIFIER_PATTERN.test(target.user)) {
    throw new UnsafeTestTargetError("the user must be a plain identifier ([A-Za-z0-9_]+).");
  }
  if (target.database !== MAINTENANCE_DATABASE) {
    throw new UnsafeTestTargetError(`the database must be exactly "${MAINTENANCE_DATABASE}".`);
  }
  if (CONTROL_CHARACTERS.test(target.password)) {
    throw new UnsafeTestTargetError("the password must not contain control characters.");
  }
  if (env.PGOPTIONS) {
    throw new UnsafeTestTargetError("PGOPTIONS is set, which could spoof the server marker.");
  }
  for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
    const applicationUrl = env[name];
    if (applicationUrl && sameTarget(connectionString, applicationUrl)) {
      throw new UnsafeTestTargetError(`the target is the same as ${name}.`);
    }
  }
  if (env.NODE_ENV === "production") {
    throw new UnsafeTestTargetError("NODE_ENV is production.");
  }
  if (env.VERCEL) {
    throw new UnsafeTestTargetError("VERCEL is set.");
  }
  return {
    host: target.host,
    port: Number(target.port),
    user: target.user,
    password: target.password,
    database: target.database,
    options: FIXED_STARTUP_OPTIONS,
  };
}

export type QueryClient = {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
};

/** Reads the server marker. The only statement issued before the target is trusted. */
export async function assertDisposableServer(client: QueryClient): Promise<void> {
  let value: unknown;
  try {
    const result = await client.query(`SHOW ${MARKER_SETTING}`);
    value = Object.values(result.rows[0] ?? {})[0];
  } catch {
    throw new UnsafeTestTargetError(
      `the server does not define ${MARKER_SETTING}, so it is not the disposable test server.`,
    );
  }
  if (value !== "on") {
    throw new UnsafeTestTargetError(`${MARKER_SETTING} is not "on" on this server.`);
  }
}

export function generateRunDatabaseName(): string {
  let suffix = "";
  for (let index = 0; index < 12; index += 1) {
    suffix += NAME_ALPHABET[randomInt(NAME_ALPHABET.length)];
  }
  return `it_${suffix}`;
}

export function isValidRunDatabaseName(name: string): boolean {
  return RUN_DATABASE_NAME_PATTERN.test(name);
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export type Connect = (
  connection: VerifiedConnection,
) => Promise<QueryClient & { end(): Promise<void> }>;

const connectWithPg: Connect = async (connection) => {
  // Explicit parts only: a connection string could carry host/port/options overrides.
  const client = new pg.Client({ ...connection, connectionTimeoutMillis: 5000 });
  await client.connect();
  return client;
};

// The only place the run database name lives.
let runDatabaseName: string | undefined;

/** Clears the remembered name (makes cleanup impossible). Unit tests only. */
export function forgetRunDatabaseForTests(): void {
  runDatabaseName = undefined;
}

/** URL for the run database, built from verified parts: no query string. */
export function databaseUrlFor(connection: VerifiedConnection, databaseName: string): string {
  const credentials = `${encodeURIComponent(connection.user)}:${encodeURIComponent(connection.password)}`;
  const host = connection.host.includes(":") ? `[${connection.host}]` : connection.host;
  return `postgresql://${credentials}@${host}:${connection.port}/${databaseName}`;
}

async function withVerifiedServer<T>(
  env: Environment,
  connect: Connect,
  action: (client: QueryClient, connection: VerifiedConnection) => Promise<T>,
): Promise<T> {
  const connection = assertDisposableTarget(testDatabaseUrl(env), env);
  const client = await connect(connection);
  try {
    await assertDisposableServer(client);
    return await action(client, connection);
  } finally {
    await client.end();
  }
}

/** All safeguards, then CREATE of a freshly generated database. Returns its connection URL. */
export async function createRunDatabase(
  env: Environment = process.env,
  connect: Connect = connectWithPg,
): Promise<string> {
  if (runDatabaseName !== undefined) {
    throw new UnsafeTestTargetError("a run database already exists in this process.");
  }
  return withVerifiedServer(env, connect, async (client, connection) => {
    const name = generateRunDatabaseName();
    if (!isValidRunDatabaseName(name)) throw new UnsafeTestTargetError("bad generated name.");
    await client.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
    runDatabaseName = name;
    return databaseUrlFor(connection, name);
  });
}

/**
 * Removes this process's run database. Takes no name: it can only ever act on the name stored
 * by createRunDatabase. All safeguards are re-run immediately before the statement.
 */
export async function dropRunDatabase(
  env: Environment = process.env,
  connect: Connect = connectWithPg,
): Promise<void> {
  const name = runDatabaseName;
  if (name === undefined) {
    throw new UnsafeTestTargetError("no run database was created by this process.");
  }
  if (!isValidRunDatabaseName(name)) {
    throw new UnsafeTestTargetError("the stored run database name is invalid.");
  }
  await withVerifiedServer(env, connect, async (client) => {
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)} WITH (FORCE)`);
  });
  runDatabaseName = undefined;
}
