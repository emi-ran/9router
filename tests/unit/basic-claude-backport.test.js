import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, proxyAwareFetch: (url, init, options) => url.endsWith("/v1/oauth/token") ? globalThis.fetch(url, init, options) : actual.proxyAwareFetch(url, init, options) };
});
import { generateAuthData, exchangeTokens } from "../../src/lib/oauth/providers/index.js";
import { getTargetFormat } from "../../open-sse/services/provider.js";
import { refreshTokenByProvider } from "../../open-sse/services/tokenRefresh.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";

describe("Claude Code on basic", () => {
  it("provides PKCE authorization and Claude chat formatting", async () => {
    const auth = await generateAuthData("claude", "https://console.anthropic.com/oauth/code/callback");
    const url = new URL(auth.authUrl);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(auth.state);
    expect(getTargetFormat("claude")).toBe("claude");
  });
  it("refreshes Claude OAuth credentials without disclosing upstream errors", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({access_token: "new", refresh_token: "rotated", expires_in: 3600}), {status: 200}));
    try {
      const result = await refreshTokenByProvider("claude", {refreshToken: "old"});
      expect(result).toEqual({accessToken: "new", refreshToken: "rotated", expiresIn: 3600});
      expect(JSON.parse(fetcher.mock.calls[0][1].body).grant_type).toBe("refresh_token");
    } finally { fetcher.mockRestore(); }
  });
  it("passes connection proxy settings to proactive token refresh", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({access_token: "new"}), {status: 200}));
    const options = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.example:8080" };
    try {
      await refreshTokenByProvider("claude", {refreshToken: "unique-proxy-token"}, null, options);
      expect(fetcher.mock.calls[0][2]).toEqual(options);
    } finally { fetcher.mockRestore(); }
  });
  it("rejects a mismatched pasted OAuth state before contacting the server", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    try {
      await expect(exchangeTokens("claude", "code#wrong", "https://console.anthropic.com/oauth/code/callback", "verifier", "expected")).rejects.toThrow("state mismatch");
      expect(fetcher).not.toHaveBeenCalled();
    } finally { fetcher.mockRestore(); }
  });
  it("rejects a pasted state without an expected attempt state", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    try {
      await expect(exchangeTokens("claude", "code#wrong", "https://console.anthropic.com/oauth/code/callback", "verifier", undefined)).rejects.toThrow("state");
      expect(fetcher).not.toHaveBeenCalled();
    } finally { fetcher.mockRestore(); }
  });
  it("preserves strict connection proxy settings during reactive Claude refresh", async () => {
    const executor = getExecutor("claude");
    const execute = vi.spyOn(executor, "execute").mockResolvedValue({ response: new Response("unauthorized", { status: 401 }), url: "https://example.test", headers: {}, transformedBody: {} });
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ access_token: "next" }), { status: 200 }));
    const options = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.example:8080", connectionNoProxy: "", vercelRelayUrl: "", strictProxy: true };
    try {
      await handleChatCore({ body: { model: "claude-test", messages: [{ role: "user", content: "hello" }], max_tokens: 32 }, modelInfo: { provider: "claude", model: "claude-test" }, credentials: { accessToken: "old", refreshToken: "reactive", providerSpecificData: options } });
      expect(execute.mock.calls[0][0].proxyOptions).toEqual(options);
      expect(fetcher.mock.calls[0][2]).toEqual(options);
      expect(execute.mock.calls[1][0].proxyOptions).toEqual(options);
    } finally { execute.mockRestore(); fetcher.mockRestore(); }
  });
  it("supports executor refresh after upstream authorization failure", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({access_token: "next", expires_in: 3600}), {status: 200}));
    try { expect((await getExecutor("claude").refreshCredentials({refreshToken: "another"})).accessToken).toBe("next"); }
    finally { fetcher.mockRestore(); }
  });
  it("sends the translated request to Anthropic using bearer OAuth", async () => {
    const executor = getExecutor("claude");
    let sent;
    const result = await executor.execute({ model: "claude-opus-5", body: {model: "claude-opus-5", messages: [{role: "user", content: "hi"}], max_tokens: 32}, stream: false, credentials: {accessToken: "test-token"}, directFetch: async (url, init) => { sent = {url, init}; return new Response("{}", {status: 200}); } });
    expect(result.response.status).toBe(200);
    expect(sent.url).toBe("https://api.anthropic.com/v1/messages?beta=true");
    expect(sent.init.headers.Authorization).toBe("Bearer test-token");
    expect(JSON.parse(sent.init.body).messages[0].content).toBe("hi");
  });
  it("serializes the selected streaming mode even when the request omits stream", async () => {
    let sent;
    await getExecutor("claude").execute({ model: "claude-opus-5", body: { messages: [], max_tokens: 32 }, stream: true, credentials: { accessToken: "token" }, directFetch: async (_url, init) => { sent = JSON.parse(init.body); return new Response("", { status: 200 }); } });
    expect(sent.stream).toBe(true);
  });
  it("resolves the Claude alias to a dedicated executor without restoring fallback", () => {
    expect(resolveProviderAlias("cc")).toBe("claude");
    expect(getExecutor("claude").getProvider()).toBe("claude");
    expect(() => getExecutor("retired-provider")).toThrow();
  });
});
