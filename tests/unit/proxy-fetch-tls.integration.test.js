import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect } from "node:net";
import { spawn } from "node:child_process";
import { Agent } from "undici";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Public, test-only self-signed identity. Never used outside loopback servers.
const cert = readFileSync(new URL("../fixtures/tls/localhost-cert.pem.txt", import.meta.url));
const key = readFileSync(new URL("../fixtures/tls/localhost-key.pem.txt", import.meta.url));
const nativeFetch = globalThis.fetch;
const servers = [];
const sockets = new Set();
let proxyAwareFetch, upstreamUrl, proxyUrl, secureProxyUrl, trustedAgent;
let upstreamRequests = 0, tunnels = 0;

async function listen(server) {
  servers.push(server);
  server.on("connection", socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

beforeAll(async () => {
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy", "STRICT_SSL"]) vi.stubEnv(name, "");
  ({ proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js"));
  const upstream = createHttpsServer({ cert, key }, (_req, res) => {
    upstreamRequests++;
    res.end("verified");
  });
  upstreamUrl = `https://127.0.0.1:${await listen(upstream)}`;
  const tunnel = (req, client, head) => {
    tunnels++;
    const target = new URL(`http://${req.url}`);
    const remote = connect(Number(target.port), target.hostname, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) remote.write(head);
      remote.pipe(client);
      client.pipe(remote);
    });
    sockets.add(remote);
    remote.on("close", () => sockets.delete(remote));
    remote.on("error", () => client.destroy());
    client.on("error", () => remote.destroy());
    client.on("close", () => remote.destroy());
  };
  const proxy = createHttpServer();
  proxy.on("connect", tunnel);
  proxyUrl = `http://127.0.0.1:${await listen(proxy)}`;
  const tlsProxy = createHttpsServer({ cert, key });
  tlsProxy.on("connect", tunnel);
  secureProxyUrl = `https://127.0.0.1:${await listen(tlsProxy)}`;
  trustedAgent = new Agent({ connect: { ca: cert } });
});

afterAll(async () => {
  globalThis.fetch = nativeFetch;
  vi.unstubAllEnvs();
  await trustedAgent?.close();
  const closing = servers.map(server => new Promise(resolve => server.close(resolve)));
  for (const socket of sockets) socket.destroy();
  await Promise.all(closing);
});

function isCertificateFailure(error) {
  const codes = [];
  for (let cause = error; cause; cause = cause.cause) codes.push(cause.code);
  expect(codes).toContain("DEPTH_ZERO_SELF_SIGNED_CERT");
  return true;
}

describe("real TLS verification on isolated port-0 servers", () => {
  it("rejects an untrusted direct endpoint without sending HTTP credentials", async () => {
    const before = upstreamRequests;
    await expect(proxyAwareFetch(upstreamUrl, { headers: { Authorization: "Bearer test-only" } })).rejects.toSatisfy(isCertificateFailure);
    expect(upstreamRequests).toBe(before);
  });

  it("accepts an explicitly trusted CA without disabling verification", async () => {
    const response = await proxyAwareFetch(upstreamUrl, { dispatcher: trustedAgent });
    expect(await response.text()).toBe("verified");
  });

  it("rejects untrusted upstream TLS through HTTP CONNECT without direct replay", async () => {
    const before = upstreamRequests, beforeTunnels = tunnels;
    await expect(proxyAwareFetch(upstreamUrl, {}, { enabled: true, url: proxyUrl })).rejects.toSatisfy(isCertificateFailure);
    expect(tunnels).toBe(beforeTunnels + 1);
    expect(upstreamRequests).toBe(before);
  });

  it("rejects an untrusted HTTPS proxy before CONNECT, without direct replay", async () => {
    const before = upstreamRequests, beforeTunnels = tunnels;
    await expect(proxyAwareFetch(upstreamUrl, {}, { enabled: true, url: secureProxyUrl })).rejects.toSatisfy(isCertificateFailure);
    expect(tunnels).toBe(beforeTunnels);
    expect(upstreamRequests).toBe(before);
  });

  it("keeps successful direct HTTP traffic working", async () => {
    const server = createHttpServer((_req, res) => res.end("plain"));
    const port = await listen(server);
    expect(await (await proxyAwareFetch(`http://127.0.0.1:${port}`)).text()).toBe("plain");
  });

  it("keeps successful proxy HTTP traffic working", async () => {
    const server = createHttpServer((_req, res) => res.end("proxied"));
    const port = await listen(server), before = tunnels;
    const response = await proxyAwareFetch(`http://127.0.0.1:${port}`, {}, { enabled: true, url: proxyUrl, strictProxy: true });
    expect(await response.text()).toBe("proxied");
    expect(tunnels).toBe(before + 1);
  });

  it.each(["global", "npm"])("%s fetch rejects excessive content-encoding without crashing (GHSA-xjj6-f33q-929c)", async (implementation) => {
    // Isolate the potential unhandled-stream-error crash from the test runner.
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      import { createServer } from "node:net";
      const fetchImpl = ${implementation === "npm" ? '(await import("undici")).fetch' : "globalThis.fetch"};
      const server = createServer(socket => socket.once("data", () => socket.end(
        "HTTP/1.1 200 OK\\r\\nContent-Encoding: gzip, gzip, gzip, gzip, gzip, gzip\\r\\nContent-Length: 100\\r\\nConnection: close\\r\\n\\r\\n"
      )));
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      try {
        await assert.rejects(fetchImpl("http://127.0.0.1:" + server.address().port));
        await new Promise(resolve => setTimeout(resolve, 100));
        console.log("decoder rejected safely");
      } finally { server.close(); }
    `], { cwd: new URL("../../", import.meta.url), env: { ...process.env, NODE_OPTIONS: "" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", data => output += data);
    child.stderr.on("data", data => output += data);
    const timer = setTimeout(() => child.kill(), 4000);
    try {
      const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
      expect(code, output).toBe(0);
      expect(output).toContain("decoder rejected safely");
    } finally { clearTimeout(timer); }
  });
});
