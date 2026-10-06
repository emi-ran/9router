import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ getProviderConnections: vi.fn(), getCombos: vi.fn(), getCustomModels: vi.fn(), getModelAliases: vi.fn() }));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");
beforeEach(() => {
  db.getProviderConnections.mockResolvedValue([{ provider: "codex", isActive: true, providerSpecificData: { enabledModels: ["custom-codex"] } }, { provider: "kiro", isActive: true, accessToken: "mock" }]);
  db.getCombos.mockResolvedValue([]); db.getCustomModels.mockResolvedValue([]); db.getModelAliases.mockResolvedValue({});
});
it("legacy active rows cannot enumerate; enabled models remain usable", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("No network"); });
  try {
    const models = await buildModelsList(["llm"]);
    expect(models.map((m) => m.id)).toEqual(["cx/custom-codex"]);
    expect(models[0].capabilities).toBeDefined(); expect(fetchSpy).not.toHaveBeenCalled();
  } finally { fetchSpy.mockRestore(); }
});
it("retained custom models and alias targets enumerate, retired targets never do", async () => {
  db.getCustomModels.mockResolvedValue([{ providerAlias: "cx", id: "custom-two" }, { providerAlias: "kiro", id: "old" }]);
  db.getModelAliases.mockResolvedValue({ good: "cx/alias-model", old: "kiro/old" });
  const ids = (await buildModelsList(["llm"])).map((m) => m.id);
  expect(ids).toContain("cx/custom-two"); expect(ids).toContain("cx/alias-model"); expect(ids.some((id) => id.startsWith("kiro/"))).toBe(false);
});
it("nested combo limits bounded; cycles and retired seats excluded", async () => {
  db.getCombos.mockResolvedValue([{ name: "inner", models: ["cx/gpt-5.4"] }, { name: "outer", models: ["inner", "cx/gpt-5.4"] }, { name: "cycle", models: ["cycle"] }, { name: "old", models: ["kiro/old"] }]);
  const models = await buildModelsList(["llm"]);
  const outer = models.find((m) => m.id === "outer");
  expect(outer.context_length).toBeGreaterThan(0); expect(outer.max_completion_tokens).toBeGreaterThan(0);
  expect(models.find((m) => m.id === "cycle" || m.id === "old")).toBeUndefined();
});
it("reports custom capability override in public model DTO", async () => {
  db.getCustomModels.mockResolvedValue([{ providerAlias: "cx", id: "custom-no-vision", caps: { vision: false } }]);
  const model = (await buildModelsList(["llm"])).find((m) => m.id === "cx/custom-no-vision");
  expect(model.capabilities.vision).toBe(false);
});
