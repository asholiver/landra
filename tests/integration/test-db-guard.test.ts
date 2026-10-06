import { describe, expect, it } from "vitest";
import {
  createRunDatabase,
  forgetRunDatabaseForTests,
  UnsafeTestTargetError,
  type VerifiedConnection,
} from "../support/database";

// The safeguards run in the real environment here: a URL that tries to smuggle startup options
// (and so spoof the disposable-server marker) is refused before any connection is attempted.
describe("test database safeguards (HIGH-2)", () => {
  it("refuses a TEST_DATABASE_URL carrying options= before connecting", async () => {
    const base = process.env.TEST_DATABASE_URL;
    expect(base).toBeTruthy();
    const spoofed = `${base}?options=${encodeURIComponent("-c app.disposable_test_server=on")}`;
    const connections: VerifiedConnection[] = [];
    await expect(
      createRunDatabase({ TEST_DATABASE_URL: spoofed }, async (connection) => {
        connections.push(connection);
        throw new Error("must not connect");
      }),
    ).rejects.toThrow(UnsafeTestTargetError);
    expect(connections).toEqual([]);
    forgetRunDatabaseForTests();
  });
});
