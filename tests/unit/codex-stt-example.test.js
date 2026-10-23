import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildTranscriptionRequest, buildTranscriptionCurl, readTranscriptionResponse } from "../../src/mine/stt/example.js";

it("guards the render-time curl preview and actions while language input is incomplete", () => {
  const source = readFileSync(new URL("../../src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/components/SttExampleCard.js", import.meta.url), "utf8");
  expect(source).toMatch(/const curl = languageValid\s*\? buildTranscriptionCurl/);
  expect(source).toContain("if (!audioFile || running || !languageValid) return;");
  expect(source).toContain("disabled={running || !audioFile || !languageValid}");
  expect(source).toContain("aria-invalid={!languageValid}");
  const file = new File(["audio"], "sample.wav");
  for (const language of ["t", "1", "t1"]) {
    expect(() => buildTranscriptionRequest(file, "json", "", language)).toThrow(/two-letter/i);
  }
});

it("sends the optional language hint with supported Codex multipart fields", () => {
  const file = new File(["audio"], "sample.wav");
  const request = buildTranscriptionRequest(file, "text", "gateway-key", "TR");
  expect(request.method).toBe("POST");
  expect(request.headers).toEqual({ Authorization: "Bearer gateway-key" });
  expect([...request.body.keys()]).toEqual(["file", "model", "response_format", "language"]);
  expect(request.body.get("model")).toBe("cx/transcribe");
  expect(request.body.get("response_format")).toBe("text");
  expect(request.body.get("language")).toBe("tr");
  expect([...buildTranscriptionRequest(file).body.keys()]).toEqual(["file", "model", "response_format"]);
  expect(buildTranscriptionRequest(file, "json", "").headers).toEqual({});
  expect(() => buildTranscriptionRequest(file, "srt", "")).toThrow(/format/i);
  expect(() => buildTranscriptionRequest(file, "json", "", "tr-TR")).toThrow(/two-letter/i);
});

it("generates a copyable shell-safe curl with the optional language hint", () => {
  const curl = buildTranscriptionCurl("https://gateway.example", "a'\"$(touch bad).wav", "text", "TR");
  expect(curl).toContain("https://gateway.example/v1/audio/transcriptions");
  expect(curl).toContain("Authorization: Bearer YOUR_KEY");
  expect(curl).toContain("model=cx/transcribe");
  expect(curl).toContain("response_format=text");
  expect(curl).toContain("language=tr");
  expect(curl).toContain("'\"'\"'");
  for (const field of ["prompt=", "temperature=", "timestamps", "stream="]) expect(curl).not.toContain(field);
  expect(() => buildTranscriptionCurl("https://gateway.example", "audio.wav", "json", "tr-TR")).toThrow(/two-letter/i);
});

it("reads json/text results and surfaces API errors", async () => {
  await expect(readTranscriptionResponse(new Response('{"text":"hello"}', { headers: { "content-type": "application/json" } }))).resolves.toEqual({ text: "hello" });
  await expect(readTranscriptionResponse(new Response("hello"))).resolves.toBe("hello");
  await expect(readTranscriptionResponse(new Response('{"error":{"message":"No active Codex account"}}', { status: 503, headers: { "content-type": "application/json" } }))).rejects.toThrow("No active Codex account");
  await expect(readTranscriptionResponse(new Response("Conversion failed", { status: 500 }))).rejects.toThrow("Conversion failed");
});
