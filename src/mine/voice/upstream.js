import { WebSocket } from "undici";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import {
  CALL_ID_PATTERN, CREATE_URL, CREATE_TIMEOUT_MS, HANGUP_TIMEOUT_MS, MAX_ANSWER_BYTES, MAX_ERROR_BYTES, USER_AGENT,
} from "./constants.js";
import { VoiceError } from "./validate.js";
import { websocketDispatcher } from "./proxy.js";

export function accountId(credentials) {
  const data = credentials?.providerSpecificData || {};
  return data.workspaceId || data.chatgptAccountId || data.accountId;
}

// Same validation as the transcription path: no header injection from stored values.
export function isUsableOAuth(credentials) {
  return !!credentials && credentials.authType === "oauth"
    && typeof credentials.accessToken === "string" && /^[\x21-\x7e]+$/.test(credentials.accessToken)
    && typeof accountId(credentials) === "string" && /^[\x21-\x7e]{1,256}$/.test(accountId(credentials));
}

function tokenPlan(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload?.["https://api.openai.com/auth"]?.chatgpt_plan_type;
  } catch {
    return undefined;
  }
}

// Free plan accounts are rejected by the voice upstream. The token claim wins:
// the stored plan is only written at login or import and goes stale.
export function isFreePlan(credentials) {
  const plan = tokenPlan(credentials?.accessToken) || credentials?.providerSpecificData?.chatgptPlanType;
  return String(plan || "").trim().toLowerCase() === "free";
}

function sessionHeaders(credentials, sessionId, voiceSessionId) {
  return {
    authorization: `Bearer ${credentials.accessToken}`,
    "chatgpt-account-id": accountId(credentials),
    "openai-alpha": "quicksilver=v2",
    "x-session-id": sessionId,
    "voice-session-id": voiceSessionId,
    originator: "9router",
    "user-agent": USER_AGENT,
  };
}

// The create call always goes through the shared proxy transport with strictProxy,
// so a configured proxy is never skipped in favour of a direct connection.
export function postCall({ credentials, proxy, body, sessionId, voiceSessionId, signal }) {
  return proxyAwareFetch(CREATE_URL, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(CREATE_TIMEOUT_MS)]),
    headers: { ...sessionHeaders(credentials, sessionId, voiceSessionId), "content-type": "application/json" },
    body: JSON.stringify(body),
  }, { ...proxy, strictProxy: true });
}

async function readBoundedText(response, limit) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new VoiceError(502, "Codex voice call failed");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks, size).toString("utf8");
}

const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;

// Describes a failed create for logs and errors. Only the status and a short
// machine code leave this function, never upstream text.
export async function readFailureReason(response) {
  let code;
  try {
    const body = JSON.parse(await readBoundedText(response, MAX_ERROR_BYTES));
    code = [body?.error?.code, body?.error?.type, body?.detail?.code]
      .find((value) => typeof value === "string" && ERROR_CODE.test(value));
  } catch {
    // No readable JSON body: the status alone is reported.
  }
  return code ? `upstream HTTP ${response.status} ${code}` : `upstream HTTP ${response.status}`;
}

// The call id comes from Location; without a valid id there is nothing to hang up.
export function readCallId(response) {
  const location = response.headers.get("location");
  if (!location) throw new VoiceError(502, "Invalid voice call response");
  let id;
  try {
    id = new URL(location, CREATE_URL).pathname.split("/").pop();
  } catch {
    throw new VoiceError(502, "Invalid voice call response");
  }
  if (!CALL_ID_PATTERN.test(id || "")) throw new VoiceError(502, "Invalid voice call response");
  return id;
}

// Reads and validates the SDP answer. Throws 502 on an unusable body.
export async function readAnswerSdp(response) {
  const sdp = await readBoundedText(response, MAX_ANSWER_BYTES);
  if (!sdp.startsWith("v=0")) throw new VoiceError(502, "Invalid voice call response");
  return sdp;
}

// Hangs up over an outbound WebSocket. Resolves true only on session.closed.
// Never throws and never includes the socket payloads in the result.
export function hangupCall({ url, callCredentials, route, sessionId, voiceSessionId }) {
  return new Promise((resolve) => {
    let settled = false;
    let socket = null;
    let timer = null;
    let dispatcher = null;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.close(); } catch {}
      if (dispatcher) Promise.resolve(dispatcher.close()).catch(() => {});
      resolve(ok);
    };
    timer = setTimeout(() => finish(false), HANGUP_TIMEOUT_MS);
    try {
      const init = { headers: sessionHeaders(callCredentials, sessionId, voiceSessionId) };
      dispatcher = websocketDispatcher(route);
      if (dispatcher) init.dispatcher = dispatcher;
      socket = new WebSocket(url, init);
    } catch {
      finish(false);
      return;
    }
    socket.addEventListener("open", () => {
      try { socket.send(JSON.stringify({ type: "session.close" })); } catch { finish(false); }
    });
    socket.addEventListener("message", (event) => {
      // Other event types (large audio frames) are ignored without parsing.
      if (typeof event.data !== "string" || !event.data.includes("\"session.closed\"")) return;
      let parsed;
      try { parsed = JSON.parse(event.data); } catch { return; }
      if (parsed?.type === "session.closed") finish(true);
    });
    socket.addEventListener("error", () => finish(false));
    socket.addEventListener("close", () => finish(false));
  });
}
