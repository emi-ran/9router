import { describe, expect, it, vi } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
const { customModels } = vi.hoisted(() => ({ customModels: [] }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => [{ provider: "codex", isActive: true, providerSpecificData: { enabledModels: ["gpt-6-sol"] } }],
  getCombos: async () => [], getCustomModels: async () => customModels, getModelAliases: async () => ({}),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");
describe("basic model thinking levels", () => {
  it("does not advertise thinking levels when reasoning is explicitly disabled", async () => {
    customModels.push({ providerAlias: "cx", id: "gpt-6-sol", caps: { reasoning: false } });
    try {
      const entry = (await buildModelsList(["llm"])).find((item) => item.id === "cx/gpt-6-sol");
      expect(entry.capabilities.reasoning).toBe(false);
      expect(entry).not.toHaveProperty("thinking_levels");
    } finally { customModels.length = 0; }
  });
  it("exposes Codex reasoning levels on real model listing", async () => {
    const models = await buildModelsList(["llm"]);
    const entry = models.find((item) => item.id === "cx/gpt-6-sol");
    expect(entry).toBeDefined();
    expect(entry.thinking_levels).toEqual(getThinkingLevels("codex", "gpt-6-sol"));
    expect(entry.thinking_levels.length).toBeGreaterThan(0);
  });
});
