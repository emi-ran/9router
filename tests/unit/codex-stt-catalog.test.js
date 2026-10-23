import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AI_PROVIDERS, MEDIA_PROVIDER_KINDS, getProvidersByKind } from "../../src/shared/constants/providers.js";

it("exposes only Codex in the restored STT catalog without restoring excluded kinds", () => {
  expect(MEDIA_PROVIDER_KINDS.find((kind) => kind.id === "stt")?.endpoint.path).toBe("/v1/audio/transcriptions");
  expect(getProvidersByKind("stt").map((provider) => provider.id)).toEqual(["codex"]);
  expect(AI_PROVIDERS.codex.serviceKinds).toContain("llm");
  for (const kind of ["embedding", "video"]) {
    expect(MEDIA_PROVIDER_KINDS.some((entry) => entry.id === kind)).toBe(false);
    expect(getProvidersByKind(kind)).toEqual([]);
  }
});

it("keeps Text to speech available without advertising Codex TTS", () => {
  expect(MEDIA_PROVIDER_KINDS.find((kind) => kind.id === "tts")?.endpoint.path).toBe("/v1/audio/speech");
  expect(MEDIA_PROVIDER_KINDS.find((kind) => kind.id === "tts")?.label).toBe("Text to speech");
  expect(AI_PROVIDERS.codex.serviceKinds).not.toContain("tts");
  expect(getProvidersByKind("tts")).toEqual([]);
  const listPage = readFileSync(new URL("../../src/app/(dashboard)/dashboard/media-providers/[kind]/page.js", import.meta.url), "utf8");
  expect(listPage).toContain("const providers = getProvidersByKind(kind)");
  expect(listPage).toContain("connections={connections}");
  const detailPage = readFileSync(new URL("../../src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/page.js", import.meta.url), "utf8");
  expect(detailPage).not.toContain("CodexReadAloudNotice");
  expect(detailPage).not.toContain("TtsExampleCard");
  expect(detailPage).not.toContain('"cx/speak"');
});

it("makes TTS reachable in Media Providers navigation", () => {
  const sidebar = readFileSync(new URL("../../src/shared/components/Sidebar.js", import.meta.url), "utf8");
  expect(sidebar.match(/^const VISIBLE_MEDIA_KINDS = \[([^\r\n]+)\];/m)[1]).toContain('"tts"');
});
