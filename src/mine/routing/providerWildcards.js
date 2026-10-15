import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";

// Exact retained-chat provider wildcards only; never discover retired providers
// from legacy storage or interpret arbitrary glob patterns.
const CHAT_PROVIDER_IDS = ["antigravity", "codex", "opencode"];
const PROVIDERS = new Map(CHAT_PROVIDER_IDS.flatMap((id) => {
  const alias = PROVIDER_ID_TO_ALIAS[id];
  return [[id, { id, alias }], [alias, { id, alias }]];
}));

export function accountAllowsModel(connection, model, provider) {
  const enabled = connection?.providerSpecificData?.enabledModels;
  if (!model || !Array.isArray(enabled) || !enabled.length) return true;
  const resolved = PROVIDERS.get(provider);
  return enabled.includes(model) || enabled.includes(`${resolved?.alias || provider}/${model}`) || enabled.includes(`${resolved?.id || provider}/${model}`);
}

export function expandProviderWildcards(models, { customModels = [], disabled = {}, connections = [], catalog = PROVIDER_MODELS } = {}) {
  const result = [];
  for (const seat of models || []) {
    if (typeof seat !== "string" || !seat.includes("*")) {
      result.push(seat);
      continue;
    }
    const match = /^([^/]+)\/\*$/.exec(seat);
    const provider = match && PROVIDERS.get(match[1]);
    if (!provider) continue;
    const { id, alias } = provider;
    const accounts = connections.filter((c) => PROVIDERS.get(c?.provider)?.id === id);
    const active = accounts.filter((c) => c.isActive !== false);
    // OpenCode is no-auth only in the absence of an explicit stored disable.
    if (!active.length && (id !== "opencode" || accounts.length)) continue;
    const disabledIds = new Set([...(disabled[id] || []), ...(disabled[alias] || [])]);
    const candidates = [
      ...(catalog[alias] || []),
      ...customModels.filter((model) => PROVIDERS.get(model.providerAlias)?.id === id),
    ];
    for (const model of candidates) {
      const kind = model.kind || model.type || "llm";
      if (!["llm", "imageToText"].includes(kind) || typeof model.id !== "string" || !model.id || model.id.includes("*")) continue;
      if (disabledIds.has(model.id)) continue;
      if (active.length && !active.some((account) => accountAllowsModel(account, model.id, id))) continue;
      const value = `${alias}/${model.id}`;
      if (!result.includes(value)) result.push(value);
    }
  }
  return result;
}
