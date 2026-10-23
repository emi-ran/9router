import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS, getProvidersByKind } from "../../src/shared/constants/providers.js";
import { buildSpeechRequest, buildSpeechCurl, readSpeechResponse } from "../../src/mine/tts/example.js";

it("exposes Codex as a TTS-capable media provider without enabling retired providers", () => {
  expect(MEDIA_PROVIDER_KINDS.some(({ id }) => id === "tts")).toBe(true);
  expect(AI_PROVIDERS.codex.serviceKinds).toContain("tts");
  expect(getProvidersByKind("tts").map(({ id }) => id)).toEqual(["codex"]);
});

it("builds the Codex speech request and a curl example", () => {
  const init = buildSpeechRequest({ input: "Hello", language: "en-US", apiKey: "gateway-test" });
  expect(init.method).toBe("POST");
  expect(init.headers.Authorization).toBe("Bearer gateway-test");
  expect(JSON.parse(init.body)).toEqual({ model: "cx/speak", input: "Hello", pronunciation_language: "en-US", response_format: "mp3", speed: 1 });
  expect(buildSpeechCurl("https://example.test", "Hello", "en-US")).toContain("/v1/audio/speech");
});

it("returns audio bytes from a successful speech response and reports API errors", async () => {
  const blob = new Blob(["ID3audio"], { type: "audio/mpeg" });
  const result = await readSpeechResponse(new Response(blob, { headers: { "content-type": "audio/mpeg" } }));
  expect(result.type).toBe("audio/mpeg");
  const error = await readSpeechResponse(Response.json({ error: { message: "Unavailable" } }, { status: 503 })).catch((e) => e);
  expect(error.message).toBe("Unavailable");
});

it("renders the Codex TTS detail page with connections, model, notice and runnable example", () => {
  const page = readFileSync(new URL("../../src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/page.js", import.meta.url), "utf8");
  expect(page).toContain('kind === "tts" && id === "codex"');
  expect(page).toContain("CodexReadAloudNotice");
  expect(page).toContain("TtsExampleCard");
  expect(page).toContain("ConnectionsCard");
});

it("uses the shared provider-card and connection-count flow for TTS", () => {
  const page = readFileSync(new URL("../../src/app/(dashboard)/dashboard/media-providers/[kind]/page.js", import.meta.url), "utf8");
  expect(page).toContain("const providers = getProvidersByKind(kind)");
  expect(page).toContain("provider={provider}");
  expect(page).toContain("connections={connections}");
  expect(page).toContain("const allProviders = [...providers, ...customProviders]");
  expect(page).not.toContain('kind === "tts" ? [] :');
  expect(page).not.toContain('if (kind === "tts") {');
});
