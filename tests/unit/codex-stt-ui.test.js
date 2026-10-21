import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CodexTranscriptionNotice from "../../src/mine/stt/CodexTranscriptionNotice.jsx";
it("offers Codex transcription instructions without restoring other media providers", () => {
  const html = renderToStaticMarkup(createElement(CodexTranscriptionNotice));
  for (const text of ["cx/transcribe", "/v1/audio/transcriptions", "OAuth", "ffmpeg", "120 seconds", "json", "text"]) expect(html).toContain(text);
  expect(html).not.toContain("whisper-1");
});
