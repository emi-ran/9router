import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isolatedGlobals = [
  "_dbAdapter", "_pendingRequests", "_lastErrorProvider", "_statsEmitter",
  "_pendingTimers", "_recentRing", "_connectionMapCache", "_statsEmitTimers",
];
const shutdownEvents = ["beforeExit", "SIGINT", "SIGTERM"];
let directory;
let previousDataDir;
let previousGlobals;
let previousListeners;
let fixtureAdapterState;
let db;
beforeEach(async () => {
  previousDataDir = process.env.DATA_DIR;
  // Detach pre-existing state without closing it: it may belong to another DB.
  previousGlobals = new Map(isolatedGlobals.map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  previousListeners = new Map(shutdownEvents.map((event) => [event, process.listeners(event)]));
  fixtureAdapterState = { instance: null, initPromise: null, logged: false };
  const scratch = process.env.TMPDIR || path.join(os.homedir(), ".hermes", "cache", "scratch");
  fs.mkdirSync(scratch, { recursive: true });
  directory = fs.mkdtempSync(path.join(scratch, "9router-selected-usage-"));
  process.env.DATA_DIR = directory;
  for (const key of isolatedGlobals) delete global[key];
  global._dbAdapter = fixtureAdapterState;
  vi.resetModules();
  // Check the resolved path BEFORE importing/initializing the driver. Never open
  // a default/live DB, even if DATA_DIR handling changes or modules are cached.
  const { DATA_FILE } = await import("@/lib/db/paths.js");
  expect(DATA_FILE).toBe(path.join(directory, "db", "data.sqlite"));
  db = await import("@/lib/db/index.js");
  await db.initDb();
  expect(await db.getUsageHistory()).toEqual([]);
  expect(global._recentRing.items).toEqual([]);
});
afterEach(async () => {
  try {
    // Await initialization if setup failed midway; only close OUR adapter.
    const adapter = fixtureAdapterState.instance || await fixtureAdapterState.initPromise;
    for (const timer of Object.values(global._pendingTimers || {})) clearTimeout(timer);
    for (const timer of Object.values(global._statsEmitTimers || {})) clearTimeout(timer);
    global._statsEmitter?.removeAllListeners();
    await adapter?.close();
  } finally {
    // sql.js registers shutdown flush listeners that close() does not remove.
    for (const event of shutdownEvents) {
      for (const listener of process.listeners(event)) {
        if (!previousListeners.get(event).includes(listener)) process.removeListener(event, listener);
      }
    }
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    vi.resetModules();
    db = undefined;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("selected upstream usage fixes", () => {
  it.each(["24h", "today"])("counts input/output_tokens in %s live history", async (period) => {
    await db.saveRequestUsage({
      provider: "antigravity", model: "gemini-4-argon-high", connectionId: "test-only",
      tokens: { input_tokens: 37, output_tokens: 11 }, status: "ok", endpoint: "/v1/chat/completions",
    });
    const stats = await db.getUsageStats(period);
    expect(stats.totalPromptTokens).toBe(37);
    expect(stats.totalCompletionTokens).toBe(11);
  });

  it.each(["24h", "today", "all"])("serializes opaque distinct API-key buckets for %s", async (period) => {
    // Identical display masks must never merge distinct full-key counters.
    const keys = ["fixture-secret-first-middle-TAIL", "fixture-secret-other-middle-TAIL"];
    const model = "gpt-5.6-terra";
    const timestamp = new Date().toISOString();
    for (const [index, apiKey] of keys.entries()) {
      await db.saveRequestUsage({
        provider: "codex", model, apiKey, timestamp,
        tokens: { input_tokens: 7 + index, output_tokens: 2 }, status: "ok",
      });
    }
    const stats = await db.getUsageStats(period);
    const serialized = JSON.parse(JSON.stringify(stats));
    const bucketIds = Object.keys(serialized.byApiKey);
    expect(bucketIds).toHaveLength(2);
    for (const [index, key] of keys.entries()) {
      const id = createHash("sha256").update(`${key}|${model}|codex`).digest("hex");
      expect(bucketIds).toContain(id);
      expect(serialized.byApiKey[id]).toMatchObject({
        requests: 1, promptTokens: 7 + index, completionTokens: 2,
        apiKeyMasked: "fixture-***TAIL", lastUsed: timestamp,
      });
      expect(JSON.stringify(serialized)).not.toContain(key);
      expect(bucketIds.every((bucket) => !bucket.includes("fixture-") && !bucket.includes("TAIL"))).toBe(true);
    }
    expect(Object.keys((await db.getUsageStats(period)).byApiKey)).toEqual(bucketIds);
    // Raw-key aggregation stays internal/on disk, so existing daily data and
    // precise lastUsed overlays remain compatible.
    const { getAdapter } = await import("@/lib/db/driver.js");
    const day = JSON.parse((await getAdapter()).all("SELECT data FROM usageDaily")[0].data);
    expect(Object.keys(day.byApiKey).sort()).toEqual(keys.map((key) => `${key}|${model}|codex`).sort());
  });

  it("trims display masks while keeping keys with a common prefix distinct", async () => {
    const keys = ["fixture-common-prefix-0001", "fixture-common-prefix-0002"];
    for (const key of keys) {
      await db.saveRequestUsage({
        provider: "codex", model: "gpt-5.6-terra", connectionId: "test-only",
        apiKey: ` ${key} `, tokens: { input_tokens: 7, output_tokens: 2 }, status: "ok",
      });
    }
    const stats = await db.getUsageStats("24h");
    const entries = Object.values(stats.byApiKey);
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.apiKeyMasked).sort()).toEqual(["fixture-***0001", "fixture-***0002"]);
    expect(entries.every((entry) => entry.keyName === entry.apiKeyMasked)).toBe(true);
  });
});
