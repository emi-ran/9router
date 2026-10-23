# Codex TTS removal — 2026-10-23

Removed experimental Codex Read Aloud provider, `cx/speak`/`codex/speak`
discovery, example UI and `/api/v1/audio/speech` handler at user request.
Direct upstream requests returned HTTP 403 HTML with Cloudflare challenge markers;
header parity did not resolve access. No working gateway TTS implementation was
established. Temporary diagnostics and Codex-only TTS tests were removed with it.

The generic Text to speech navigation/category remains for a future provider;
it currently has no providers. No replacement provider was added. Codex chat,
OAuth accounts and STT (`cx/transcribe`) remain unchanged. Stored account data,
legacy model preferences and cooldown values are not deleted or rewritten.

Passive desktop Read Aloud capture observed no matching speech request in the
selected webview during its bounded window; it did not establish the desktop
network flow. Debug-mode Codex should be closed and reopened normally after
inspection to remove the temporary loopback debugging endpoint.
