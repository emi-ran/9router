import { beforeEach, describe, expect, it, vi } from "vitest";
import antigravity from "../../open-sse/providers/registry/antigravity.js";
import codex from "../../open-sse/providers/registry/codex.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(), getCombos: vi.fn(), getCustomModels: vi.fn(),
  getModelAliases: vi.fn(), setModelAlias: vi.fn(),
}));
const disabled = vi.hoisted(() => ({ getDisabledModels: vi.fn() }));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/models", () => db);
vi.mock("@/lib/disabledModelsDb", () => disabled);
const { buildModelsList, GET } = await import("../../src/app/api/v1/models/route.js");
const dashboard = await import("../../src/app/api/models/route.js");

beforeEach(() => {
  db.getProviderConnections.mockResolvedValue([{ provider: "codex", isActive: true }]);
  db.getCombos.mockResolvedValue([]);
  db.getCustomModels.mockResolvedValue([]);
  db.getModelAliases.mockResolvedValue({});
  disabled.getDisabledModels.mockResolvedValue({});
});

describe("BASIC selected catalogs", () => {
  it("registers only Antigravity's high Argon preset with upstream thinking suffix", () => {
    expect(antigravity.models.filter((m) => m.id.includes("argon")).map((m) => m.id)).toEqual(["gemini-4-argon-high"]);
    expect(getModelUpstreamId("ag", "gemini-4-argon-high")).toBe("gemini-4-argon-high(high)");
    expect(getCapabilitiesForModel("antigravity", "gemini-4-argon-high")).toMatchObject({ reasoning: true, thinkingFormat: "gemini-level", thinkingCanDisable: false, contextWindow: 1048576 });
    expect(getThinkingLevels("antigravity", "gemini-4-argon-high")).toEqual(["low", "medium", "high"]);
  });

  it("does not advertise retired Codex chat/review/image models", () => {
    expect(codex.models.some((m) => /^gpt-5\.5(?:-|$)/.test(m.id))).toBe(false);
    expect(codex.models.some((m) => m.id === "gpt-5.6-sol-image")).toBe(true);
  });

  it("keeps no-auth OpenCode visible alongside a connected OAuth provider", async () => {
    const models = await buildModelsList(["llm"]);
    expect(models.some((m) => m.id.startsWith("oc/"))).toBe(true);
    expect(models.every((m) => /^(ag|cx|oc)\//.test(m.id))).toBe(true);
    const ui = await (await dashboard.GET()).json();
    expect(ui.models.some((m) => m.routedModel.startsWith("oc/"))).toBe(true);
  });

  it.each([
    ["alongside active Codex", [{ provider: "codex", isActive: true }, { provider: "opencode", isActive: false }]],
    ["with no active connections", [{ provider: "opencode", isActive: false }]],
    ["with every stored connection disabled", [{ provider: "codex", isActive: false }, { provider: "opencode", isActive: false }]],
  ])("GET excludes explicitly all-disabled OpenCode %s", async (_label, connections) => {
    db.getProviderConnections.mockResolvedValue(connections);
    db.getCustomModels.mockResolvedValue([{ providerAlias: "oc", id: "disabled-custom" }]);
    db.getModelAliases.mockResolvedValue({ fixture: "opencode/disabled-alias-target" });
    const response = await GET();
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.some((model) => model.owned_by === "oc")).toBe(false);
    if (connections.every((connection) => connection.isActive === false) && connections.some((connection) => connection.provider === "codex")) {
      expect(data.some((model) => model.owned_by === "cx")).toBe(false);
    }
  });

  it.each([
    ["no stored connections", []],
    ["an unrelated active connection", [{ provider: "codex", isActive: true }]],
    ["a mixed active/inactive OpenCode pool", [{ provider: "opencode", isActive: false }, { provider: "opencode", isActive: true }]],
    ["an implicitly active OpenCode connection", [{ provider: "opencode" }]],
  ])("GET keeps no-auth OpenCode visible with %s", async (_label, connections) => {
    db.getProviderConnections.mockResolvedValue(connections);
    const response = await GET();
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.some((model) => model.owned_by === "oc")).toBe(true);
    expect(data.every((model) => /^(ag|cx|oc)\//.test(model.id))).toBe(true);
  });

  it.each(["oc", "opencode"])("GET honors model-level disabled controls stored under %s", async (owner) => {
    const model = (await buildModelsList(["llm"])).find((entry) => entry.owned_by === "oc");
    expect(model).toBeDefined();
    disabled.getDisabledModels.mockResolvedValue({ [owner]: [model.id.slice(3)] });
    const { data } = await (await GET()).json();
    expect(data.some((entry) => entry.id === model.id)).toBe(false);
    expect(data.some((entry) => entry.owned_by === "cx")).toBe(true);
  });

  it("honors disabled models under provider IDs as well as aliases", async () => {
    const all = await buildModelsList(["llm"]);
    const model = all.find((m) => m.id.startsWith("oc/"));
    disabled.getDisabledModels.mockResolvedValue({ oc: [], opencode: [model.id.slice(3)] });
    expect((await buildModelsList(["llm"])).some((m) => m.id === model.id)).toBe(false);
    const ui = await (await dashboard.GET()).json();
    expect(ui.models.some((m) => m.routedModel === model.id)).toBe(false);
  });

  it("does not reactivate legacy custom providers, enabled records or combos", async () => {
    db.getProviderConnections.mockResolvedValue([{ provider: "nous", isActive: true }]);
    db.getCustomModels.mockResolvedValue([{ providerAlias: "nous", id: "legacy" }, { providerAlias: "vertex", id: "gemini-4-argon" }]);
    db.getCombos.mockResolvedValue([{ name: "legacy-combo", models: ["vertex/gemini-4-argon"] }]);
    const models = await buildModelsList(["llm"]);
    expect(models.some((m) => /nous|vertex|legacy-combo/.test(m.id))).toBe(false);
    const ui = await (await dashboard.GET()).json();
    expect(ui.models.some((m) => /nous|vertex/.test(m.fullModel))).toBe(false);
  });
});
