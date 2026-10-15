import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(), validateApiKey: vi.fn(), updateProviderConnection: vi.fn(), getSettings: vi.fn(), getProxyPools: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}), pickProxyPoolId: vi.fn() }));
vi.mock("../../src/sse/services/antigravityQuota.js", () => ({ getAntigravityQuotaCache: () => new Map() }));
import { getProviderConnections, getSettings } from "@/lib/localDb";
import { getProviderCredentials } from "../../src/sse/services/auth.js";
const connection = (id, provider, enabledModels, isActive = true) => ({ id, provider, isActive, providerSpecificData: { enabledModels } });
describe("wildcard outbound account enforcement", () => {
  beforeEach(() => { vi.clearAllMocks(); getSettings.mockResolvedValue({}); });
  it.each([["antigravity", "ag"], ["codex", "cx"]])("never selects a disallowed %s account, even when preferred", async (provider, alias) => {
    getProviderConnections.mockResolvedValue([
      connection("blocked", provider, ["other"]),
      connection("allowed", provider, [`${alias}/wanted`]),
    ]);
    expect(await getProviderCredentials(provider, null, "wanted", { preferredConnectionId: "blocked" })).toMatchObject({ connectionId: "allowed" });
  });
  it("fails closed when no authenticated account permits a model", async () => {
    getProviderConnections.mockResolvedValue([connection("blocked", "antigravity", ["other"])]);
    expect(await getProviderCredentials("antigravity", null, "wanted")).toBeNull();
  });
  it("preserves requested-model restrictions when the outbound model differs", async () => {
    getProviderConnections.mockResolvedValue([connection("blocked", "codex", ["outbound"])]);
    expect(await getProviderCredentials("codex", null, "outbound", { requestedModel: "wanted" })).toBeNull();
  });
  it("does not bypass disabled OpenCode through its no-auth virtual connection", async () => {
    getProviderConnections.mockResolvedValue([connection("disabled", "opencode", [], false)]);
    expect(await getProviderCredentials("opencode", null, "wanted")).toBeNull();
  });
  it("applies model restrictions before creating an OpenCode virtual connection", async () => {
    getProviderConnections.mockResolvedValue([connection("restricted", "opencode", ["other"])]);
    expect(await getProviderCredentials("opencode", null, "wanted")).toBeNull();
    getProviderConnections.mockResolvedValue([connection("restricted", "opencode", ["oc/wanted"])]);
    expect(await getProviderCredentials("opencode", null, "wanted")).toMatchObject({ id: "noauth" });
  });
  it("keeps no-auth OpenCode working when no stored connection exists", async () => {
    getProviderConnections.mockResolvedValue([]);
    expect(await getProviderCredentials("opencode", null, "wanted")).toMatchObject({ id: "noauth" });
  });
});
