import { beforeEach, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ core: vi.fn(), fusion: vi.fn(), settings: {}, combo: null }));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => calls.settings }));
vi.mock("@/sse/services/auth.js", () => ({ getProviderCredentials: async () => ({ connectionId: "mock", accessToken: "mock" }), markAccountUnavailable: vi.fn(), clearAccountError: vi.fn(), extractApiKey: () => null, isValidApiKey: async () => true }));
vi.mock("@/sse/services/model.js", () => ({ getModelInfo: async (str) => { const [p, ...m] = str.split("/"); return { provider: { oc: "opencode", cx: "codex", ag: "antigravity" }[p], model: m.join("/") }; }, getComboModels: async () => calls.combo }));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: calls.core }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_, c) => c, updateProviderCredentials: vi.fn() }));
vi.mock("open-sse/services/combo.js", async (original) => ({ ...await original(), handleFusionChat: calls.fusion }));
const { handleChat } = await import("../../src/sse/handlers/chat.js");
beforeEach(() => { calls.settings = { capacityAdapter: { vision: { enabled: true, models: ["cx/gpt-5.4"] } } }; calls.combo = null; calls.core.mockReset().mockResolvedValue({ success: true, response: Response.json({ ok: true }) }); calls.fusion.mockReset().mockResolvedValue(Response.json({ ok: true })); });
const imageBody = () => ({ model: "oc/text-only", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,bW9jaw==" } }] }, { role: "assistant", content: "Seen" }, { role: "user", content: "Earlier image?" }] });
const request = (body) => new Request("http://localhost/v1/chat/completions", { method: "POST", body: JSON.stringify(body) });
it("single capable replacement dispatches; historical image preserved", async () => {
  const body = imageBody(); const res = await handleChat(request(body)); expect(res.status).toBe(200);
  expect(calls.core.mock.calls[0][0].modelInfo.provider).toBe("codex"); expect(calls.core.mock.calls[0][0].body.messages).toEqual(body.messages);
});
it("fusion receives only capable retained seats, not legacy pool", async () => {
  calls.combo = ["kiro/old", "oc/text-only"]; calls.settings.comboStrategy = "fusion";
  calls.settings.capacityAdapter.vision.models.unshift("kiro/old");
  const body = imageBody(); body.model = "combo";
  expect((await handleChat(request(body))).status).toBe(200);
  expect(calls.fusion.mock.calls[0][0].models).toEqual(["cx/gpt-5.4"]);
});
it("no capable retained model returns HTTP 400 without dispatch", async () => {
  calls.settings.capacityAdapter = {}; const res = await handleChat(request(imageBody()));
  expect(res.status).toBe(400); expect(calls.core).not.toHaveBeenCalled(); expect(calls.fusion).not.toHaveBeenCalled();
});
