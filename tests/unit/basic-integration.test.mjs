import test from "node:test";
import assert from "node:assert/strict";
import { parseModel, getModelInfoCore } from "../../open-sse/services/model.js";
import { getTargetFormat } from "../../open-sse/services/provider.js";

test("retained chat aliases resolve without generic or media fallback", async () => {
  for (const [alias, id] of [["ag", "antigravity"], ["cx", "codex"], ["oc", "opencode"]]) {
    assert.equal(parseModel(`${alias}/test`).provider, id);
    assert.equal((await getModelInfoCore("legacy", { legacy: `${alias}/test` })).provider, id);
    assert.equal(typeof getTargetFormat(id), "string");
  }
  for (const id of ["openai", "claude", "kiro", "cursor", "openai-compatible-chat-old", "tavily", "huggingface"]) {
    assert.equal(parseModel(`${id}/test`).provider, null);
    assert.equal((await getModelInfoCore("legacy", { legacy: `${id}/test` })).provider, null);
    assert.throws(() => getTargetFormat(id), /Unsupported chat provider/);
  }
  assert.equal((await getModelInfoCore("unknown-model", {})).provider, null);
});
