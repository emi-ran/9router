import { describe, it, expect, vi, afterEach } from "vitest";

describe("direct keep-alive pooling", () => {
  const savedFetch = globalThis.fetch;
  const savedEnv = { ...process.env };
  afterEach(() => {
    globalThis.fetch = savedFetch;
    process.env = { ...savedEnv };
    vi.resetModules();
    vi.doUnmock("undici");
  });

  it("shares a capped direct agent without changing proxy TLS", async () => {
    delete process.env.HTTP_PROXY; delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy; delete process.env.https_proxy;
    delete process.env.ALL_PROXY; delete process.env.all_proxy;
    process.env.FETCH_KEEPALIVE_TIMEOUT_MS = "1234";
    const agents = [];
    class Agent { constructor(opts) { this.opts = opts; agents.push(this); } close() { return Promise.resolve(); } }
    class ProxyAgent { constructor(opts) { this.opts = opts; } }
    vi.doMock("undici", () => ({ Agent, ProxyAgent }));
    globalThis.fetch = vi.fn(async () => ({ status: 200 }));
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    await Promise.all([proxyAwareFetch("https://example.com"), proxyAwareFetch("https://example.com")]);
    expect(agents).toHaveLength(1);
    expect(agents[0].opts).toEqual({ keepAliveTimeout: 1234, keepAliveMaxTimeout: 1234 });
    expect(globalThis.fetch.mock.calls[0][1].dispatcher).toBe(agents[0]);
    expect(globalThis.fetch.mock.calls[1][1].dispatcher).toBe(agents[0]);
    await proxyAwareFetch("https://example.com", {}, { enabled: true, url: "http://localhost:8080" });
    expect(globalThis.fetch.mock.calls[2][1].dispatcher.opts).toEqual({ uri: "http://localhost:8080" });
  });

  it("does not replay failed requests or downgrade certificate verification", async () => {
    delete process.env.HTTP_PROXY; delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy; delete process.env.https_proxy;
    delete process.env.ALL_PROXY; delete process.env.all_proxy;
    class Agent { close() { return Promise.resolve(); } }
    vi.doMock("undici", () => ({ Agent }));
    const failure = Object.assign(new Error("fetch failed"), { cause: { code: "UND_ERR_SOCKET" } });
    globalThis.fetch = vi.fn().mockRejectedValue(failure);
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    await expect(proxyAwareFetch("https://example.com", { method: "POST", body: "{}" })).rejects.toBe(failure);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
