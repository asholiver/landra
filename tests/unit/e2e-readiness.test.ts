import net from "node:net";
import { describe, expect, it } from "vitest";
import { assertPortFree, isOwnServerReady } from "../e2e/support/readiness";

describe("isOwnServerReady (E2E accepts only its own server)", () => {
  it("accepts the run's own version", () => {
    expect(isOwnServerReady({ status: "ok", version: "e2e-abc" }, "e2e-abc")).toBe(true);
  });

  it.each([
    [{ status: "ok", version: "dev" }],
    [{ status: "ok", version: "e2e-other" }],
    [{ status: "ok" }],
    [{ status: "error", version: "e2e-abc" }],
    [null],
    ["ok"],
    [undefined],
  ])("rejects %j", (body) => {
    expect(isOwnServerReady(body, "e2e-abc")).toBe(false);
  });
});

describe("assertPortFree", () => {
  it("fails with a clear message when something is listening", async () => {
    const server = net.createServer().listen(0, "localhost");
    await new Promise((done) => server.once("listening", done));
    const { port } = server.address() as net.AddressInfo;
    try {
      await expect(assertPortFree(port)).rejects.toThrow(`Port ${port} is already in use`);
    } finally {
      server.close();
    }
  });

  it("passes when nothing is listening", async () => {
    const probe = net.createServer().listen(0, "localhost");
    await new Promise((done) => probe.once("listening", done));
    const { port } = probe.address() as net.AddressInfo;
    await new Promise((done) => probe.close(done));
    await expect(assertPortFree(port)).resolves.toBeUndefined();
  });
});
