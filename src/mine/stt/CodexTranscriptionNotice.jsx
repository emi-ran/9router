import React from "react";

export default function CodexTranscriptionNotice() {
  return (
    <section className="rounded-lg border border-border p-4 text-sm" aria-label="Codex transcription">
      <h2 className="font-semibold">Speech to text · Codex OAuth</h2>
      <p className="mt-2 text-text-muted">
        Use your existing Codex OAuth connection with <code>cx/transcribe</code> at{" "}
        <code>/v1/audio/transcriptions</code>. Send multipart <code>file</code> and <code>model</code>.
        Output formats: <code>json</code> (default) or <code>text</code>.
        Maximum 25 MiB / 120 seconds. The server requires ffmpeg on PATH.
        Language, prompt, timestamps and streaming are not supported.
      </p>
    </section>
  );
}
