/**
 * Capacity Adapter — global fallback pools of models per input-modality capability
 * (vision / pdf / audioInput / videoInput).
 *
 * Retained capable originals keep priority; otherwise a retained capable pool
 * supplies fallback candidates. Incapable candidates never receive media they
 * would discard. No capable candidate produces an explicit pre-dispatch error.
 */
import { getCapabilitiesForModel } from "../providers/capabilities.js";

const CAPABILITY_KEYS = ["vision", "pdf", "audioInput", "videoInput"];
const HARD_CAPS = new Set(CAPABILITY_KEYS);
const DEFAULT_FALLBACK_MODEL = "oc/mimo-v2.6-flash-free";
const upgradeLegacyModel = (m) => (m === "oc/mimo-v2.5-free" ? DEFAULT_FALLBACK_MODEL : m);
const RETAINED_PROVIDERS = new Set(["ag", "antigravity", "cx", "codex", "oc", "opencode"]);
const isRetainedModel = (model) => typeof model === "string" && RETAINED_PROVIDERS.has(model.slice(0, model.indexOf("/"))) && model.indexOf("/") < model.length - 1;

// Normalize a capability entry to { enabled, roundRobin, models }. Backward-compat:
// accept the legacy array form [{model, enabled}] (treated as enabled, fallback).
function normalizeCapEntry(entry) {
  if (Array.isArray(entry)) {
    return { enabled: true, roundRobin: false, models: entry.filter(e => e?.enabled !== false).map((e) => upgradeLegacyModel(e?.model || e)).filter(isRetainedModel) };
  }
  if (entry && typeof entry === "object") {
    return {
      enabled: entry.enabled !== false,
      roundRobin: !!entry.roundRobin,
      models: Array.isArray(entry.models) ? entry.models.map(upgradeLegacyModel).filter(isRetainedModel) : [],
    };
  }
  return { enabled: false, roundRobin: false, models: [] };
}

// Resolve one capability's full config. Enabled pools with no models fall back
// to DEFAULT_FALLBACK_MODEL so the toggle is never a no-op.
export function getCapacityAdapterConfig(cap, settings) {
  const entry = normalizeCapEntry(settings?.capacityAdapter?.[cap]);
  if (entry.enabled && entry.models.length === 0) {
    return { ...entry, models: [DEFAULT_FALLBACK_MODEL] };
  }
  return entry;
}

// Flatten enabled models across all capability pools, in priority order, deduped.
export function getCapacityAdapterModels(settings) {
  const seen = new Set();
  const models = [];
  for (const cap of CAPABILITY_KEYS) {
    const { enabled, models: pool } = getCapacityAdapterConfig(cap, settings);
    if (!enabled) continue;
    for (const m of pool) {
      if (!seen.has(m)) {
        seen.add(m);
        models.push(m);
      }
    }
  }
  return models;
}

// Strategy for a capability: "round-robin" when enabled+roundRobin, else "fallback".
export function getCapacityAdapterStrategy(cap, settings) {
  const { enabled, roundRobin } = getCapacityAdapterConfig(cap, settings);
  return enabled && roundRobin ? "round-robin" : "fallback";
}

// Strategy from the request's required capabilities: picks the first capability
// whose adapter pool is enabled and can satisfy a hard requirement.
export function getActiveAdapterStrategy(requiredCapabilities, settings) {
  const hard = [...(requiredCapabilities || [])].filter((c) => HARD_CAPS.has(c));
  for (const cap of hard) {
    const { enabled, models } = getCapacityAdapterConfig(cap, settings);
    if (!enabled || !models.some(m => modelSatisfies(m, hard))) continue;
    return getCapacityAdapterStrategy(cap, settings);
  }
  return "fallback";
}

function modelSatisfies(modelStr, requiredHard) {
  if (!isRetainedModel(modelStr)) return false;
  const slash = modelStr.indexOf("/");
  const provider = slash > 0 ? modelStr.slice(0, slash) : "";
  const model = slash > 0 ? modelStr.slice(slash + 1) : modelStr;
  const caps = getCapabilitiesForModel(provider, model);
  return requiredHard.every((c) => caps[c] === true);
}

// Keep capable retained originals, else use capable retained pool candidates.
// Never fall back to an incapable model that would silently discard media.
export function augmentModelsWithCapacityAdapter(models, requiredCapabilities, settings) {
  const hard = [...(requiredCapabilities || [])].filter((c) => HARD_CAPS.has(c));
  if (!Array.isArray(models)) return models;
  const retained = models.filter(isRetainedModel);
  if (hard.length === 0) return retained;
  const capable = retained.filter((m) => modelSatisfies(m, hard));
  if (capable.length) return capable;
  const pool = getCapacityAdapterModels(settings).filter((m) => modelSatisfies(m, hard));
  if (pool.length) return pool;
  const error = new Error(`No retained model supports required input capabilities: ${hard.join(", ")}`);
  error.code = "unsupported_capability";
  throw error;
}

// Compatibility export: context limits must surface upstream, never erase history.
export function stripHistoryForContext(body, contextWindow) {
  return body;
}

// Compatibility wrapper: preserve complete request and callback/stream contract.
export function withCapacityAdapterStripping(handleSingleModel, adapterModels) {
  return handleSingleModel;
}
