import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS, getModelKind } from "@/shared/constants/models";
import { AI_PROVIDERS, FREE_PROVIDERS, ALIAS_TO_ID, getProviderAlias } from "@/shared/constants/providers";
import { getProviderConnections, getCombos, getCustomModels, getModelAliases } from "@/lib/localDb";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { codexTranscriptionModels, codexReadAloudModels } from "@/mine/stt/catalog.js";
import { getCapabilitiesForModel, aggregateComboCapabilities } from "open-sse/providers/capabilities.js";

const CHAT_PROVIDERS = new Set(["antigravity", "codex", "opencode"]);
const aliasToId = { ...Object.fromEntries(Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id])), ...ALIAS_TO_ID };
const providerId = (alias) => aliasToId[alias] || alias;
const kindsFor = (id) => AI_PROVIDERS[id]?.serviceKinds || (CHAT_PROVIDERS.has(id) ? ["llm"] : []);

export async function buildModelsList(kindFilter) {
  const [connections, combos, customModels, disabled, aliases] = await Promise.all([
    getProviderConnections(), getCombos(), getCustomModels(), getDisabledModels(), getModelAliases(),
  ]);
  const active = connections.filter((c) => c.isActive !== false && AI_PROVIDERS[c.provider]);
  const entries = new Map();
  const add = (alias, id, kind = "llm") => {
    const owner = providerId(alias);
    if (!AI_PROVIDERS[owner] || !kindsFor(owner).includes(kind)) return;
    if (kind === "llm" && !CHAT_PROVIDERS.has(owner)) return;
    if (!kindFilter.includes(kind) && !(kind === "imageToText" && kindFilter.includes("llm"))) return;
    if (disabled[alias]?.includes(id) || disabled[owner]?.includes(id)) return;
    const entry = { id: `${alias}/${id}`, object: "model", owned_by: alias };
    if (CHAT_PROVIDERS.has(owner)) {
      const custom = customModels.find((model) => providerId(model.providerAlias) === owner && model.id === id);
      const overrides = Object.fromEntries(Object.entries(custom?.caps || {}).filter(([, value]) => typeof value === "boolean"));
      entry.capabilities = { ...getCapabilitiesForModel(owner, id), ...overrides };
      if (Number.isFinite(entry.capabilities?.contextWindow)) entry.context_length = entry.capabilities.contextWindow;
      if (Number.isFinite(entry.capabilities?.maxOutput)) entry.max_completion_tokens = entry.capabilities.maxOutput;
    }
    if (kind === "webSearch" || kind === "webFetch") entry.kind = kind;
    entries.set(entry.id, entry);
  };
  // Match the picker: a provider with stored connections is disabled only
  // when every connection is explicitly inactive. No-auth is not an override.
  const activeIds = new Set(active.map((c) => c.provider));
  const deactivatedIds = new Set(connections.filter((c) => c.isActive === false && !activeIds.has(c.provider)).map((c) => c.provider));
  const noAuthIds = Object.entries(FREE_PROVIDERS).filter(([id, provider]) => AI_PROVIDERS[id] && provider.noAuth && !deactivatedIds.has(id)).map(([id]) => id);
  const ids = (active.length ? [...new Set([...activeIds, ...noAuthIds])] : Object.keys(AI_PROVIDERS))
    .filter((id) => !deactivatedIds.has(id));
  for (const id of ids) {
    const alias = PROVIDER_ID_TO_ALIAS[id] || getProviderAlias(id);
    const conn = active.find((c) => c.provider === id);
    const enabled = conn?.providerSpecificData?.enabledModels;
    for (const model of PROVIDER_MODELS[alias] || []) {
      if (Array.isArray(enabled) && enabled.length && !enabled.includes(model.id)) continue;
      add(alias, model.id, getModelKind(model) || "llm");
    }
    for (const model of customModels) {
      if (providerId(model.providerAlias) === id && model.id) add(alias, model.id, getModelKind(model) || "llm");
    }
    for (const target of Object.values(aliases || {})) {
      if (typeof target !== "string") continue;
      const slash = target.indexOf("/");
      if (slash > 0 && providerId(target.slice(0, slash)) === id) add(alias, target.slice(slash + 1));
    }
    for (const model of Array.isArray(enabled) ? enabled : []) {
      if (typeof model === "string" && model.trim()) add(alias, model.replace(new RegExp(`^${alias}/`), ""));
    }
    if (AI_PROVIDERS[id]?.searchConfig) add(alias, "search", "webSearch");
    if (AI_PROVIDERS[id]?.fetchConfig) add(alias, "fetch", "webFetch");
  }
  const byName = new Map(combos.map((c) => [c.name, c]));
  const validCombo = (combo, seen = new Set()) => {
    if (seen.has(combo.name) || !combo.models?.length) return false;
    const next = new Set(seen).add(combo.name);
    const kind = combo.kind || "llm";
    return combo.models.every((seat) => {
      if (typeof seat !== "string") return false;
      const slash = seat.indexOf("/");
      if (slash < 0) return byName.has(seat) && validCombo(byName.get(seat), next);
      const id = providerId(seat.slice(0, slash));
      return kindsFor(id).includes(kind) && (kind !== "llm" || CHAT_PROVIDERS.has(id));
    });
  };
  const limitsFor = (combo) => {
    const caps = [];
    const scan = (item, seen = new Set()) => {
      if (seen.has(item.name)) return;
      const next = new Set(seen).add(item.name);
      for (const seat of item.models || []) {
        const slash = seat.indexOf("/");
        if (slash > 0) caps.push(getCapabilitiesForModel(providerId(seat.slice(0, slash)), seat.slice(slash + 1)));
        else if (byName.has(seat)) scan(byName.get(seat), next);
      }
    };
    scan(combo);
    const min = (key) => { const values = caps.map((c) => c?.[key]).filter(Number.isFinite); return values.length ? Math.min(...values) : undefined; };
    return { context_length: min("contextWindow"), max_completion_tokens: min("maxOutput") };
  };
  for (const combo of combos) {
    if (!kindFilter.includes(combo.kind || "llm") || !validCombo(combo)) continue;
    const entry = { id: combo.name, object: "model", owned_by: "combo" };
    if (combo.kind === "webSearch" || combo.kind === "webFetch") entry.kind = combo.kind;
    else entry.capabilities = aggregateComboCapabilities(combo.models, Object.fromEntries(combos.map((c) => [c.name, c.models])), (seat) => {
      const slash = seat.indexOf("/");
      return slash > 0 ? getCapabilitiesForModel(providerId(seat.slice(0, slash)), seat.slice(slash + 1)) : null;
    });
    entries.set(entry.id, entry);
    if (!combo.kind || combo.kind === "llm") Object.assign(entry, limitsFor(combo));
  }
  return [
    ...entries.values(),
    ...codexTranscriptionModels(connections, disabled, kindFilter),
    ...codexReadAloudModels(connections, disabled, kindFilter),
  ];
}

export async function OPTIONS() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" } });
}

export async function GET(request) {
  try {
    const kind = request && new URL(request.url).searchParams.get("kind");
    const kinds = kind === "stt" || kind === "tts" ? [kind] : ["llm"];
    return Response.json({ object: "list", data: await buildModelsList(kinds) }, { headers: { "Access-Control-Allow-Origin": "*" } });
  } catch (error) {
    console.error("Error fetching models:", error);
    return Response.json({ error: { message: "Failed to list models", type: "server_error" } }, { status: 500 });
  }
}
