import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AI_PROVIDERS, MEDIA_PROVIDER_KINDS, getProvidersByKind } from "../../src/shared/constants/providers.js";

it("exposes only Codex in the restored STT catalog without restoring excluded kinds", () => {
  expect(MEDIA_PROVIDER_KINDS.find((kind) => kind.id === "stt")?.endpoint.path).toBe("/v1/audio/transcriptions");
  expect(getProvidersByKind("stt").map((provider) => provider.id)).toEqual(["codex"]);
  expect(AI_PROVIDERS.codex.serviceKinds).toContain("llm");
  for (const kind of ["tts", "embedding", "video"]) {
    expect(MEDIA_PROVIDER_KINDS.some((entry) => entry.id === kind)).toBe(false);
    expect(getProvidersByKind(kind)).toEqual([]);
  }
});

it("makes STT reachable in Media Providers navigation", () => {
  const sidebar = readFileSync(new URL("../../src/shared/components/Sidebar.js", import.meta.url), "utf8");
  expect(sidebar.match(/const VISIBLE_MEDIA_KINDS = \[([^\n]+)\];\n\/\/ Combined/)[1]).toContain('"stt"');
});
