import {
  BODY_TIMEOUT_MS, DEFAULT_INSTRUCTIONS, DEFAULT_VOICE, MAX_BODY_BYTES, MAX_CONTEXT_CHARS,
  MAX_CONTEXT_ITEMS, MAX_INSTRUCTIONS_CHARS, UPSTREAM_MODEL, VOICE_MODELS, VOICE_PATTERN,
} from "./constants.js";

export class VoiceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ALLOWED_FIELDS = new Set(["sdp", "model", "voice", "instructions", "context"]);
const ALLOWED_ITEM_FIELDS = new Set(["role", "text"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Bounded body read: Content-Length is only a fast reject, the stream is counted.
export async function readJsonBody(request) {
  const type = request.headers.get("content-type") || "";
  if (!/^application\/json\s*(;|$)/i.test(type)) throw new VoiceError(400, "Expected application/json body");
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > MAX_BODY_BYTES) throw new VoiceError(413, "Request body exceeds 256 KB");
  if (!request.body) throw new VoiceError(400, "Missing request body");

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(BODY_TIMEOUT_MS)]);
  const reader = request.body.getReader();
  const onAbort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", onAbort, { once: true });
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new VoiceError(408, "Request body timed out");
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new VoiceError(413, "Request body exceeds 256 KB");
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => {});
  }
  try {
    return JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
  } catch {
    throw new VoiceError(400, "Invalid JSON body");
  }
}

export function parseCreateBody(input) {
  if (!isPlainObject(input)) throw new VoiceError(400, "Request body must be a JSON object");
  for (const key of Object.keys(input)) {
    if (!ALLOWED_FIELDS.has(key)) throw new VoiceError(400, "Unsupported field in request body");
  }
  const { sdp, model, voice, instructions, context } = input;
  if (typeof sdp !== "string" || !sdp.startsWith("v=0")) throw new VoiceError(400, "sdp must be an SDP offer");
  if (model !== undefined && !VOICE_MODELS.has(model)) throw new VoiceError(400, "Use model cx/voice");
  if (voice !== undefined && (typeof voice !== "string" || !VOICE_PATTERN.test(voice))) throw new VoiceError(400, "Invalid voice");
  if (instructions !== undefined && (typeof instructions !== "string" || instructions.length > MAX_INSTRUCTIONS_CHARS)) {
    throw new VoiceError(400, "instructions must be a string of at most 16000 characters");
  }
  if (context !== undefined) {
    if (!Array.isArray(context) || context.length > MAX_CONTEXT_ITEMS) throw new VoiceError(400, "context must be an array of at most 50 items");
    let total = 0;
    for (const item of context) {
      if (!isPlainObject(item) || Object.keys(item).some((key) => !ALLOWED_ITEM_FIELDS.has(key))
          || !["user", "assistant"].includes(item.role) || typeof item.text !== "string") {
        throw new VoiceError(400, "Invalid context item");
      }
      total += item.text.length;
    }
    if (total > MAX_CONTEXT_CHARS) throw new VoiceError(400, "context exceeds 16000 characters");
  }
  return {
    sdp,
    voice: voice ?? DEFAULT_VOICE,
    instructions: instructions || "",
    context: context || [],
  };
}

// Upstream ignores session.instructions for the real behaviour; the client's
// instructions and the context travel as initial_items.
export function buildUpstreamBody(parsed) {
  const initialItems = [];
  if (parsed.instructions) {
    initialItems.push({ type: "message", role: "developer", content: [{ type: "input_text", text: parsed.instructions }] });
  }
  for (const item of parsed.context) {
    initialItems.push(item.role === "user"
      ? { type: "message", role: "user", content: [{ type: "input_text", text: item.text }] }
      : { type: "message", role: "assistant", content: [{ type: "output_text", text: item.text }] });
  }
  const session = {
    model: UPSTREAM_MODEL,
    instructions: parsed.instructions || DEFAULT_INSTRUCTIONS,
    audio: { output: { voice: parsed.voice } },
    delegation: { type: "client" },
  };
  if (initialItems.length) session.initial_items = initialItems;
  return { sdp: parsed.sdp, session };
}
