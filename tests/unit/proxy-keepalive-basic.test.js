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
    const fetchMock = vi.fn(async () => ({ status: 200 }));
    globalThis.fetch = fetchMock;
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    await Promise.all([proxyAwareFetch("https://example.com"), proxyAwareFetch("https://example.com")]);
    expect(agents).toHaveLength(1);
    expect(agents[0].opts).toEqual({ keepAliveTimeout: 1234, keepAliveMaxTimeout: 1234 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].dispatcher).toBe(agents[0]);
    expect(fetchMock.mock.calls[1][1].dispatcher).toBe(agents[0]);
    await proxyAwareFetch("https://example.com", {}, { enabled: true, url: "http://localhost:8080" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1].dispatcher).toBeInstanceOf(ProxyAgent);
    expect(fetchMock.mock.calls[2][1].dispatcher.opts).toEqual({ uri: "http://localhost:8080" });
  });

  it("preserves a caller dispatcher for direct and proxy-fallback requests, but not proxied requests", async () => {
    for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) delete process.env[name];
    const agents = [];
    class Agent { constructor() { agents.push(this); } }
    class ProxyAgent { constructor(opts) { this.opts = opts; } }
    vi.doMock("undici", () => ({ Agent, ProxyAgent }));
    const fetchMock = vi.fn(async () => ({ status: 200 }));
    globalThis.fetch = fetchMock;
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    const dispatcher = { dispatch: vi.fn() };
    const options = { dispatcher, method: "POST", body: "payload" };
    const proxy = { enabled: true, url: "http://localhost:8080" };

    await proxyAwareFetch("https://example.com", options);
    expect(fetchMock.mock.calls[0][1]).toEqual(options);
    expect(agents).toHaveLength(0);

    await proxyAwareFetch("https://example.com", options, proxy);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST", body: "payload", dispatcher: expect.any(ProxyAgent) });
    expect(options.dispatcher).toBe(dispatcher);

    fetchMock.mockRejectedValueOnce(new Error("proxy unavailable"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await proxyAwareFetch("https://example.com", options, proxy);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(fetchMock.mock.calls[2][1].dispatcher).toBeInstanceOf(ProxyAgent);
      expect(fetchMock.mock.calls[3][1]).toEqual(options);
      expect(agents).toHaveLength(0);
    } finally {
      warning.mockRestore();
    }
  });

  it("does not replay a failed direct POST", async () => {
    delete process.env.HTTP_PROXY; delete process.env.HTTPS_PROXY;
    delete process.env.http_proxy; delete process.env.https_proxy;
    delete process.env.ALL_PROXY; delete process.env.all_proxy;
    class Agent { close() { return Promise.resolve(); } }
    vi.doMock("undici", () => ({ Agent }));
    const failure = Object.assign(new Error("fetch failed"), { cause: { code: "UND_ERR_SOCKET" } });
    const fetchMock = vi.fn().mockRejectedValue(failure);
    globalThis.fetch = fetchMock;
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    await expect(proxyAwareFetch("https://example.com", { method: "POST", body: "{}" })).rejects.toBe(failure);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", body: "{}", dispatcher: expect.any(Agent) });
  });
});
