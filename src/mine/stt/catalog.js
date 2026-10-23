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

export const CODEX_READ_ALOUD = {
  id: "cx/speak", name: "Codex Read Aloud (Experimental)", kind: "tts", owned_by: "cx",
  endpoint: "/v1/audio/speech", params: ["input", "pronunciation_language", "speed"],
  options: { voice: ["alloy"], response_format: ["mp3"], max_characters: 4000, speed: { min: 0.5, max: 2 } },
};
export function codexReadAloudModels(connections, disabled, kinds) {
  if (!kinds.includes("tts") || disabled.cx?.some((id) => ["speak", "cx/speak"].includes(id)) || disabled.codex?.some((id) => ["speak", "cx/speak", "codex/speak"].includes(id))) return [];
  return connections.some((c) => c.provider === "codex" && c.isActive !== false && c.authType === "oauth"
    && codexConnectionAllows(c, "speak"))
    ? [{ id: CODEX_READ_ALOUD.id, object: "model", owned_by: "cx", kind: "tts" }] : [];
}
export function codexReadAloudInfo(id, kind) {
  return ["cx/speak", "codex/speak"].includes(id) && (!kind || kind === "tts") ? { ...CODEX_READ_ALOUD, id } : null;
}
export function codexConnectionAllows(connection, model) {
  const enabled = connection?.providerSpecificData?.enabledModels;
  return !Array.isArray(enabled) || !enabled.length || enabled.some((id) => [model, `cx/${model}`, `codex/${model}`].includes(id));
}
