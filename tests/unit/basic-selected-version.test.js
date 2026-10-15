import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("https", () => ({ default: { get: vi.fn(() => { throw new Error("Unexpected network call"); }) } }));
const previousCache = global.__npmVersionCache;
afterEach(() => {
  global.__npmVersionCache = previousCache;
  vi.resetModules();
});

describe("selected release version", () => {
  it("keeps root, CLI and root lock metadata at 0.5.104", () => {
    const root = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url)));
    const cli = JSON.parse(fs.readFileSync(new URL("../../cli/package.json", import.meta.url)));
    const lock = JSON.parse(fs.readFileSync(new URL("../../package-lock.json", import.meta.url)));
    expect([root.version, cli.version, lock.version, lock.packages[""].version]).toEqual(Array(4).fill("0.5.104"));
  });

  it("clears the equal-version notification without disabling newer-release checks", async () => {
    global.__npmVersionCache = { value: "0.5.104", fetchedAt: Date.now() };
    vi.resetModules();
    const { GET } = await import("../../src/app/api/version/route.js");
    expect(await (await GET()).json()).toMatchObject({ currentVersion: "0.5.104", hasUpdate: false });
    global.__npmVersionCache.value = "0.5.105";
    expect(await (await GET()).json()).toMatchObject({ currentVersion: "0.5.104", hasUpdate: true });
  });
});
