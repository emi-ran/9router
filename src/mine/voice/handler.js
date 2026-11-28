import { getSettings, getProviderConnections } from "@/lib/localDb";
import {
  extractApiKey, isValidApiKey, getProviderCredentials, markAccountUnavailable, clearAccountError,
} from "@/sse/services/auth.js";
import { checkAndRefreshToken } from "@/sse/services/tokenRefresh.js";
import {
  CALL_ID_PATTERN, CALL_LIMIT_MS, CODEX_PROVIDER, CREATE_TIMEOUT_MS, HANGUP_ATTEMPTS, HANGUP_RETRY_MS,
  HANGUP_URL_BASE, REFRESH_TIMEOUT_MS, VOICE_SCOPE,
} from "./constants.js";
import { VoiceError, buildUpstreamBody, parseCreateBody, readJsonBody } from "./validate.js";
import { getCall, hashKey, ownsCall, removeCall, reserveSlot } from "./registry.js";
import { resolveAccountProxy, resolveWebSocketRoute } from "./proxy.js";
import { hangupCall, isUsableOAuth, postCall, readAnswerSdp, readCallId } from "./upstream.js";

const JSON_HEADERS = { "Cache-Control": "no-store" };
const ACCOUNT_STATUSES = new Set([401, 403, 429]);

function errorResponse(status, message) {
  return Response.json(
    { error: { message, type: status < 500 ? "invalid_request_error" : "server_error" } },
    { status, headers: JSON_HEADERS },
  );
}

function failure(error) {
  if (error instanceof VoiceError) return errorResponse(error.status, error.message);
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return errorResponse(504, "Codex voice call timed out");
  return errorResponse(502, "Codex voice call failed");
}

async function authorize(request) {
  const key = extractApiKey(request);
  if (!key || !(await isValidApiKey(key))) return null;
  return key;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discardBody(response) {
  await response.body?.cancel().catch(() => {});
}

// Bounded wait for OAuth refresh; the persisted refresh stays in checkAndRefreshToken.
async function refreshWithTimeout(credentials, options) {
  let timer;
  try {
    return await Promise.race([
      checkAndRefreshToken(CODEX_PROVIDER, credentials, options),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new VoiceError(504, "Codex OAuth refresh timed out")), REFRESH_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function refreshOnce(credentials) {
  try {
    return await refreshWithTimeout(credentials, { force: true });
  } catch {
    return null;
  }
}

// Picks accounts one at a time; each account is tried at most once.
async function openCall(payload, signal) {
  const sessionId = crypto.randomUUID();
  const voiceSessionId = crypto.randomUUID();
  const tried = new Set();
  while (true) {
    const selected = await getProviderCredentials(CODEX_PROVIDER, tried, VOICE_SCOPE);
    if (!selected) throw new VoiceError(503, "No eligible Codex OAuth account for voice");
    if (selected.allRateLimited) throw new VoiceError(429, "Codex voice is rate limited");
    const connectionId = selected.connectionId;
    if (typeof connectionId !== "string" || tried.has(connectionId)) throw new VoiceError(503, "No eligible Codex OAuth account for voice");
    tried.add(connectionId);
    if (!isUsableOAuth(selected)) continue;

    // Fail closed: skip (without marking unhealthy) an account whose proxy cannot carry the hangup.
    const proxy = await resolveAccountProxy(selected._connection?.providerSpecificData || selected.providerSpecificData);
    if (!proxy || !resolveWebSocketRoute(proxy, HANGUP_URL_BASE)) continue;

    let credentials = await refreshWithTimeout(selected);
    if (!isUsableOAuth(credentials)) continue;
    const previous = credentials.accessToken;
    let response = await postCall({ credentials, proxy, body: payload, sessionId, voiceSessionId, signal });
    if (response.status === 401 && credentials.refreshToken) {
      await discardBody(response);
      const refreshed = await refreshOnce(credentials);
      if (refreshed && refreshed.accessToken !== previous && isUsableOAuth(refreshed)) {
        credentials = refreshed;
        response = await postCall({ credentials, proxy, body: payload, sessionId, voiceSessionId, signal });
      }
    }
    if (response.status === 201) {
      // Without a valid call id there is nothing to hang up; with one, a bad body must not leak the call.
      const id = readCallId(response);
      const target = { id, credentials, proxy, sessionId, voiceSessionId };
      let sdp;
      try {
        sdp = await readAnswerSdp(response);
      } catch (error) {
        await hangupWith(target);
        throw error;
      }
      return { id, sdp, connectionId, credentials, sessionId, voiceSessionId };
    }
    await discardBody(response);
    // Only account-scoped failures cool the account down (voice scope only). Everything else is 502.
    if (!ACCOUNT_STATUSES.has(response.status)) throw new VoiceError(502, "Codex voice call failed");
    await markAccountUnavailable(connectionId, response.status, "Codex voice call failed", CODEX_PROVIDER, VOICE_SCOPE);
    continue;
  }
}

// Hangs up one call on the account and proxy it was created with. Never throws.
async function hangupWith({ id, credentials, proxy, sessionId, voiceSessionId }) {
  try {
    const url = `${HANGUP_URL_BASE}${id}`;
    const route = resolveWebSocketRoute(proxy, url);
    if (!route) return false;
    return await hangupCall({ url, callCredentials: credentials, route, sessionId, voiceSessionId });
  } catch {
    return false;
  }
}

// Loads the exact account the call was created on; never falls over to another one.
async function hangupEntry(entry) {
  try {
    const connection = (await getProviderConnections({ provider: CODEX_PROVIDER })).find((c) => c.id === entry.connectionId);
    if (!connection) return false;
    const base = {
      connectionId: connection.id,
      authType: connection.authType,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      expiresAt: connection.expiresAt,
      expiresIn: connection.expiresIn,
      lastRefreshAt: connection.lastRefreshAt,
      providerSpecificData: connection.providerSpecificData || {},
      _connection: connection,
    };
    const credentials = await refreshWithTimeout(base);
    if (!isUsableOAuth(credentials)) return false;
    const proxy = await resolveAccountProxy(connection.providerSpecificData || {});
    if (!proxy) return false;
    return await hangupWith({
      id: entry.id, credentials, proxy, sessionId: entry.sessionId, voiceSessionId: entry.voiceSessionId,
    });
  } catch {
    return false;
  }
}

// Concurrent DELETE and expiry share one hangup; the entry is removed only on success.
function closeCall(entry) {
  if (!entry.closing) {
    entry.closing = hangupEntry(entry)
      .then((ok) => {
        if (ok) removeCall(entry);
        return ok;
      })
      .finally(() => { entry.closing = null; });
  }
  return entry.closing;
}

async function expireCall(entry) {
  for (let attempt = 1; attempt <= HANGUP_ATTEMPTS; attempt++) {
    if (getCall(entry.id) !== entry) return;
    if (await closeCall(entry)) return;
    if (attempt < HANGUP_ATTEMPTS) await sleep(HANGUP_RETRY_MS);
  }
  // Retries exhausted: drop the entry (frees the slot). The upstream call may still exist.
  removeCall(entry);
}

export async function handleVoiceCreate(request) {
  let reservation = null;
  try {
    const key = await authorize(request);
    if (!key) return errorResponse(401, "Valid API key required");
    const settings = await getSettings();
    if (settings?.voiceEnabled !== true) return errorResponse(403, "Codex voice is disabled");

    // Slow bodies must not hold slots: validate first, then reserve synchronously
    // before any account selection or upstream call.
    const parsed = parseCreateBody(await readJsonBody(request));
    reservation = reserveSlot();
    if (!reservation) return errorResponse(429, "Voice call capacity reached");

    // Not tied to the client: a disconnect must not lose the call id of an upstream call already created.
    const signal = AbortSignal.timeout(CREATE_TIMEOUT_MS);
    const call = await openCall(buildUpstreamBody(parsed), signal);

    const entry = {
      id: call.id,
      keyHash: hashKey(key),
      connectionId: call.connectionId,
      sessionId: call.sessionId,
      voiceSessionId: call.voiceSessionId,
      expiresAt: Date.now() + CALL_LIMIT_MS,
      timer: null,
      closing: null,
    };
    // The only commit failure is an upstream id that is already registered. That is the same call,
    // so it must not be hung up here (that would close the registered call); answer 502 instead.
    if (!reservation.commit(entry)) throw new VoiceError(502, "Codex voice call failed");
    entry.timer = setTimeout(() => { void expireCall(entry); }, CALL_LIMIT_MS);

    try {
      await clearAccountError(call.connectionId, call.credentials, VOICE_SCOPE);
    } catch {
      // The call exists; a failed error-state reset must not hide it.
    }
    return Response.json(
      { id: entry.id, sdp: call.sdp, expires_at: Math.floor(entry.expiresAt / 1000) },
      { status: 201, headers: { ...JSON_HEADERS, Location: `/v1/live/${entry.id}` } },
    );
  } catch (error) {
    return failure(error);
  } finally {
    reservation?.release();
  }
}

export async function handleVoiceDelete(request, id) {
  try {
    const key = await authorize(request);
    if (!key) return errorResponse(401, "Valid API key required");
    const entry = typeof id === "string" && CALL_ID_PATTERN.test(id) ? getCall(id) : null;
    if (!entry || !ownsCall(entry, key)) return errorResponse(404, "Voice call not found");
    if (!(await closeCall(entry))) return errorResponse(502, "Codex voice hangup failed");
    return Response.json({ id: entry.id, status: "closed" }, { headers: JSON_HEADERS });
  } catch {
    return errorResponse(502, "Codex voice hangup failed");
  }
}
