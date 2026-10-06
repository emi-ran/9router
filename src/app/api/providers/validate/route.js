import { NextResponse } from "next/server";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { normalizeProviderId } from "@/lib/providerNormalization";
import { getDefaultModel } from "open-sse/config/providerModels.js";
async function probeWebProvider(provider, apiKey) {
  const p = AI_PROVIDERS[provider];
  if (!p) return null;
  // Skip if provider has dual-purpose (LLM + search), let LLM validate handle it
  const kinds = p.serviceKinds || ["llm"];
  const isWebOnly = kinds.every((k) => k === "webSearch" || k === "webFetch");
  if (!isWebOnly) return null;
  const cfg = p.searchConfig || p.fetchConfig;
  if (!cfg) return null;
  if (cfg.authType === "none") return true; // no-auth (e.g. searxng)

  let url = cfg.validateUrl || cfg.baseUrl;
  const headers = { "Content-Type": "application/json" };
  let body;

  // Apply auth based on authHeader
  switch (cfg.authHeader) {
    case "bearer":              headers["Authorization"] = `Bearer ${apiKey}`; break;
    case "x-api-key":           headers["x-api-key"] = apiKey; break;
    case "x-subscription-token":headers["x-subscription-token"] = apiKey; break;
    case "key":                 url += `?key=${encodeURIComponent(apiKey)}&q=ping&cx=test`; break; // google-pse
    case "api_key":             url += `?api_key=${encodeURIComponent(apiKey)}&q=ping&engine=google`; break; // searchapi
  }

  // Minimal body for POST endpoints; GET sends nothing
  if (cfg.method === "POST") {
    body = JSON.stringify({ query: "ping", q: "ping", url: "https://example.com" });
  }

  const res = await fetch(url, { method: cfg.method, headers, body, signal: AbortSignal.timeout(8000) });
  return res.status !== 401 && res.status !== 403;
}

async function probeMediaProvider(provider, apiKey) {
  const p = AI_PROVIDERS[provider];
  if (!p) return null;
  const MEDIA_KINDS = new Set(["image", "music", "imageToText"]);
  const kinds = p.serviceKinds || ["llm"];
  const isMediaOnly = kinds.every((k) => MEDIA_KINDS.has(k));
  if (!isMediaOnly) return null;
  const cfg = p.imageConfig || p.musicConfig;
  // No probe config → best-effort accept (validate at usage time)
  if (!cfg) return true;
  if (p.noAuth || cfg.authType === "none") return true;
  // Skip auth schemes that need provider-specific data
  if (cfg.authHeader === "playht" || cfg.authHeader === "aws-sigv4") return true;

  const headers = { "Content-Type": "application/json", ...(cfg.extraHeaders || {}) };

  switch (cfg.authHeader) {
    case "bearer":     headers["Authorization"] = `Bearer ${apiKey}`; break;
    case "key":        headers["Authorization"] = `Key ${apiKey}`; break;
    case "x-api-key":  headers["x-api-key"] = apiKey; break;
    case "x-key":      headers["x-key"] = apiKey; break;
    case "xi-api-key": headers["xi-api-key"] = apiKey; break;
    case "token":      headers["Authorization"] = `Token ${apiKey}`; break;
    case "basic":      headers["Authorization"] = `Basic ${apiKey}`; break;
    default: return null;
  }

  const method = cfg.method || "POST";
  const res = await fetch(cfg.baseUrl, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify({ input: "ping", text: "ping", prompt: "ping", model: getDefaultModel(provider) || "test" }),
    signal: AbortSignal.timeout(8000),
  });
  return res.status !== 401 && res.status !== 403;
}
export async function POST(request) {
  try {
    const body = await request.json();
    const provider = normalizeProviderId(body.provider);
    const entry = AI_PROVIDERS[provider];
    if (!entry) return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });
    if (entry.noAuth) return NextResponse.json({ valid: true });
    if (!body.apiKey || typeof body.apiKey !== "string") return NextResponse.json({ error: "API Key is required" }, { status: 400 });
    const web = await probeWebProvider(provider, body.apiKey);
    const valid = web === null ? await probeMediaProvider(provider, body.apiKey) : web;
    if (valid === null) return NextResponse.json({ error: "Use OAuth to connect this provider" }, { status: 400 });
    return NextResponse.json({ valid, error: valid ? null : "Invalid API key" });
  } catch (error) { return NextResponse.json({ valid: false, error: error.message }, { status: 400 }); }
}
