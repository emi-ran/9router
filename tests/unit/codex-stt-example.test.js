import { expect, it } from "vitest";
import { buildTranscriptionRequest, buildTranscriptionCurl, readTranscriptionResponse } from "../../src/mine/stt/example.js";

it("sends only the supported Codex multipart fields and a gateway API key", () => {
  const file = new File(["audio"], "sample.wav");
  const request = buildTranscriptionRequest(file, "text", "gateway-key");
  expect(request.method).toBe("POST");
  expect(request.headers).toEqual({ Authorization: "Bearer gateway-key" });
  expect([...request.body.keys()]).toEqual(["file", "model", "response_format"]);
  expect(request.body.get("model")).toBe("cx/transcribe");
  expect(request.body.get("response_format")).toBe("text");
  expect(buildTranscriptionRequest(file, "json", "").headers).toEqual({});
  expect(() => buildTranscriptionRequest(file, "srt", "")).toThrow(/format/i);
});

it("generates a copyable shell-safe curl using gateway auth, not OAuth tokens", () => {
  const curl = buildTranscriptionCurl("https://gateway.example", "a'\"$(touch bad).wav", "text");
  expect(curl).toContain("https://gateway.example/v1/audio/transcriptions");
  expect(curl).toContain("Authorization: Bearer YOUR_KEY");
  expect(curl).toContain("model=cx/transcribe");
  expect(curl).toContain("response_format=text");
  expect(curl).toContain("'\"'\"'");
  for (const field of ["language=", "prompt=", "temperature=", "timestamps", "stream="]) expect(curl).not.toContain(field);
});

it("reads json/text results and surfaces API errors", async () => {
  await expect(readTranscriptionResponse(new Response('{"text":"hello"}', { headers: { "content-type": "application/json" } }))).resolves.toEqual({ text: "hello" });
  await expect(readTranscriptionResponse(new Response("hello"))).resolves.toBe("hello");
  await expect(readTranscriptionResponse(new Response('{"error":{"message":"No active Codex account"}}', { status: 503, headers: { "content-type": "application/json" } }))).rejects.toThrow("No active Codex account");
  await expect(readTranscriptionResponse(new Response("Conversion failed", { status: 500 }))).rejects.toThrow("Conversion failed");
});
