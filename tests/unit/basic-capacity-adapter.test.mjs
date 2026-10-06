import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getCapacityAdapterConfig, getCapacityAdapterModels, getActiveAdapterStrategy,
  augmentModelsWithCapacityAdapter, stripHistoryForContext, withCapacityAdapterStripping,
} from "../../open-sse/services/capacityAdapter.js";

test("legacy pools filter unsupported providers and disabled entries", () => {
  const settings = { capacityAdapter: { vision: [
    { model: "kiro/claude-sonnet-4.5" },
    { model: "openai-compatible-old/gpt-5" },
    { model: "cx/gpt-5.6-sol", enabled: false },
    { model: "ag/gemini-3.8-flash" },
    { model: "oc/union-alpha" },
  ] } };
  assert.deepEqual(getCapacityAdapterModels(settings), ["ag/gemini-3.8-flash", "oc/union-alpha"]);
  assert.deepEqual(getCapacityAdapterConfig("vision", { capacityAdapter: { vision: { models: [null, 42, "cx/", "unqualified", "opencode-go/union-alpha"] } } }).models, ["oc/mimo-v2.6-flash-free"]);
});

test("retained vision pool routes without unsupported fallback candidates", () => {
  const settings = { capacityAdapter: { vision: { enabled: true, roundRobin: true, models: ["openai/gpt-5", "cx/gpt-5.6-sol"] } } };
  assert.deepEqual(augmentModelsWithCapacityAdapter(["oc/text-only-unknown", "kiro/claude-sonnet-4.5"], new Set(["vision"]), settings), ["cx/gpt-5.6-sol"]);
  assert.equal(getActiveAdapterStrategy(new Set(["vision"]), settings), "round-robin");
  assert.deepEqual(augmentModelsWithCapacityAdapter(["codex/gpt-5.6-sol", "openai/gpt-5"], new Set(["vision"]), settings), ["codex/gpt-5.6-sol"]);
  assert.deepEqual(augmentModelsWithCapacityAdapter(["oc/union-alpha", "custom-provider/model"], new Set(), settings), ["oc/union-alpha"]);
});

test("unsupported vision returns explicit error before any network or callback", () => {
  assert.throws(() => augmentModelsWithCapacityAdapter(["oc/text-only-unknown"], new Set(["vision"]), {}), { code: "unsupported_capability" });
  assert.throws(() => augmentModelsWithCapacityAdapter(["openai/gpt-5"], new Set(["vision"]), { capacityAdapter: { vision: { enabled: false, models: ["cx/gpt-5.6-sol"] } } }), { code: "unsupported_capability" });
});

test("complete history, images and stream identity survive adapter callback", async () => {
  for (const key of ["messages", "input", "contents"]) {
    const history = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "history".repeat(1000) }));
    history[0] = { role: "system", content: "Instructions" };
    history[20] = { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,mock" } }] };
    const body = { [key]: history, stream: true };
    const snapshot = structuredClone(body);
    assert.strictEqual(stripHistoryForContext(body, 1), body);
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("data: mock\n\n")); controller.close(); } }));
    let calls = 0;
    const callback = async (received, model, extra) => {
      calls++;
      assert.strictEqual(received, body);
      assert.equal(model, "cx/gpt-5.6-sol");
      assert.equal(extra, "mock-context");
      return response;
    };
    const wrapped = withCapacityAdapterStripping(callback, ["cx/gpt-5.6-sol"]);
    assert.strictEqual(await wrapped(body, "cx/gpt-5.6-sol", "mock-context"), response);
    assert.deepEqual(body, snapshot);
    assert.equal(calls, 1);
  }
});
