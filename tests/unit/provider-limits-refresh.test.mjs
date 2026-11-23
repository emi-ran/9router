import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js", import.meta.url), "utf8");
const callback = source.match(/const refreshAll = useCallback\((async \(force = false\) => \{[\s\S]*?\n  \}), \[refreshingAll,/);
assert.ok(callback, "refreshAll callback found");

async function runRefresh({ force = false, tick = 0 } = {}) {
  const connections = [{ id: "claude-id", provider: "claude" }, { id: "codex-id", provider: "codex" }];
  let loading;
  const calls = [];
  const context = {
    refreshingAll: false, setRefreshingAll() {}, setCountdown() {},
    tickCountRef: { current: tick }, CLAUDE_REFRESH_INTERVAL_MS: 600000, REFRESH_INTERVAL_MS: 60000,
    fetchConnections: async () => connections, page: 1,
    setLoading: (value) => { loading = typeof value === "function" ? value(loading ?? {}) : value; },
    buildLoadingState: (items) => Object.fromEntries(items.map(({ id }) => [id, true])),
    setErrors() {}, setQuotaData() {}, filterQuotaStateByConnections() {},
    fetchQuota: async (...args) => { calls.push(args); loading[args[0]] = false; },
    setLastUpdated() {}, console, Date,
  };
  await vm.runInNewContext(`(${callback[1]})`, context)(force);
  return { loading, calls };
}

test("automatic refresh skips Claude without leaving it loading", async () => {
  const { loading, calls } = await runRefresh();
  assert.notEqual(loading["claude-id"], true);
  assert.equal(loading["codex-id"], false);
  assert.deepEqual(calls.map((call) => call[0]), ["codex-id"]);
});

test("manual refresh forces Claude quota request", async () => {
  const { loading, calls } = await runRefresh({ force: true });
  assert.equal(loading["claude-id"], false);
  assert.equal(calls.find((call) => call[0] === "claude-id")[2]?.force, true);
  assert.ok(calls.some((call) => call[0] === "codex-id"));
});

test("tenth automatic refresh includes Claude without force", async () => {
  const { loading, calls } = await runRefresh({ tick: 9 });
  assert.equal(loading["claude-id"], false);
  assert.equal(calls.find((call) => call[0] === "claude-id")[2]?.force ?? false, false);
  assert.equal(calls.length, 2);
});
