import { beforeEach, describe, expect, it, vi } from "vitest";
import { expandProviderWildcards, accountAllowsModel } from "../../src/mine/routing/providerWildcards.js";

vi.mock("@/lib/localDb", () => ({
  getComboByName: vi.fn(), getCustomModels: vi.fn(), getProviderConnections: vi.fn(), getModelAliases: vi.fn(),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn() }));
import { getComboByName, getCustomModels, getProviderConnections } from "@/lib/localDb";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { getComboModels } from "../../src/sse/services/model.js";

const account = (provider, enabledModels, isActive = true) => ({ provider, isActive, providerSpecificData: { enabledModels } });
const catalog = { ag: [{ id: "sonnet" }, { id: "haiku" }, { id: "image", kind: "image" }], cx: [{ id: "gpt" }], oc: [{ id: "free" }] };

describe("retained provider wildcard expansion", () => {
  it("expands IDs and aliases in order, preserving explicit and nested seats", () => {
    expect(expandProviderWildcards(["nested", "ag/*", "antigravity/*", "codex/*", "oc/*", "ag/haiku"], {
      catalog, connections: [account("antigravity"), account("codex")],
    })).toEqual(["nested", "ag/sonnet", "ag/haiku", "cx/gpt", "oc/free", "ag/haiku"]);
  });
  it("fails closed for retired providers, malformed globs and non-chat custom models", () => {
    expect(expandProviderWildcards(["openai/*", "*/sonnet", "ag/son*", "oc/*"], {
      catalog, customModels: [{ providerAlias: "oc", id: "custom" }, { providerAlias: "oc", id: "embed", type: "embedding" }],
    })).toEqual(["oc/free", "oc/custom"]);
  });
  it("applies disabled model IDs under either provider key and active account unions", () => {
    expect(expandProviderWildcards(["ag/*"], { catalog, disabled: { antigravity: ["haiku"] }, connections: [account("antigravity", ["ag/sonnet"])] })).toEqual(["ag/sonnet"]);
    expect(expandProviderWildcards(["ag/*"], { catalog, disabled: { ag: ["sonnet"] }, connections: [account("antigravity", ["sonnet"]), account("antigravity", ["haiku"])] })).toEqual(["ag/haiku"]);
  });
  it("does not reactivate inactive or missing authenticated providers or disabled no-auth", () => {
    expect(expandProviderWildcards(["ag/*", "cx/*", "oc/*"], { catalog, connections: [account("antigravity", [], false), account("opencode", [], false)] })).toEqual([]);
  });
  it("ignores restrictions on inactive accounts and honors unrestricted active accounts", () => {
    expect(expandProviderWildcards(["ag/*"], { catalog, connections: [account("antigravity", ["sonnet"]), account("antigravity", ["haiku"], false)] })).toEqual(["ag/sonnet"]);
    expect(expandProviderWildcards(["ag/*"], { catalog, connections: [account("antigravity", ["sonnet"]), account("antigravity", [])] })).toEqual(["ag/sonnet", "ag/haiku"]);
  });
  it("enforces bare, alias-qualified and ID-qualified per-account model allowlists", () => {
    for (const value of ["sonnet", "ag/sonnet", "antigravity/sonnet"]) {
      expect(accountAllowsModel(account("antigravity", [value]), "sonnet", "antigravity")).toBe(true);
      expect(accountAllowsModel(account("antigravity", [value]), "haiku", "antigravity")).toBe(false);
    }
  });
});

describe("actual getComboModels integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCustomModels.mockResolvedValue([{ providerAlias: "ag", id: "wildcard-test" }]);
    getDisabledModels.mockResolvedValue({});
    getProviderConnections.mockResolvedValue([account("antigravity", ["wildcard-test"])]);
  });
  it("reads persisted availability and expands before returning combo seats", async () => {
    getComboByName.mockResolvedValue({ models: ["ag/*", "nested"] });
    expect(await getComboModels("chat")).toEqual(["ag/wildcard-test", "nested"]);
    expect(getProviderConnections).toHaveBeenCalledWith();
  });
  it("never dispatches literal or retired wildcards", async () => {
    getComboByName.mockResolvedValue({ models: ["openai/*", "ag/no*", "cx/*"] });
    expect(await getComboModels("chat")).toEqual([]);
  });
  it.each(["image", "webSearch", "webFetch"])("never adds chat wildcards to %s combos", async (kind) => {
    getComboByName.mockResolvedValue({ kind, models: ["oc/*", "tf/fetch"] });
    expect(await getComboModels("media")).toEqual(["tf/fetch"]);
    expect(getProviderConnections).not.toHaveBeenCalled();
  });
  it("leaves non-wildcard combos unchanged and skips provider/model lookups", async () => {
    const models = ["ag/explicit", "nested"];
    getComboByName.mockResolvedValue({ models });
    expect(await getComboModels("plain")).toBe(models);
    expect(await getComboModels("ag/explicit")).toBeNull();
    expect(getProviderConnections).not.toHaveBeenCalled();
  });
  it("honors disabled custom models without mutating stored seats", async () => {
    const combo = { models: ["ag/*"] };
    getComboByName.mockResolvedValue(combo);
    getDisabledModels.mockResolvedValue({ ag: ["wildcard-test"] });
    expect(await getComboModels("chat")).toEqual([]);
    expect(combo.models).toEqual(["ag/*"]);
  });
});
