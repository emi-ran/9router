import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js", import.meta.url), "utf8");
const match = source.match(/const fetchQuota = useCallback\((async \(connectionId, provider, \{ force = false \} = \{\}\) => \{[\s\S]*?\n  \}), \[\]\)/);
assert.ok(match);

test("forced Claude quota fetch sends force query parameter and clears loading", async () => {
  let url;
  let loading = {};
  const context = {
    setLoading: (fn) => { loading = fn(loading); }, setErrors() {}, setQuotaData() {}, setQuotaCache() {},
    fetch: async (value) => { url = value; return { ok: true, json: async () => ({}) }; },
    parseQuotaData: () => [], console: { log() {}, error() {} },
  };
  await vm.runInNewContext(`(${match[1]})`, context)("claude-id", "claude", { force: true });
  assert.equal(url, "/api/usage/claude-id?force=1");
  assert.equal(loading["claude-id"], false);
});
