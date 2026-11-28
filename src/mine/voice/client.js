// Browser-side lifecycle for one /v1/live voice call. Framework-free: every
// dependency is injected so the lifecycle can be tested with fakes.
//
// Every end path goes through end(): it stops the mic tracks, closes the peer
// connection and sends exactly one DELETE for the call id, if the server created one.
// A POST that is still in flight is never aborted; its answer is discarded and the
// call is hung up as soon as it resolves.

export const LIVE_ENDPOINT = "/api/v1/live";
export const DATA_CHANNEL_NAME = "oai-events";
export const ICE_GATHER_TIMEOUT_MS = 3_000;
export const CALL_LIMIT_MS = 300_000;
export const DEFAULT_VOICE = "cove";
export const LIVE_MODEL = "cx/voice";
export const VOICE_PATTERN = /^[a-z]{2,32}$/;
export const MAX_INSTRUCTIONS_CHARS = 16_000;

const ACTIVE_PHASES = new Set(["mic", "connecting", "connected"]);

// Same limits as the server (src/mine/voice/validate.js). Returns "" when valid.
export function checkCallOptions({ voice = DEFAULT_VOICE, instructions = "" } = {}) {
  if (typeof voice !== "string" || !VOICE_PATTERN.test(voice)) return "Voice must be 2 to 32 lowercase letters, such as cove";
  if (typeof instructions !== "string" || instructions.length > MAX_INSTRUCTIONS_CHARS) {
    return "Instructions must be at most 16000 characters";
  }
  return "";
}

const SPEAKERS = { user: "You", assistant: "Assistant" };

// One line for the transcript list. Shapes follow the Codex parser for these events.
// input/output_transcript.added are partial deltas (item.text), so only the
// finished turn.done transcript is listed.
export function transcriptLine(event) {
  switch (event?.type) {
    case "turn.done": {
      const speaker = SPEAKERS[event.turn?.role];
      const text = typeof event.turn?.transcript === "string" ? event.turn.transcript.trim() : "";
      return speaker && text ? { speaker, text } : null;
    }
    case "delegation.created": {
      const parts = Array.isArray(event.item?.content) ? event.item.content : [];
      const text = parts.map((part) => part?.text ?? "").join("").trim();
      return text ? { speaker: "Delegation", text } : null;
    }
    case "error":
      return { speaker: "Error", text: event.error?.message || event.message || "Unknown error" };
    default:
      return null;
  }
}

function micMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "Microphone access was denied.";
  return error?.message || "Microphone is not available.";
}

function waitForIce(peer, later, cancel) {
  return new Promise((resolve) => {
    if (peer.iceGatheringState === "complete") {
      resolve();
      return;
    }
    let timer = null;
    const finish = () => {
      if (timer !== null) cancel(timer);
      peer.onicegatheringstatechange = null;
      resolve();
    };
    timer = later(finish, ICE_GATHER_TIMEOUT_MS);
    peer.onicegatheringstatechange = () => {
      if (peer.iceGatheringState === "complete") finish();
    };
  });
}

export function createLiveCall({
  fetch: send,
  RTCPeerConnection: PeerConnection,
  getUserMedia,
  setTimeout: later = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: cancel = (id) => globalThis.clearTimeout(id),
  now = () => Date.now(),
  onUpdate = () => {},
  onRemoteStream = () => {},
  onEvent = () => {},
} = {}) {
  let phase = "idle"; // idle | mic | connecting | connected | ended
  let reason = "";
  let error = "";
  let expiresAt = null; // unix seconds on the local clock
  let creating = false; // POST /v1/live in flight
  let session = 0; // bumped by every start and end; async steps compare against it
  let callId = null;
  let callKey = null;
  let stream = null;
  let peer = null;
  let timer = null;

  const snapshot = () => ({
    phase,
    reason,
    error,
    expiresAt,
    canStart: !creating && !ACTIVE_PHASES.has(phase),
    canEnd: ACTIVE_PHASES.has(phase),
  });
  const emit = () => onUpdate(snapshot());

  function releaseLocal() {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    if (peer) {
      const closing = peer;
      peer = null;
      closing.onconnectionstatechange = null;
      closing.ontrack = null;
      closing.close();
    }
    onRemoteStream(null);
  }

  async function hangUp(id, key, keepalive, goneIsFine = false) {
    try {
      const res = await send(`${LIVE_ENDPOINT}/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${key}` },
        keepalive,
      });
      if (res.ok || (goneIsFine && res.status === 404)) return "";
      const body = await res.json?.().catch?.(() => null);
      return `Call may still be open on the server (${body?.error?.message || `HTTP ${res.status}`})`;
    } catch (failure) {
      return `Call may still be open on the server (${failure?.message || "network error"})`;
    }
  }

  // The single end path. No-op unless a call is active, so it cannot send two DELETEs.
  async function end(why, { keepalive = false, message = "" } = {}) {
    if (!ACTIVE_PHASES.has(phase)) return;
    const id = callId;
    const key = callKey;
    callId = null;
    callKey = null;
    session += 1;
    phase = "ended";
    reason = why;
    error = message;
    releaseLocal();
    emit();
    if (!id) return;
    // At the time limit the server may have removed the call already (404).
    const failure = await hangUp(id, key, keepalive, why === "time limit reached");
    // After session.closed the upstream call is over, so a failed DELETE is no warning.
    if (failure && why !== "session closed" && phase === "ended") {
      error = failure;
      emit();
    }
  }

  function handleDataMessage(mine, raw) {
    if (mine !== session) return;
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    if (!event || typeof event !== "object") return;
    if (event.type === "session.closed") {
      end("session closed");
      return;
    }
    const line = transcriptLine(event);
    if (line) onEvent(line);
  }

  async function start({ apiKey = "", voice = DEFAULT_VOICE, instructions = "" } = {}) {
    if (creating || ACTIVE_PHASES.has(phase)) return; // a second Start does nothing
    const invalid = checkCallOptions({ voice, instructions });
    if (invalid) {
      phase = "ended";
      reason = "error";
      error = invalid;
      emit();
      return;
    }
    if (!apiKey) {
      phase = "ended";
      reason = "error";
      error = "API key is required";
      emit();
      return;
    }

    const mine = ++session;
    phase = "mic";
    reason = "";
    error = "";
    expiresAt = null;
    emit();

    // 1. Microphone first. No request is sent unless it is granted.
    let micStream;
    try {
      if (typeof getUserMedia !== "function") {
        throw new Error("Microphone is not available. Open the dashboard over HTTPS or localhost.");
      }
      micStream = await getUserMedia({ audio: true });
    } catch (micError) {
      if (mine === session) await end("error", { message: micMessage(micError) });
      return;
    }
    if (mine !== session) {
      // Ended while the permission prompt was open: release the stream, send nothing.
      for (const track of micStream?.getTracks?.() ?? []) track.stop();
      return;
    }
    stream = micStream;

    // 2. Peer connection, data channel created before the offer, ICE gathered (max 3 s).
    phase = "connecting";
    emit();
    let sdp = "";
    try {
      const connection = new PeerConnection();
      peer = connection;
      for (const track of stream.getTracks()) connection.addTrack(track, stream);
      const channel = connection.createDataChannel(DATA_CHANNEL_NAME);
      channel.onmessage = (event) => handleDataMessage(mine, event.data);
      connection.ontrack = (event) => onRemoteStream(event.streams?.[0] ?? null);
      connection.onconnectionstatechange = () => {
        const state = connection.connectionState;
        if (state === "failed" || state === "closed") end(`connection ${state}`);
      };
      await connection.setLocalDescription(await connection.createOffer());
      await waitForIce(connection, later, cancel);
      sdp = connection.localDescription?.sdp || "";
    } catch (setupError) {
      if (mine === session) await end("error", { message: setupError?.message || "Could not prepare the call" });
      return;
    }
    if (mine !== session) return; // end() already released everything
    if (!sdp) {
      await end("error", { message: "Could not create an offer" });
      return;
    }

    // 3. POST the offer. Never aborted: if the call ends meanwhile, hang up on resolve.
    const body = { model: LIVE_MODEL, sdp, voice };
    if (instructions) body.instructions = instructions;
    let data = null;
    let failure = "";
    creating = true;
    try {
      const res = await send(LIVE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      const payload = await res.json?.().catch?.(() => null);
      if (!res.ok) failure = payload?.error?.message || `HTTP ${res.status}`;
      else if (!payload || typeof payload.id !== "string" || typeof payload.sdp !== "string") failure = "Unexpected response from the server";
      else data = payload;
    } catch (requestError) {
      failure = requestError?.message || "Network error";
    } finally {
      creating = false;
    }

    if (mine !== session) {
      emit(); // the request is over, so Start becomes available again
      if (data) {
        const hangupFailure = await hangUp(data.id, apiKey, true);
        if (hangupFailure && mine + 1 === session) {
          error = hangupFailure;
          emit();
        }
      }
      return;
    }
    if (!data) {
      await end("error", { message: failure });
      return;
    }

    // 4. The call exists now: from here on every end path sends its DELETE.
    callId = data.id;
    callKey = apiKey;
    // Counted on the local clock: comparing the server's expires_at with a skewed
    // browser clock would cut calls short. The server enforces its own limit.
    expiresAt = Math.floor((now() + CALL_LIMIT_MS) / 1000);
    try {
      await peer.setRemoteDescription({ type: "answer", sdp: data.sdp });
    } catch (answerError) {
      if (mine === session) await end("error", { message: answerError?.message || "Could not apply the answer" });
      return;
    }
    if (mine !== session) return;

    phase = "connected";
    timer = later(() => { timer = null; end("time limit reached"); }, CALL_LIMIT_MS);
    emit();
  }

  return {
    start,
    end: (why = "ended by user", options) => end(why, options),
    snapshot,
  };
}
