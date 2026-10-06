import { getProviderModels } from "open-sse/config/providerModels.js";

export const VALID_COMBO_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;
export const PRESET_SOURCES = new Set(["antigravity", "codex", "opencode"]);

export function isValidComboPresetName(name) {
  return typeof name === "string" && name.length > 0 && VALID_COMBO_NAME_REGEX.test(name);
}

export function buildPresetItems(source, opts = {}) {
  if (!PRESET_SOURCES.has(source)) return [];
  const alias = { antigravity: "ag", codex: "cx", opencode: "oc" }[source];
  const existing = new Set(opts.existingNames || []);
  return getProviderModels(alias).filter((m) => isValidComboPresetName(m.id)).map((m) => ({
    name: m.id, models: [`${alias}/${m.id}`], exists: existing.has(m.id),
  }));
}
