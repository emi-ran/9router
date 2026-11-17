// Fork policy for media service kinds: this is the single source of truth.
//
// The upstream provider registry (open-sse/providers/registry/*.js) keeps its
// original `serviceKinds`; we narrow the *effective* kinds per provider here so
// upstream can be merged without touching dozens of registry files.
//
// Kinds missing from this map are unmanaged (llm, tts, stt, music, ...).
// A provider still keeps every other kind it declares; only the listed kinds
// are restricted, and legacy stored connections stay physically intact.
export const PROVIDER_KIND_ALLOWLIST = {
  image: ["codex", "antigravity"],
  webSearch: ["brave-search", "exa", "tinyfish", "tavily"],
  webFetch: ["brave-search", "exa", "tinyfish", "tavily"],
  // Image-to-text was removed from this fork; no provider may advertise it.
  imageToText: [],
};

const ALLOWED_BY_KIND = new Map(
  Object.entries(PROVIDER_KIND_ALLOWLIST).map(([kind, providerIds]) => [kind, new Set(providerIds)]),
);

/** True when `providerId` may expose `kind` (unmanaged kinds always pass). */
export function isServiceKindAllowed(providerId, kind) {
  const allowed = ALLOWED_BY_KIND.get(kind);
  return !allowed || allowed.has(providerId);
}

/** Drop restricted kinds from a provider's registry `serviceKinds`. */
export function filterServiceKinds(providerId, kinds) {
  if (!Array.isArray(kinds)) return kinds;
  return kinds.filter((kind) => isServiceKindAllowed(providerId, kind));
}
