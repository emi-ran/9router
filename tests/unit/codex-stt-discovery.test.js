import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ getProviderConnections: vi.fn(), getCombos: vi.fn(), getCustomModels: vi.fn(), getModelAliases: vi.fn() }));
const disabled = vi.hoisted(() => ({ value: {} }));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => disabled.value }));
const { buildModelsList, GET } = await import("../../src/app/api/v1/models/route.js");
const { GET: info } = await import("../../src/app/api/v1/models/info/route.js");
beforeEach(() => {
  db.getProviderConnections.mockResolvedValue([{ provider: "codex", authType: "oauth", isActive: true }]);
  db.getCombos.mockResolvedValue([]); db.getCustomModels.mockResolvedValue([]); db.getModelAliases.mockResolvedValue({}); disabled.value = {};
});
it("discovers exactly one Codex STT model without restoring excluded providers or chat entries", async () => {
  expect(await buildModelsList(["stt"])).toEqual([{ id: "cx/transcribe", object: "model", owned_by: "cx", kind: "stt" }]);
  expect((await buildModelsList(["llm"])).some((model) => model.id === "cx/transcribe")).toBe(false);
});
it("supports OpenAI discovery with kind=stt", async () => {
  const response = await GET(new Request("http://localhost/v1/models?kind=stt"));
  expect((await response.json()).data).toEqual([{ id: "cx/transcribe", object: "model", owned_by: "cx", kind: "stt" }]);
});
it("does not advertise removed Codex speech synthesis", async () => {
  expect(await buildModelsList(["tts"])).toEqual([]);
  const response = await GET(new Request("http://localhost/v1/models?kind=tts"));
  expect((await response.json()).data).toEqual([]);
  for (const id of ["cx/speak", "codex/speak"]) {
    expect((await info(new Request(`http://localhost/v1/models/info?id=${encodeURIComponent(id)}&kind=tts`))).status).toBe(404);
  }
});
it("honors per-account enabled-model scope during STT discovery", async () => {
  db.getProviderConnections.mockResolvedValue([{ provider: "codex", authType: "oauth", providerSpecificData: { enabledModels: ["gpt-5.4"] } }]);
  expect(await buildModelsList(["stt"])).toEqual([]);
  db.getProviderConnections.mockResolvedValue([{ provider: "codex", authType: "oauth", providerSpecificData: { enabledModels: ["cx/transcribe"] } }]);
  expect(await buildModelsList(["stt"])).toHaveLength(1);
});
it("publishes precise supported formats, limits and endpoint", async () => {
  const response = await info(new Request("http://localhost/v1/models/info?id=cx/transcribe"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ id: "cx/transcribe", kind: "stt", endpoint: "/v1/audio/transcriptions", params: ["file", "response_format"], options: { response_format: ["json", "text"], max_audio_seconds: 120, max_audio_bytes: 26214400 } });
});
it("does not advertise unavailable, non-OAuth or disabled Codex accounts", async () => {
  for (const connections of [[], [{ provider: "openai", authType: "oauth" }], [{ provider: "codex", authType: "apikey" }], [{ provider: "codex", authType: "oauth", isActive: false }]]) {
    db.getProviderConnections.mockResolvedValue(connections);
    expect(await buildModelsList(["stt"])).toEqual([]);
  }
  db.getProviderConnections.mockResolvedValue([{ provider: "codex", authType: "oauth" }]); disabled.value = { cx: ["transcribe"] };
  expect(await buildModelsList(["stt"])).toEqual([]);
});
