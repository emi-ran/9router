// TLS-impersonating HTTP client for opencode.ai's free tier.
//
// The free gate keys on the TLS ClientHello, not on headers: a request that
// passes from the OpenCode CLI is refused with 429 FreeUsageLimitError when the
// same body/headers ride Node's OpenSSL fingerprint, and passes again once the
// cipher list matches. Measured 2026-10-26 on one process, one egress IP, three
// transports: node fetch/https/http2 all 429, Bun's BoringSSL fetch 200.
// JA4's cipher hash identifies the list (Bun: 5b57614c22b0), so the match is on
// the cipher-list hash and nothing else — reordering the same list still passes.
//
// wreq-js is an optional dependency; when absent the request fails with an actionable error.

import { loadRuntimeDep } from "./lazyRuntime.js";

// BoringSSL/Chrome-family cipher list the upstream accepts, in the order Bun
// sends it. Only the list's hash is compared, so this must stay verbatim.
const OPENCODE_CIPHER_LIST = [
  "TLS_AES_128_GCM_SHA256",
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305",
  "ECDHE-ECDSA-AES128-SHA",
  "ECDHE-RSA-AES128-SHA",
  "ECDHE-ECDSA-AES256-SHA",
  "ECDHE-RSA-AES256-SHA",
  "AES128-GCM-SHA256",
  "AES256-GCM-SHA384",
  "AES128-SHA",
  "AES256-SHA",
].join(":");

const DEFAULT_TIMEOUT_MS = 120000;

const sessions = new Map();

export class OpencodeTlsUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "OpencodeTlsUnavailableError";
  }
}

async function loadSession(proxyUrl) {
  const key = proxyUrl || "";
  if (!sessions.has(key)) {
    const pending = (async () => {
      const wreq = await loadRuntimeDep("wreq-js");
      if (typeof wreq.createSession !== "function") {
        throw new Error("wreq-js runtime is missing createSession");
      }
      return wreq.createSession({
        emulation: { tlsOptions: { cipherList: OPENCODE_CIPHER_LIST } },
        ...(proxyUrl ? { proxy: proxyUrl } : {}),
      });
    })().catch((error) => {
      if (sessions.get(key) === pending) sessions.delete(key);
      throw error;
    });
    sessions.set(key, pending);
  }
  return sessions.get(key);
}

/** Drop cached sessions so the next call builds fresh ones. */
export function resetOpencodeTlsSession() {
  for (const pending of sessions.values()) {
    pending.then((session) => session.close?.()).catch(() => {});
  }
  sessions.clear();
}

/**
 * Fetch through the impersonated-TLS session. Returns a native Response so
 * downstream `.body` / `.text()` / `.json()` consumers keep working unchanged.
 *
 * Streaming is preserved: the response body is handed over as the live
 * ReadableStream, never buffered.
 */
export async function opencodeTlsFetch(url, init = {}, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, proxyUrl = null } = {}) {
  let session;
  try {
    session = await loadSession(proxyUrl);
  } catch {
    throw new OpencodeTlsUnavailableError(
      `wreq-js unavailable — verify the pinned wreq-js dependency and proxy configuration`
    );
  }

  const options = {
    method: init.method || "GET",
    headers: init.headers,
    redirect: "follow",
    timeout: timeoutMs,
  };
  if (init.body !== undefined) options.body = init.body;
  if (signal) options.signal = signal;

  let res;
  try {
    res = await session.fetch(url, options);
  } catch (error) {
    if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
    if (proxyUrl) throw new Error("[OpenCode] TLS proxy request failed");
    throw error;
  }
  const headers = {};
  res.headers?.forEach?.((value, key) => {
    headers[key] = value;
  });
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export const __test__ = { OPENCODE_CIPHER_LIST };
