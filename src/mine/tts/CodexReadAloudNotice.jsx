import React from "react";

export default function CodexReadAloudNotice() {
  return (
    <section className="rounded-lg border border-border p-4 text-sm" aria-label="Codex text to speech">
      <h2 className="font-semibold">Text to speech · Codex OAuth</h2>
      <p className="mt-2 text-text-muted">
        Use a Codex OAuth connection with <code>cx/speak</code> at <code>/v1/audio/speech</code>.
        Send JSON with <code>input</code>, <code>voice</code>, <code>speed</code>, and <code>response_format</code>;
        the gateway returns audio bytes. This experimental Read Aloud service uses the account&apos;s configured voice.
      </p>
    </section>
  );
}
