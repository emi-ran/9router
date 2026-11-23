import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/localDb", () => ({ getProviderConnections: vi.fn(), validateApiKey: vi.fn(), updateProviderConnection: vi.fn(), getSettings: vi.fn(), getProxyPools: vi.fn(), getProviderConnectionById: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(), pickProxyPoolId: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
vi.mock("open-sse/services/oauthCredentialManager.js", () => ({ refreshProviderCredentials: vi.fn() }));
import { getProviderConnections, getSettings, getProviderConnectionById } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { refreshProviderCredentials } from "open-sse/services/oauthCredentialManager.js";
import { getProviderCredentials } from "../../src/sse/services/auth.js";
import { testSingleConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";

describe("Claude review regressions", () => {
  beforeEach(() => { vi.clearAllMocks(); getSettings.mockResolvedValue({}); resolveConnectionProxyConfig.mockResolvedValue({ proxyPoolId: "pool", connectionProxyEnabled: true, connectionProxyUrl: "http://proxy:8080", strictProxy: true }); });
  it("retains resolved strict proxy for selected Claude credentials", async () => {
    getProviderConnections.mockResolvedValue([{ id: "c", provider: "claude", providerSpecificData: {} }]);
    expect((await getProviderCredentials("claude")).providerSpecificData).toMatchObject({ strictProxy: true });
  });
  it("retains strict proxy for a virtual connection", async () => {
    getProviderConnections.mockResolvedValue([]);
    expect((await getProviderCredentials("opencode")).providerSpecificData).toMatchObject({ strictProxy: true });
  });
  it("refreshes a rejected Claude token through the same strict proxy", async () => {
    const connection = { id: "c", provider: "claude", accessToken: "old", refreshToken: "refresh", providerSpecificData: {} };
    getProviderConnectionById.mockResolvedValue(connection);
    proxyAwareFetch.mockResolvedValueOnce(new Response("", { status: 401 })).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    refreshProviderCredentials.mockResolvedValue({ accessToken: "new" });
    expect(await testSingleConnection("c")).toMatchObject({ valid: true, refreshed: true });
    expect(refreshProviderCredentials).toHaveBeenCalledWith("claude", connection, console, expect.objectContaining({ strictProxy: true }));
    expect(proxyAwareFetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer new" }) }), expect.objectContaining({ strictProxy: true }));
  });
  it("probes Claude OAuth with its bearer token and resolved proxy", async () => {
    getProviderConnectionById.mockResolvedValue({ id: "c", provider: "claude", accessToken: "token", providerSpecificData: {} });
    proxyAwareFetch.mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await testSingleConnection("c")).toMatchObject({ valid: true });
    expect(proxyAwareFetch).toHaveBeenCalledWith(expect.stringContaining("api.anthropic.com/api/oauth/"), expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token" }) }), expect.objectContaining({ strictProxy: true }));
  });
});
