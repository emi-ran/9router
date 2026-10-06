import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS, PROVIDER_MEDIA, PROVIDER_OAUTH } from "../../open-sse/providers/index.js";
import { handleFetchCore } from "../../open-sse/handlers/fetch/index.js";
import { refreshTokenByProvider } from "../../open-sse/services/tokenRefresh.js";
import { extractCodexAccountInfo } from "../../src/lib/oauth/providerHelpers.js";

test("chat transports and OAuth only include retained providers", () => {
  assert.deepEqual(Object.keys(PROVIDERS).sort(), ["antigravity", "codex", "opencode"]);
  assert.deepEqual(Object.keys(PROVIDER_OAUTH).sort(), ["antigravity", "codex"]);
  for (const entry of REGISTRY) {
    if (entry.transport) assert.ok(["antigravity", "codex", "opencode"].includes(entry.id));
    assert.ok(!(entry.serviceKinds || []).some(k => ["embedding", "tts", "stt", "video", "systemone"].includes(k)));
    for (const key of ["ttsConfig", "sttConfig", "embeddingConfig", "videoConfig", "systemoneConfig"]) assert.equal(entry[key], undefined);
    if (!entry.transport) assert.ok((entry.models || []).every(m => m.kind && (entry.serviceKinds || []).includes(m.kind)));
  }
  assert.ok(PROVIDER_MODELS.cx.some(m => m.kind === "image"));
  assert.ok(PROVIDER_MODELS.ag.some(m => m.kind === "image"));
  assert.ok(PROVIDER_MODELS.openai.some(m => m.kind === "image"));
  assert.ok(PROVIDER_MEDIA.openai.searchViaChat);
  assert.ok(PROVIDER_MEDIA.gemini.searchViaChat);
  assert.ok(PROVIDER_MEDIA["brave-search"].searchConfig);
  assert.deepEqual(REGISTRY.filter(r => r.fetchConfig).map(r => r.id).sort(), ["tavily", "tinyfish"]);
  assert.ok(PROVIDER_MODELS.oc.length > 0);
});

test("unsupported old fetch providers and refresh credentials never call network", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Unexpected network call"); };
  try {
    for (const provider of ["firecrawl", "jina-reader", "exa", "ollama", "unknown"]) {
      const result = await handleFetchCore({ url: "https://example.com", provider });
      assert.equal(result.status, 400);
    }
    for (const provider of ["kiro", "claude", "openai-compatible-old", "xai"]) assert.equal(await refreshTokenByProvider(provider, { refreshToken: "mock" }), null);
  } finally { globalThis.fetch = oldFetch; }
});

test("TinyFish and Tavily dispatch normalize mocked upstream responses", async () => {
  const oldFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ results: [{ text: "tinyfish content", raw_content: "tavily content", title: "Example" }] });
  };
  try {
    for (const provider of ["tinyfish", "tavily"]) {
      const result = await handleFetchCore({ url: "https://example.com", provider, providerConfig: PROVIDER_MEDIA[provider].fetchConfig, credentials: { apiKey: "mock-key" }, maxCharacters: 5 });
      assert.equal(result.success, true);
      assert.equal(result.data.content.text.length, 5);
      assert.equal(result.data.provider, provider);
    }
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, PROVIDER_MEDIA.tinyfish.fetchConfig.baseUrl);
    assert.equal(calls[1].url, PROVIDER_MEDIA.tavily.fetchConfig.baseUrl);
  } finally { globalThis.fetch = oldFetch; }
});

test("Codex JWT account metadata survives OAuth cleanup", () => {
  const payload = { email: "mock@example.com", "https://api.openai.com/auth": { chatgpt_account_id: "mock-account", chatgpt_plan_type: "plus" } };
  const token = `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
  assert.equal(extractCodexAccountInfo(token).chatgptAccountId, "mock-account");
  assert.deepEqual(extractCodexAccountInfo("invalid"), {});
});

test("removed modality endpoints absent, executor cannot fall back to compatible chat", () => {
  const routeFiles = dir => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? routeFiles(new URL(`${entry.name}/`, dir)) : entry.name === "route.js" ? [entry.name] : []) : [];
  for (const dir of ["embeddings", "audio", "videos", "systemone"]) assert.deepEqual(routeFiles(new URL(`../../src/app/api/v1/${dir}/`, import.meta.url)), []);
  const executor = readFileSync(new URL("../../open-sse/executors/index.js", import.meta.url), "utf8");
  assert.match(executor, /Unsupported chat provider/);
  assert.doesNotMatch(executor, /DefaultExecutor|defaultCache/);
});
