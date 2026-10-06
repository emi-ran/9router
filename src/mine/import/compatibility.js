import { PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";
import { AI_PROVIDERS, ALIAS_TO_ID } from "@/shared/constants/providers.js";
import { isRetiredSetting } from "@/lib/db/repos/settingsRepo.js";

const CHAT_PROVIDERS = new Set(["antigravity", "codex", "opencode"]);
const RETAINED_PREFIXES = new Set(["ag", "antigravity", "cx", "codex", "oc", "opencode"]);
const DEFAULT_FALLBACK_MODEL = "oc/mimo-v2.6-flash-free";
const ALLOWED_MEDIA_KINDS = new Set(["image", "imageToText", "webSearch", "webFetch", "music"]);
const MAX_COMBO_NESTING_DEPTH = 20;

// Canonical alias map for retained providers: ag, cx, oc
const CANONICAL_ALIASES = {
  ag: "ag",
  antigravity: "ag",
  cx: "cx",
  codex: "cx",
  oc: "oc",
  opencode: "oc",
};

const aliasToId = {
  ...Object.fromEntries(Object.entries(PROVIDER_ID_TO_ALIAS).map(([id, alias]) => [alias, id])),
  ...ALIAS_TO_ID,
};

export function resolveProviderId(aliasOrId) {
  if (!aliasOrId || typeof aliasOrId !== "string") return null;
  return aliasToId[aliasOrId] || aliasOrId;
}

export function getProviderKinds(provId) {
  if (!provId) return [];
  const p = AI_PROVIDERS[provId];
  if (p?.serviceKinds && Array.isArray(p.serviceKinds)) return p.serviceKinds;
  if (CHAT_PROVIDERS.has(provId)) return ["llm"];
  return p?.serviceKinds || [];
}

export function isProviderSupported(provId) {
  if (!provId || typeof provId !== "string") return false;
  const canonicalId = resolveProviderId(provId);
  if (!AI_PROVIDERS[canonicalId]) return false;
  const kinds = getProviderKinds(canonicalId);
  if (CHAT_PROVIDERS.has(canonicalId)) return true;
  return kinds.some((k) => ALLOWED_MEDIA_KINDS.has(k));
}

// Canonicalize model prefix: e.g. "codex/gpt-5.4" -> "cx/gpt-5.4", "antigravity/gemini" -> "ag/gemini"
export function canonicalizeModelId(modelStr) {
  if (typeof modelStr !== "string") return modelStr;
  const slash = modelStr.indexOf("/");
  if (slash <= 0) return modelStr;
  const prefix = modelStr.slice(0, slash);
  const rest = modelStr.slice(slash + 1);
  if (CANONICAL_ALIASES[prefix]) {
    return `${CANONICAL_ALIASES[prefix]}/${rest}`;
  }
  return modelStr;
}

function canonicalizeSeat(seat) {
  if (typeof seat === "string") return canonicalizeModelId(seat);
  if (seat && typeof seat === "object") {
    if (typeof seat.model === "string") {
      return { ...seat, model: canonicalizeModelId(seat.model) };
    }
    if (typeof seat.id === "string") {
      return { ...seat, id: canonicalizeModelId(seat.id) };
    }
  }
  return seat;
}

function getSeatModelString(seat) {
  if (typeof seat === "string") return seat;
  if (seat && typeof seat === "object") {
    if (typeof seat.model === "string") return seat.model;
    if (typeof seat.id === "string") return seat.id;
  }
  return null;
}

function isPlainObject(val) {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

export function normalizeBasicImport(payload) {
  if (!isPlainObject(payload)) {
    throw new Error("Invalid database payload: expected object");
  }

  const summary = {
    providerConnections: { total: 0, kept: 0, dropped: 0 },
    providerNodes: { total: 0, kept: 0, dropped: 0 },
    proxyPools: { total: 0, kept: 0, dropped: 0 },
    apiKeys: { total: 0, kept: 0, dropped: 0 },
    combos: { total: 0, kept: 0, dropped: 0 },
    modelAliases: { total: 0, kept: 0, dropped: 0 },
    customModels: { total: 0, kept: 0, dropped: 0 },
    pricing: { total: 0, kept: 0, dropped: 0 },
    mitmAlias: { total: 0, kept: 0, dropped: 0 },
  };

  // 1. Structure validation
  if (payload.settings !== undefined && !isPlainObject(payload.settings)) {
    throw new Error("Invalid settings: expected object");
  }
  if (payload.providerConnections !== undefined && !Array.isArray(payload.providerConnections)) {
    throw new Error("Invalid providerConnections: expected array");
  }
  if (payload.providerNodes !== undefined && !Array.isArray(payload.providerNodes)) {
    throw new Error("Invalid providerNodes: expected array");
  }
  if (payload.proxyPools !== undefined && !Array.isArray(payload.proxyPools)) {
    throw new Error("Invalid proxyPools: expected array");
  }
  if (payload.apiKeys !== undefined && !Array.isArray(payload.apiKeys)) {
    throw new Error("Invalid apiKeys: expected array");
  }
  if (payload.combos !== undefined && !Array.isArray(payload.combos)) {
    throw new Error("Invalid combos: expected array");
  }
  if (payload.customModels !== undefined && !Array.isArray(payload.customModels)) {
    throw new Error("Invalid customModels: expected array");
  }
  if (payload.modelAliases !== undefined && !isPlainObject(payload.modelAliases)) {
    throw new Error("Invalid modelAliases: expected object");
  }
  if (payload.pricing !== undefined && !isPlainObject(payload.pricing)) {
    throw new Error("Invalid pricing: expected object");
  }
  if (payload.mitmAlias !== undefined && !isPlainObject(payload.mitmAlias)) {
    throw new Error("Invalid mitmAlias: expected object");
  }

  // 2. Settings normalization
  let normalizedSettings = undefined;
  if (payload.settings !== undefined) {
    const cleanSettings = {};
    for (const [k, v] of Object.entries(payload.settings)) {
      if (isRetiredSetting(k)) continue;
      if (k === "language" || k === "locale") {
        cleanSettings[k] = "en";
      } else {
        cleanSettings[k] = v;
      }
    }

    if (cleanSettings.capacityAdapter !== undefined) {
      if (!isPlainObject(cleanSettings.capacityAdapter)) {
        throw new Error("Invalid capacityAdapter setting: expected object");
      }
      const ca = {};
      for (const [capKey, entry] of Object.entries(cleanSettings.capacityAdapter)) {
        if (Array.isArray(entry)) {
          // Legacy array format: [{ model, enabled }] or [ "model" ]
          const filteredArray = entry
            .filter((e) => e && (typeof e === "string" || (typeof e === "object" && e.enabled !== false)))
            .map((e) => {
              const rawM = typeof e === "string" ? e : e?.model;
              const upgraded = rawM === "oc/mimo-v2.5-free" ? DEFAULT_FALLBACK_MODEL : canonicalizeModelId(rawM);
              if (typeof e === "string") return upgraded;
              return { ...e, model: upgraded };
            })
            .filter((e) => {
              const m = typeof e === "string" ? e : e?.model;
              if (typeof m !== "string") return false;
              const slash = m.indexOf("/");
              return slash > 0 && RETAINED_PREFIXES.has(m.slice(0, slash));
            });
          ca[capKey] = filteredArray;
        } else if (isPlainObject(entry)) {
          let models = Array.isArray(entry.models) ? entry.models : [];
          models = models
            .map((m) => (m === "oc/mimo-v2.5-free" ? DEFAULT_FALLBACK_MODEL : canonicalizeModelId(m)))
            .filter((m) => {
              if (typeof m !== "string") return false;
              const slash = m.indexOf("/");
              return slash > 0 && RETAINED_PREFIXES.has(m.slice(0, slash));
            });
          ca[capKey] = { ...entry, models };
        } else {
          throw new Error(`Invalid capacityAdapter entry for ${capKey}`);
        }
      }
      cleanSettings.capacityAdapter = ca;
    }

    normalizedSettings = cleanSettings;
  }

  // 3. Provider connections
  const normalizedConnections = [];
  const connIds = new Set();
  const rawConnections = payload.providerConnections || [];
  summary.providerConnections.total = rawConnections.length;
  for (const c of rawConnections) {
    if (!isPlainObject(c) || typeof c.id !== "string" || !c.id.trim() || typeof c.provider !== "string" || !c.provider.trim()) {
      throw new Error("Malformed providerConnection item: missing or invalid id/provider");
    }
    if (connIds.has(c.id)) {
      throw new Error(`Duplicate providerConnection id: ${c.id}`);
    }
    connIds.add(c.id);

    const provId = resolveProviderId(c.provider);
    if (!isProviderSupported(provId)) {
      summary.providerConnections.dropped++;
      continue;
    }

    const cleanConn = {
      ...c,
      provider: provId,
    };

    if (cleanConn.providerSpecificData?.enabledModels && Array.isArray(cleanConn.providerSpecificData.enabledModels)) {
      cleanConn.providerSpecificData = {
        ...cleanConn.providerSpecificData,
        enabledModels: cleanConn.providerSpecificData.enabledModels.map((m) =>
          typeof m === "string" ? canonicalizeModelId(m) : m
        ),
      };
    }

    normalizedConnections.push(cleanConn);
    summary.providerConnections.kept++;
  }

  // 4. Provider nodes
  const normalizedNodes = [];
  const nodeIds = new Set();
  const rawNodes = payload.providerNodes || [];
  summary.providerNodes.total = rawNodes.length;
  for (const n of rawNodes) {
    if (!isPlainObject(n) || typeof n.id !== "string" || !n.id.trim()) {
      throw new Error("Malformed providerNode item: missing or invalid id");
    }
    if (nodeIds.has(n.id)) {
      throw new Error(`Duplicate providerNode id: ${n.id}`);
    }
    nodeIds.add(n.id);

    const provId = resolveProviderId(n.type || n.id);
    if (!isProviderSupported(provId)) {
      summary.providerNodes.dropped++;
      continue;
    }
    normalizedNodes.push(n);
    summary.providerNodes.kept++;
  }

  // 5. Proxy pools
  const normalizedProxyPools = [];
  const poolIds = new Set();
  const rawPools = payload.proxyPools || [];
  summary.proxyPools.total = rawPools.length;
  for (const p of rawPools) {
    if (!isPlainObject(p) || typeof p.id !== "string" || !p.id.trim()) {
      throw new Error("Malformed proxyPool item: missing or invalid id");
    }
    if (poolIds.has(p.id)) {
      throw new Error(`Duplicate proxyPool id: ${p.id}`);
    }
    poolIds.add(p.id);
    normalizedProxyPools.push(p);
    summary.proxyPools.kept++;
  }

  // 6. API keys
  const normalizedApiKeys = [];
  const keyIds = new Set();
  const keyStrings = new Set();
  const rawKeys = payload.apiKeys || [];
  summary.apiKeys.total = rawKeys.length;
  for (const k of rawKeys) {
    if (!isPlainObject(k) || typeof k.id !== "string" || !k.id.trim() || typeof k.key !== "string" || !k.key.trim()) {
      throw new Error("Malformed apiKey item: missing or invalid id/key");
    }
    if (keyIds.has(k.id) || keyStrings.has(k.key)) {
      throw new Error(`Duplicate apiKey id or key: ${k.id}`);
    }
    keyIds.add(k.id);
    keyStrings.add(k.key);
    normalizedApiKeys.push(k);
    summary.apiKeys.kept++;
  }

  // 7. Custom models
  const normalizedCustomModels = [];
  const customModelKeys = new Set();
  const rawCustomModels = payload.customModels || [];
  summary.customModels.total = rawCustomModels.length;
  for (const m of rawCustomModels) {
    if (!isPlainObject(m) || typeof m.providerAlias !== "string" || !m.providerAlias.trim() || typeof m.id !== "string" || !m.id.trim()) {
      throw new Error("Malformed customModel item: missing or invalid providerAlias/id");
    }
    const provId = resolveProviderId(m.providerAlias);
    const kind = m.type || "llm";

    if (!isProviderSupported(provId) || (!ALLOWED_MEDIA_KINDS.has(kind) && kind !== "llm")) {
      summary.customModels.dropped++;
      continue;
    }
    if (kind === "llm" && !CHAT_PROVIDERS.has(provId)) {
      summary.customModels.dropped++;
      continue;
    }
    if (kind !== "llm" && !getProviderKinds(provId).includes(kind)) {
      summary.customModels.dropped++;
      continue;
    }

    const canonicalAlias = CANONICAL_ALIASES[m.providerAlias] || m.providerAlias;
    const dedupeKey = `${canonicalAlias}|${m.id}|${kind}`;
    if (customModelKeys.has(dedupeKey)) {
      throw new Error(`Duplicate customModel: ${dedupeKey}`);
    }
    customModelKeys.add(dedupeKey);

    normalizedCustomModels.push({
      ...m,
      providerAlias: canonicalAlias,
    });
    summary.customModels.kept++;
  }

  // 8. Model aliases: resolve alias chains to canonical provider/model, drop dangling or bare provider strings
  const normalizedModelAliases = {};
  const rawModelAliases = payload.modelAliases || {};
  summary.modelAliases.total = Object.keys(rawModelAliases).length;

  function resolveAliasTarget(val, seen = new Set()) {
    if (!val || typeof val !== "string" || !val.trim() || seen.has(val) || seen.size > 10) {
      return null;
    }
    seen.add(val);
    const slash = val.indexOf("/");
    if (slash > 0) {
      const pfx = val.slice(0, slash);
      const provId = resolveProviderId(pfx);
      if (isProviderSupported(provId)) {
        return canonicalizeModelId(val);
      }
      return null;
    }
    // Unslashed target: check if it chains to another alias in rawModelAliases
    if (rawModelAliases[val] && typeof rawModelAliases[val] === "string") {
      return resolveAliasTarget(rawModelAliases[val], seen);
    }
    // Bare provider name (e.g. 'codex') or dangling unslashed string is not a valid model target
    return null;
  }

  for (const [alias, target] of Object.entries(rawModelAliases)) {
    const resolved = resolveAliasTarget(target);
    if (!resolved) {
      summary.modelAliases.dropped++;
      continue;
    }
    normalizedModelAliases[alias] = resolved;
    summary.modelAliases.kept++;
  }

  // 9. Pricing
  const normalizedPricing = {};
  const rawPricing = payload.pricing || {};
  summary.pricing.total = Object.keys(rawPricing).length;
  for (const [provider, models] of Object.entries(rawPricing)) {
    if (!isPlainObject(models)) {
      throw new Error(`Malformed pricing models for provider ${provider}`);
    }
    const provId = resolveProviderId(provider);
    if (!isProviderSupported(provId)) {
      summary.pricing.dropped++;
      continue;
    }
    normalizedPricing[provId] = models;
    summary.pricing.kept++;
  }

  // 10. mitmAlias (always dropped in basic fork)
  summary.mitmAlias.total = Object.keys(payload.mitmAlias || {}).length;
  summary.mitmAlias.dropped = summary.mitmAlias.total;
  const normalizedMitmAlias = {};

  // 11. Combos: bounded depth validation, cycle detection, DAG resolution
  const rawCombos = payload.combos || [];
  summary.combos.total = rawCombos.length;
  const comboIds = new Set();
  const comboNames = new Set();
  for (const c of rawCombos) {
    if (!isPlainObject(c) || typeof c.id !== "string" || !c.id.trim() || typeof c.name !== "string" || !c.name.trim()) {
      throw new Error("Malformed combo item: missing or invalid id/name");
    }
    if (comboIds.has(c.id)) {
      throw new Error(`Duplicate combo id: ${c.id}`);
    }
    if (comboNames.has(c.name)) {
      throw new Error(`Duplicate combo name: ${c.name}`);
    }
    comboIds.add(c.id);
    comboNames.add(c.name);
  }

  const comboMap = new Map(rawCombos.map((c) => [c.name, c]));
  const invalidCombos = new Set();

  // Validate combo kinds: only "llm" or allowed media kinds are valid
  for (const c of rawCombos) {
    const kind = c.kind || "llm";
    if (kind !== "llm" && !ALLOWED_MEDIA_KINDS.has(kind)) {
      invalidCombos.add(c.name);
    }
  }

  function isSeatSupported(seat, parentKind) {
    const modelStr = getSeatModelString(seat);
    if (!modelStr || typeof modelStr !== "string") return false;
    const slash = modelStr.indexOf("/");
    if (slash <= 0) return false;
    const pfx = modelStr.slice(0, slash);
    const provId = resolveProviderId(pfx);
    if (!isProviderSupported(provId)) return false;
    const kinds = getProviderKinds(provId);
    if (parentKind === "llm") {
      return CHAT_PROVIDERS.has(provId);
    }
    return kinds.includes(parentKind);
  }

  // Check nesting depth & detect cycles globally with bounded stack
  // ponytail: MAX_COMBO_NESTING_DEPTH=20 matches runtime nesting ceiling; upgrade to iterative topological sort if arbitrary depths needed.
  const visitState = new Map();
  const inCycle = new Set();

  function checkDepthAndCycles(nodeName, pathStack = []) {
    if (pathStack.length >= MAX_COMBO_NESTING_DEPTH) {
      throw new Error(`Excessive combo nesting depth: exceeded ceiling of ${MAX_COMBO_NESTING_DEPTH}`);
    }

    visitState.set(nodeName, 1);
    pathStack.push(nodeName);

    const combo = comboMap.get(nodeName);
    const models = Array.isArray(combo?.models) ? combo.models : [];
    for (const seat of models) {
      const seatStr = getSeatModelString(seat);
      if (typeof seatStr === "string" && !seatStr.includes("/")) {
        if (comboMap.has(seatStr) && !invalidCombos.has(seatStr)) {
          const state = visitState.get(seatStr) || 0;
          if (state === 1) {
            // Cycle detected
            const cycleStart = pathStack.indexOf(seatStr);
            for (let i = cycleStart; i < pathStack.length; i++) {
              inCycle.add(pathStack[i]);
            }
          } else if (state === 0) {
            checkDepthAndCycles(seatStr, pathStack);
          }
        }
      }
    }

    pathStack.pop();
    visitState.set(nodeName, 2);
  }

  for (const c of rawCombos) {
    if (!invalidCombos.has(c.name) && (visitState.get(c.name) || 0) === 0) {
      checkDepthAndCycles(c.name, []);
    }
  }

  // Pre-flight maximum DAG depth check across all valid acyclic nodes
  const nodeMaxDepth = new Map();
  function getNodeMaxDepth(nodeName) {
    if (inCycle.has(nodeName) || invalidCombos.has(nodeName)) return 0;
    if (nodeMaxDepth.has(nodeName)) return nodeMaxDepth.get(nodeName);

    const combo = comboMap.get(nodeName);
    const models = Array.isArray(combo?.models) ? combo.models : [];
    let maxChildDepth = 0;
    for (const seat of models) {
      const seatStr = getSeatModelString(seat);
      if (typeof seatStr === "string" && !seatStr.includes("/")) {
        if (comboMap.has(seatStr) && !inCycle.has(seatStr) && !invalidCombos.has(seatStr)) {
          const childDepth = getNodeMaxDepth(seatStr);
          if (childDepth > maxChildDepth) {
            maxChildDepth = childDepth;
          }
        }
      }
    }
    const depth = 1 + maxChildDepth;
    if (depth > MAX_COMBO_NESTING_DEPTH) {
      throw new Error(`Excessive combo nesting depth: exceeded ceiling of ${MAX_COMBO_NESTING_DEPTH}`);
    }
    nodeMaxDepth.set(nodeName, depth);
    return depth;
  }

  for (const c of rawCombos) {
    if (!inCycle.has(c.name) && !invalidCombos.has(c.name)) {
      getNodeMaxDepth(c.name);
    }
  }

  // Resolve valid models for acyclic DAG nodes (memoization is sound and deterministic)
  const resolvedComboModels = new Map();
  const resolving = new Set();

  function getValidModelsForCombo(cName) {
    if (inCycle.has(cName) || invalidCombos.has(cName)) return [];
    if (resolvedComboModels.has(cName)) return resolvedComboModels.get(cName);
    if (resolving.has(cName)) return [];
    resolving.add(cName);

    const combo = comboMap.get(cName);
    if (!combo || !Array.isArray(combo.models)) {
      resolving.delete(cName);
      return [];
    }
    const parentKind = combo.kind || "llm";
    const validSeats = [];

    for (const seat of combo.models) {
      const seatStr = getSeatModelString(seat);
      if (!seatStr) continue;
      if (!seatStr.includes("/")) {
        // Child combo reference
        const childCombo = comboMap.get(seatStr);
        if (childCombo && !inCycle.has(seatStr) && !invalidCombos.has(seatStr)) {
          const childKind = childCombo.kind || "llm";
          if (childKind === parentKind) {
            const childValid = getValidModelsForCombo(seatStr);
            if (childValid.length > 0) {
              validSeats.push(canonicalizeSeat(seat));
            }
          }
        }
      } else {
        if (isSeatSupported(seat, parentKind)) {
          validSeats.push(canonicalizeSeat(seat));
        }
      }
    }

    resolving.delete(cName);
    resolvedComboModels.set(cName, validSeats);
    return validSeats;
  }

  const normalizedCombos = [];
  for (const c of rawCombos) {
    if (inCycle.has(c.name) || invalidCombos.has(c.name)) {
      summary.combos.dropped++;
      continue;
    }
    const validModels = getValidModelsForCombo(c.name);
    if (validModels.length === 0) {
      summary.combos.dropped++;
      continue;
    }
    normalizedCombos.push({
      ...c,
      models: validModels,
    });
    summary.combos.kept++;
  }

  const normalizedPayload = {
    ...payload,
    ...(normalizedSettings !== undefined ? { settings: normalizedSettings } : {}),
    providerConnections: normalizedConnections,
    providerNodes: normalizedNodes,
    proxyPools: normalizedProxyPools,
    apiKeys: normalizedApiKeys,
    combos: normalizedCombos,
    modelAliases: normalizedModelAliases,
    customModels: normalizedCustomModels,
    pricing: normalizedPricing,
    mitmAlias: normalizedMitmAlias,
  };

  return {
    normalizedPayload,
    summary,
  };
}
