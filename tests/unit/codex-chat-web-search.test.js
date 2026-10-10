import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => new Proxy({}, { get: (_, key) => key === "then" ? undefined : vi.fn() }),
}));

import "../../open-sse/index.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import * as proxyFetch from "../../open-sse/utils/proxyFetch.js";
import * as executors from "../../open-sse/executors/index.js";
import { mergeWithDefaults } from "../../src/lib/db/repos/settingsRepo.js";

// Offline upstream fixture: hosted search is server-side, not a client function call.
function upstreamSSE() {
  const search = { type: "web_search_call", id: "ws_fixture", status: "completed", action: { type: "search", query: "fixture query" } };
  const message = { type: "message", id: "msg_fixture", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Fixture answer", annotations: [{ type: "url_citation", url: "https://example.com", title: "Fixture", start_index: 0, end_index: 7 }] }] };
  const events = [
    { type: "response.created", response: { id: "resp_fixture", model: "gpt-5.5", status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item: { ...search, status: "in_progress" } },
    { type: "response.web_search_call.searching", output_index: 0, item_id: search.id },
    { type: "response.output_item.done", output_index: 0, item: search },
    { type: "response.output_item.added", output_index: 1, item: { ...message, content: [] } },
    { type: "response.output_text.delta", output_index: 1, content_index: 0, delta: "Fixture answer" },
    { type: "response.output_item.done", output_index: 1, item: message },
    { type: "response.completed", response: { id: "resp_fixture", model: "gpt-5.5", status: "completed", output: [search, message], usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 } } },
  ];
  return events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

afterEach(() => vi.restoreAllMocks());

async function run({ endpoint = "/v1/chat/completions", stream = false, provider = "codex", model = "gpt-5.5", extra = {}, ...options } = {}) {
  const fetch = vi.spyOn(proxyFetch, "proxyAwareFetch").mockImplementation(async () => new Response(upstreamSSE(), { headers: { "content-type": "text/event-stream" } }));
  const responses = endpoint.endsWith("/responses");
  const body = { model, stream, ...(responses ? { input: "hello" } : { messages: [{ role: "user", content: "hello" }] }), ...extra };
  const result = await handleChatCore({
    body, modelInfo: { provider, model }, credentials: { accessToken: "fixture", apiKey: "fixture", connectionId: "fixture" },
    connectionId: "fixture", clientRawRequest: { endpoint, headers: {}, body },
    sourceFormatOverride: responses ? "openai-responses" : "openai", ...options,
  });
  expect(result.success).toBe(true);
  const text = await result.response.text();
  return { body: JSON.parse(fetch.mock.calls.at(-1)[1].body), headers: fetch.mock.calls.at(-1)[1].headers, text };
}

describe("Codex Chat Completions hosted search", () => {
  it("defaults stored settings to enabled without overriding an explicit false", () => {
    expect(mergeWithDefaults({}).codexAutoWebSearch).toBe(true);
    expect(mergeWithDefaults({ codexAutoWebSearch: false }).codexAutoWebSearch).toBe(false);
  });
  it("does not mark other providers for automatic Codex search", async () => {
    const execute = vi.fn(async () => { throw new Error("fixture stop before network"); });
    vi.spyOn(executors, "getExecutor").mockReturnValue({ execute, noAuth: true });
    await handleChatCore({ body: { model: "glm-5", messages: [{ role: "user", content: "hello" }] }, modelInfo: { provider: "opencode", model: "glm-5" }, credentials: {}, clientRawRequest: { endpoint: "/v1/chat/completions" } });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][0].body._autoCodexWebSearch).toBeUndefined();
  });

  it("does not enable automatic search on unrelated endpoints", async () => {
    const { body } = await run({ endpoint: "/v1/messages" });
    expect(body.tools || []).toEqual([]);
  });

  it("keeps Lite transport when automatic search is disabled", async () => {
    const { body, headers } = await run({ model: "gpt-6-sol", codexAutoWebSearch: false });
    expect(body.tools).toBeNull();
    expect(body.input[0]).toMatchObject({ type: "additional_tools", tools: [] });
    expect(headers["x-openai-internal-codex-responses-lite"]).toBe("true");
  });
  it("allows the settings toggle to disable automatic insertion", async () => {
    const { body } = await run({ codexAutoWebSearch: false });
    expect(body.tools || []).toEqual([]);
  });
  it("does not auto-insert hosted search when tool_choice is none", async () => {
    const { body } = await run({ extra: { tools: [], tool_choice: "none" } });
    expect(body.tools).toEqual([]);
    expect(body.tool_choice).toBe("none");
  });
  it.each(["/v1/chat/completions", "/api/v1/chat/completions"])("translates hosted search SSE at %s without client tool calls", async (endpoint) => {
    const { body, text } = await run({ endpoint, stream: true });
    expect(body.tools).toEqual([{ type: "web_search" }]);
    const chunks = text.split("\n").filter(line => line.startsWith("data: ") && !line.includes("[DONE]")).map(line => JSON.parse(line.slice(6)));
    expect(chunks.map(chunk => chunk.choices?.[0]?.delta?.content || "").join("")).toBe("Fixture answer");
    expect(chunks.some(chunk => chunk.choices?.[0]?.delta?.tool_calls)).toBe(false);
    expect(chunks.some(chunk => chunk.choices?.[0]?.finish_reason === "stop")).toBe(true);
  });

  it("preserves translated client function tools alongside hosted search", async () => {
    const fn = { name: "lookup", description: "Local lookup", parameters: { type: "object", properties: {} } };
    const { body } = await run({ endpoint: "/api/v1/chat/completions", extra: { tools: [{ type: "function", function: fn }] } });
    expect(body.tools).toEqual([{ type: "function", ...fn }, { type: "web_search" }]);
  });

  it.each(["/v1/responses", "/api/v1/responses"])("retains Responses default search at %s", async (endpoint) => {
    const { body, text } = await run({ endpoint });
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(JSON.parse(text).output.some(item => item.type === "web_search_call")).toBe(true);
  });

  it("retains explicit hosted search options when automatic insertion is disabled", async () => {
    const tool = { type: "web_search", search_context_size: "medium" };
    const { body } = await run({ endpoint: "/v1/responses", codexAutoWebSearch: false, extra: { tools: [tool], tool_choice: "none" } });
    expect(body.tools).toEqual([tool]);
    expect(body.tool_choice).toBe("none");
  });

  it.each(["gpt-6-sol", "gpt-6-luna"])("selects regular Responses for automatic search on %s", async (model) => {
    const { body, headers } = await run({ model });
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.input.some(item => item.type === "additional_tools")).toBe(false);
    expect(headers["x-openai-internal-codex-responses-lite"]).toBeUndefined();
  });

  it("automatically registers hosted search for Chat Completions", async () => {
    const { body, text } = await run();
    expect(body.tools).toContainEqual({ type: "web_search" });
    expect(body._autoCodexWebSearch).toBeUndefined();
    const response = JSON.parse(text);
    expect(response.object).toBe("chat.completion");
    expect(response.choices[0].message.content).toBe("Fixture answer");
    expect(response.choices[0].message.tool_calls).toBeUndefined();
    expect(response.choices[0].finish_reason).toBe("stop");
  });
});
