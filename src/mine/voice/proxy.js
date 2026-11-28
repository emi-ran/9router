import { ProxyAgent } from "undici";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy.js";

// Mirrors open-sse proxyFetch resolution so the WebSocket leaves through the
// same proxy as the HTTPS create call. Anything that cannot be carried is refused.

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function normalizeProxyUrl(value) {
  const raw = text(value);
  if (!raw) return null;
  try {
    new URL(raw);
    return raw;
  } catch {
    return `http://${raw}`;
  }
}

function noProxyMatches(targetUrl, noProxyValue) {
  const noProxy = text(noProxyValue);
  if (!noProxy) return false;
  let hostname;
  try { hostname = new URL(targetUrl).hostname.toLowerCase(); } catch { return false; }
  return noProxy.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean).some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.startsWith(".")) return hostname.endsWith(pattern) || hostname === pattern.slice(1);
    return hostname === pattern || hostname.endsWith(`.${pattern}`);
  });
}

// Returns the resolved proxy config, or null when the proxy source cannot be read.
// A legacy URL the user disabled is not a configured proxy: normal traffic goes direct.
export async function resolveAccountProxy(providerSpecificData) {
  const proxy = await resolveConnectionProxyConfig(providerSpecificData || {});
  if (proxy.source === "error") return null;
  if (proxy.connectionProxyEnabled === true) return proxy;
  return { ...proxy, connectionProxyUrl: "", connectionNoProxy: "" };
}

// Protocols the installed undici ProxyAgent (7.30.1) can dispatch through.
const USABLE_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks5:", "socks:"]);
function usableProxyUrl(url) {
  try {
    return USABLE_PROXY_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

// Returns { proxyUrl } (null = direct, allowed) or null when the account must be refused.
export function resolveWebSocketRoute(proxy, targetUrl) {
  // A relay rewrites HTTP requests only; it cannot carry the hangup WebSocket.
  if (text(proxy.vercelRelayUrl)) return null;
  const connectionEnabled = proxy.connectionProxyEnabled === true;
  const connectionUrl = text(proxy.connectionProxyUrl);
  const connectionBypassed = connectionEnabled && !!connectionUrl && noProxyMatches(targetUrl, proxy.connectionNoProxy);
  const connectionProxy = connectionEnabled && !!connectionUrl && !connectionBypassed ? normalizeProxyUrl(connectionUrl) : null;
  const envValue = connectionProxy ? null : (
    noProxyMatches(targetUrl, process.env.NO_PROXY || process.env.no_proxy) ? null
      : process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy
  );
  const proxyUrl = connectionProxy || normalizeProxyUrl(envValue);
  const intended = !!text(proxy.proxyPoolId) || connectionEnabled || !!connectionUrl;
  // A proxy that is configured but whose scheme undici cannot use is refused, never skipped.
  if (proxyUrl) return usableProxyUrl(proxyUrl) ? { proxyUrl } : null;
  if (connectionBypassed) return { proxyUrl: null };
  // A configured proxy that did not resolve must never be skipped.
  return intended ? null : { proxyUrl: null };
}

export function websocketDispatcher(route) {
  return route.proxyUrl ? new ProxyAgent({ uri: route.proxyUrl }) : null;
}
