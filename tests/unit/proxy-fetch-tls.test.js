import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, ProxyAgent, resolve4, request } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  ProxyAgent: vi.fn(function (options) { this.options = options; }),
  resolve4: vi.fn(),
  request: vi.fn(),
}));
vi.mock("undici", () => ({ ProxyAgent, Agent: vi.fn(function (options) { this.options = options; }) }));
vi.mock("dns", () => ({ Resolver: class { setServers() {} resolve4(...args) { resolve4(...args); } } }));
vi.mock("net", () => ({ default: { Socket: class { connect(_port, _ip, callback) { callback(); } on() {} } } }));
vi.mock("https", () => ({ default: { request } }));

let proxyAwareFetch;
const nativeFetch = globalThis.fetch;
beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy", "STRICT_SSL"]) {
    vi.stubEnv(name, "");
  }
  globalThis.fetch = fetchMock;
  ({ proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js"));
});
afterEach(() => {
  globalThis.fetch = nativeFetch;
  vi.unstubAllEnvs();
});

const certCodes = ["SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID"];
const certError = (code) => new TypeError("fetch failed", { cause: Object.assign(new Error("certificate rejected"), { code }) });

describe("TLS failures never retry insecurely or switch transport", () => {
  it.each(certCodes)("rejects direct %s without replay", async (code) => {
    const error = certError(code);
    fetchMock.mockRejectedValue(error);
    await expect(proxyAwareFetch("https://upstream.example/path", { method: "POST", body: "secret" })).rejects.toBe(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ProxyAgent).not.toHaveBeenCalled();
  });

  it.each(["", "false", "0", "true", "1"])("STRICT_SSL=%s cannot disable verification", async (value) => {
    vi.stubEnv("STRICT_SSL", value);
    const error = certError("DEPTH_ZERO_SELF_SIGNED_CERT");
    fetchMock.mockRejectedValue(error);
    await expect(proxyAwareFetch("https://upstream.example/path")).rejects.toBe(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("does not replay proxy TLS failures (strictProxy=%s)", async (strictProxy) => {
    const error = certError("ERR_TLS_CERT_ALTNAME_INVALID");
    fetchMock.mockRejectedValue(error);
    await expect(proxyAwareFetch("https://upstream.example/path", {}, { enabled: true, url: "http://127.0.0.1:43180", strictProxy })).rejects.toBe(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ProxyAgent).toHaveBeenCalledExactlyOnceWith({ uri: "http://127.0.0.1:43180" });
  });

  it("rejects env proxy certificate failure without direct fallback", async () => {
    vi.stubEnv("HTTPS_PROXY", "https://127.0.0.1:43180");
    const error = certError("SELF_SIGNED_CERT_IN_CHAIN");
    fetchMock.mockRejectedValue(error);
    await expect(proxyAwareFetch("https://upstream.example/path")).rejects.toBe(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects MITM-host proxy certificate failure before DNS bypass", async () => {
    const error = certError("CERT_HAS_EXPIRED");
    fetchMock.mockRejectedValue(error);
    await expect(proxyAwareFetch("https://cloudcode-pa.googleapis.com/path", {}, { enabled: true, url: "http://127.0.0.1:43180" })).rejects.toBe(error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resolve4).not.toHaveBeenCalled();
  });

  it("does not replay a DNS-bypass certificate failure via native fetch", async () => {
    const error = Object.assign(new Error("certificate rejected"), { code: "CERT_HAS_EXPIRED" });
    resolve4.mockImplementation((_host, callback) => callback(null, ["127.0.0.1"]));
    request.mockReturnValue({ on: (_event, callback) => callback(error), end() {} });
    await expect(proxyAwareFetch("https://cloudcode-pa.googleapis.com/path")).rejects.toBe(error);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("existing transport contracts", () => {
  it("keeps non-TLS non-strict proxy fallback", async () => {
    const response = new Response("ok");
    fetchMock.mockRejectedValueOnce(new Error("connection refused")).mockResolvedValueOnce(response);
    await expect(proxyAwareFetch("http://upstream.example", {}, { enabled: true, url: "http://127.0.0.1:43180" })).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].dispatcher).toBeInstanceOf(ProxyAgent);
    expect(fetchMock.mock.calls[1][1].dispatcher).toBeUndefined();
  });

  it("keeps strictProxy refusal on ordinary proxy failure", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"));
    await expect(proxyAwareFetch("http://upstream.example", {}, { enabled: true, url: "http://127.0.0.1:43180", strictProxy: true })).rejects.toThrow(/strictProxy/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("strict connection noProxy bypasses directly (custom transport=%s)", async (custom) => {
    const response = new Response("ok");
    fetchMock.mockResolvedValue(response);
    const directFetch = vi.fn().mockResolvedValue(response);
    const options = custom ? { directFetch } : {};
    await expect(proxyAwareFetch("https://upstream.example/path", options,
      { enabled: true, url: "http://127.0.0.1:43180", noProxy: ".example", strictProxy: true })).resolves.toBe(response);
    expect(ProxyAgent).not.toHaveBeenCalled();
    if (custom) expect(directFetch).toHaveBeenCalledWith("https://upstream.example/path", {}, null);
    else expect(fetchMock).toHaveBeenCalledWith("https://upstream.example/path", {});
  });

  it("NO_PROXY bypass remains direct", async () => {
    vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:43180");
    vi.stubEnv("NO_PROXY", ".example");
    fetchMock.mockResolvedValue(new Response("ok"));
    await proxyAwareFetch("https://upstream.example");
    expect(ProxyAgent).not.toHaveBeenCalled();
  });
});
