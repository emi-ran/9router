// Separate from the chat registry: transcription is not a chat completion model.
export const CODEX_TRANSCRIPTION = {
  id: "cx/transcribe", name: "Codex Transcription (OAuth)", kind: "stt", owned_by: "cx",
  endpoint: "/v1/audio/transcriptions", params: ["file", "response_format"],
  options: { response_format: ["json", "text"], max_audio_seconds: 120, max_audio_bytes: 26214400 },
};
export function codexTranscriptionModels(connections, disabled, kinds) {
  if (!kinds.includes("stt") || disabled.cx?.includes("transcribe") || disabled.codex?.includes("transcribe")) return [];
  return connections.some((c) => {
    const enabled = c.providerSpecificData?.enabledModels;
    const allows = !Array.isArray(enabled) || !enabled.length || enabled.some((id) => ["transcribe", "cx/transcribe", "codex/transcribe"].includes(id));
    return c.provider === "codex" && c.isActive !== false && c.authType === "oauth" && allows;
  })
    ? [{ id: CODEX_TRANSCRIPTION.id, object: "model", owned_by: "cx", kind: "stt" }] : [];
}
export function codexTranscriptionInfo(id, kind) {
  return ["cx/transcribe", "codex/transcribe"].includes(id) && (!kind || kind === "stt")
    ? { ...CODEX_TRANSCRIPTION, id } : null;
}
