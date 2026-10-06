import { afterEach, describe, expect, it } from "vitest";
import {
  assertDisposableServer,
  assertDisposableTarget,
  createRunDatabase,
  dropRunDatabase,
  forgetRunDatabaseForTests,
  generateRunDatabaseName,
  isValidRunDatabaseName,
  type QueryClient,
  testDatabaseUrl,
  UnsafeTestTargetError,
  type VerifiedConnection,
} from "../support/database";

const GOOD_URL = "postgresql://app:app@127.0.0.1:5434/postgres";

function fakeServer(markerValue: string | Error) {
  const statements: string[] = [];
  const configs: VerifiedConnection[] = [];
  let ended = false;
  const client: QueryClient & { end(): Promise<void> } = {
    async query(sql) {
      statements.push(sql);
      if (sql.startsWith("SHOW ")) {
        if (markerValue instanceof Error) throw markerValue;
        return { rows: [{ "app.disposable_test_server": markerValue }] };
      }
      return { rows: [] };
    },
    async end() {
      ended = true;
    },
  };
  return {
    statements,
    configs,
    connect: async (config?: VerifiedConnection) => {
      if (config) configs.push(config);
      return client;
    },
    wasEnded: () => ended,
  };
}

afterEach(() => forgetRunDatabaseForTests());

describe("testDatabaseUrl", () => {
  it("throws a clear error when TEST_DATABASE_URL is unset or blank, with no fallback", () => {
    expect(() => testDatabaseUrl({})).toThrow(/TEST_DATABASE_URL is not set/);
    expect(() => testDatabaseUrl({ TEST_DATABASE_URL: "  ", DATABASE_URL: GOOD_URL })).toThrow(
      UnsafeTestTargetError,
    );
  });

  it("returns the explicit URL", () => {
    expect(testDatabaseUrl({ TEST_DATABASE_URL: GOOD_URL })).toBe(GOOD_URL);
  });
});

describe("assertDisposableTarget", () => {
  it.each([
    "postgresql://app:app@127.0.0.1:5434/postgres",
    "postgresql://app:app@localhost:5434/postgres",
    "postgresql://app:app@[::1]:5434/postgres",
  ])("accepts %s", (url) => {
    expect(() => assertDisposableTarget(url, {})).not.toThrow();
  });

  it.each([
    ["non-loopback host", "postgresql://app:app@db.example.com:5434/postgres"],
    ["non-loopback IP", "postgresql://app:app@10.0.0.5:5434/postgres"],
    ["host with a loopback prefix", "postgresql://app:app@127.0.0.1.evil.example:5434/postgres"],
    ["Neon host", "postgresql://u:p@ep-cool-123.eu-west-2.aws.neon.tech:5434/db"],
    ["dev server port", "postgresql://app:app@127.0.0.1:5433/postgres"],
    ["default port", "postgresql://app:app@127.0.0.1/postgres"],
    ["other port", "postgresql://app:app@127.0.0.1:5435/postgres"],
    ["not a URL", "not a url"],
  ])("refuses %s", (_label, url) => {
    expect(() => assertDisposableTarget(url, {})).toThrow(UnsafeTestTargetError);
  });

  it("refuses a target equal to DATABASE_URL or DATABASE_URL_UNPOOLED (normalised)", () => {
    expect(() => assertDisposableTarget(GOOD_URL, { DATABASE_URL: GOOD_URL })).toThrow(
      /DATABASE_URL/,
    );
    expect(() =>
      assertDisposableTarget(GOOD_URL, {
        DATABASE_URL_UNPOOLED: "postgresql://app:other@localhost:5434/postgres?sslmode=disable",
      }),
    ).toThrow(/DATABASE_URL_UNPOOLED/);
  });

  it("allows an application URL that points elsewhere", () => {
    expect(() =>
      assertDisposableTarget(GOOD_URL, {
        DATABASE_URL: "postgresql://app:app@localhost:5433/app",
      }),
    ).not.toThrow();
  });

  it("refuses when NODE_ENV is production or VERCEL is set", () => {
    expect(() => assertDisposableTarget(GOOD_URL, { NODE_ENV: "production" })).toThrow(
      /production/,
    );
    expect(() => assertDisposableTarget(GOOD_URL, { VERCEL: "1" })).toThrow(/VERCEL/);
  });
});

describe("assertDisposableServer", () => {
  it("accepts the marker set to on", async () => {
    await expect(assertDisposableServer(await fakeServer("on").connect())).resolves.toBeUndefined();
  });

  it("refuses the marker set to off", async () => {
    await expect(assertDisposableServer(await fakeServer("off").connect())).rejects.toThrow(
      UnsafeTestTargetError,
    );
  });

  it("refuses a server that does not know the setting", async () => {
    const error = new Error('unrecognized configuration parameter "app.disposable_test_server"');
    await expect(assertDisposableServer(await fakeServer(error).connect())).rejects.toThrow(
      /does not define/,
    );
  });

  it("only ever reads the marker", async () => {
    const server = fakeServer("on");
    await assertDisposableServer(await server.connect());
    expect(server.statements).toEqual(["SHOW app.disposable_test_server"]);
  });
});

describe("run database names", () => {
  it("generates names matching it_<12 [a-z0-9]> that differ between calls", () => {
    const names = new Set(Array.from({ length: 50 }, generateRunDatabaseName));
    expect(names.size).toBe(50);
    for (const name of names) expect(name).toMatch(/^it_[a-z0-9]{12}$/);
  });

  it.each([
    "app",
    "postgres",
    "it_",
    "it_ABCDEFGHIJKL",
    "it_abcdefghijk",
    "it_abcdefghijklm",
    'it_abc"; --xyzw',
    "xit_abcdefghijkl",
    "it_abcdefghijkl\n",
  ])("rejects %j", (name) => {
    expect(isValidRunDatabaseName(name)).toBe(false);
  });
});

describe("createRunDatabase and dropRunDatabase", () => {
  const env = { TEST_DATABASE_URL: GOOD_URL };

  it("creates a generated database after reading the marker, and drops exactly that name", async () => {
    const server = fakeServer("on");
    const url = await createRunDatabase(env, server.connect);
    const created = server.statements.find((sql) => sql.startsWith("CREATE"));
    const name = /"(it_[a-z0-9]{12})"/.exec(created ?? "")?.[1];
    expect(name).toBeDefined();
    expect(server.statements[0]).toBe("SHOW app.disposable_test_server");
    expect(new URL(url).pathname).toBe(`/${name}`);
    expect(server.wasEnded()).toBe(true);

    const cleanup = fakeServer("on");
    await dropRunDatabase(env, cleanup.connect);
    expect(cleanup.statements).toEqual([
      "SHOW app.disposable_test_server",
      `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`,
    ]);
  });

  it("refuses to drop when this process created no run database, issuing no SQL", async () => {
    const server = fakeServer("on");
    await expect(dropRunDatabase(env, server.connect)).rejects.toThrow(/no run database/);
    expect(server.statements).toEqual([]);
  });

  it("refuses to create without TEST_DATABASE_URL or against an unsafe target, issuing no SQL", async () => {
    const server = fakeServer("on");
    await expect(createRunDatabase({}, server.connect)).rejects.toThrow(/TEST_DATABASE_URL/);
    await expect(
      createRunDatabase(
        { TEST_DATABASE_URL: "postgresql://app:app@127.0.0.1:5433/app" },
        server.connect,
      ),
    ).rejects.toThrow(UnsafeTestTargetError);
    expect(server.statements).toEqual([]);
  });

  it("refuses to create when the marker is off, issuing only the marker read", async () => {
    const server = fakeServer("off");
    await expect(createRunDatabase(env, server.connect)).rejects.toThrow(UnsafeTestTargetError);
    expect(server.statements).toEqual(["SHOW app.disposable_test_server"]);
  });

  it("re-checks every safeguard before dropping: no drop when env turns unsafe or the marker is off", async () => {
    await createRunDatabase(env, fakeServer("on").connect);

    const production = fakeServer("on");
    await expect(
      dropRunDatabase({ ...env, NODE_ENV: "production" }, production.connect),
    ).rejects.toThrow(/production/);
    expect(production.statements).toEqual([]);

    const offServer = fakeServer("off");
    await expect(dropRunDatabase(env, offServer.connect)).rejects.toThrow(UnsafeTestTargetError);
    expect(offServer.statements).toEqual(["SHOW app.disposable_test_server"]);

    const wrongPort = fakeServer("on");
    await expect(
      dropRunDatabase(
        { TEST_DATABASE_URL: "postgresql://app:app@127.0.0.1:5433/postgres" },
        wrongPort.connect,
      ),
    ).rejects.toThrow(UnsafeTestTargetError);
    expect(wrongPort.statements).toEqual([]);
  });

  it("does not accept a second run database in the same process", async () => {
    await createRunDatabase(env, fakeServer("on").connect);
    await expect(createRunDatabase(env, fakeServer("on").connect)).rejects.toThrow(
      /already exists/,
    );
  });
});

describe("connection spoofing (HIGH-1, HIGH-2)", () => {
  it.each([
    "postgresql://app:app@127.0.0.1:5434/postgres?host=evil.example",
    "postgresql://app:app@127.0.0.1:5434/postgres?port=5432",
    "postgresql://app:app@127.0.0.1:5434/postgres?host=/tmp",
    "postgresql://app:app@127.0.0.1:5434/postgres?options=-c%20app.disposable_test_server%3Don",
    "postgresql://app:app@127.0.0.1:5434/postgres?",
    "postgresql://app:app@127.0.0.1:5434/postgres#frag",
  ])("refuses %s before connecting or issuing any SQL", async (url) => {
    expect(() => assertDisposableTarget(url, {})).toThrow(/query string or fragment/);
    const server = fakeServer("on");
    const connect = async (config: VerifiedConnection) => {
      server.configs.push(config);
      return server.connect();
    };
    await expect(createRunDatabase({ TEST_DATABASE_URL: url }, connect)).rejects.toThrow(
      UnsafeTestTargetError,
    );
    expect(server.configs).toEqual([]);
    expect(server.statements).toEqual([]);
  });

  it("refuses when PGOPTIONS is set, at create and at cleanup, issuing no SQL", async () => {
    expect(() =>
      assertDisposableTarget(GOOD_URL, { PGOPTIONS: "-c app.disposable_test_server=on" }),
    ).toThrow(/PGOPTIONS/);
    const server = fakeServer("on");
    await expect(
      createRunDatabase({ TEST_DATABASE_URL: GOOD_URL, PGOPTIONS: "-c x=y" }, server.connect),
    ).rejects.toThrow(/PGOPTIONS/);

    await createRunDatabase({ TEST_DATABASE_URL: GOOD_URL }, fakeServer("on").connect);
    const cleanup = fakeServer("on");
    await expect(
      dropRunDatabase({ TEST_DATABASE_URL: GOOD_URL, PGOPTIONS: "-c x=y" }, cleanup.connect),
    ).rejects.toThrow(/PGOPTIONS/);
    expect(cleanup.statements).toEqual([]);
    expect(server.statements).toEqual([]);
  });

  it("connects with explicit loopback host, port 5434, a fixed options value and no connection string", async () => {
    const server = fakeServer("on");
    const url = await createRunDatabase({ TEST_DATABASE_URL: GOOD_URL }, server.connect);
    const [config] = server.configs;
    expect(config).toMatchObject({
      host: "127.0.0.1",
      port: 5434,
      user: "app",
      database: "postgres",
    });
    expect(config?.options).toBeTruthy();
    expect(config).not.toHaveProperty("connectionString");
    expect(new URL(url).search).toBe("");
  });

  it("strips IPv6 brackets for the connection host", () => {
    const connection = assertDisposableTarget("postgresql://app:app@[::1]:5434/postgres", {});
    expect(connection.host).toBe("::1");
  });
});

describe("startup-packet injection (NEW-H1)", () => {
  const MARKER = "app.disposable_test_server";
  it.each([
    ["%00 in the database", `postgresql://app:app@127.0.0.1:5434/postgres%00${MARKER}%00on`],
    ["%00 in the user", `postgresql://app%00${MARKER}%00on:app@127.0.0.1:5434/postgres`],
    ["%0a in the database", `postgresql://app:app@127.0.0.1:5434/postgres%0a${MARKER}`],
    ["%0a in the user", `postgresql://app%0aextra:app@127.0.0.1:5434/postgres`],
    ["%00 in the password", "postgresql://app:pass%00word@127.0.0.1:5434/postgres"],
    ["%1f in the password", "postgresql://app:pass%1fword@127.0.0.1:5434/postgres"],
    ["%7f in the password", "postgresql://app:pass%7fword@127.0.0.1:5434/postgres"],
    ["an empty database", "postgresql://app:app@127.0.0.1:5434"],
    ["a non-postgres database", "postgresql://app:app@127.0.0.1:5434/app"],
    ["an empty user", "postgresql://:app@127.0.0.1:5434/postgres"],
    ["a user with punctuation", "postgresql://app-x:app@127.0.0.1:5434/postgres"],
  ])("refuses %s, at create and at cleanup, without ever connecting", async (_label, url) => {
    expect(() => assertDisposableTarget(url, {})).toThrow(UnsafeTestTargetError);

    const server = fakeServer("on");
    const env = { TEST_DATABASE_URL: url };
    await expect(createRunDatabase(env, server.connect)).rejects.toThrow(UnsafeTestTargetError);

    // Cleanup needs a stored run name, which only a successful create produces.
    await createRunDatabase({ TEST_DATABASE_URL: GOOD_URL }, fakeServer("on").connect);
    await expect(dropRunDatabase(env, server.connect)).rejects.toThrow(UnsafeTestTargetError);

    expect(server.configs).toEqual([]);
    expect(server.statements).toEqual([]);
  });

  it("still accepts a plain user and the postgres database", () => {
    expect(() =>
      assertDisposableTarget("postgresql://app_user1:p%40ss@127.0.0.1:5434/postgres", {}),
    ).not.toThrow();
  });
});
