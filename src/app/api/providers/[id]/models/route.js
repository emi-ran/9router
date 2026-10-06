import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/models";
import { refreshCodexToken, updateProviderCredentials } from "@/sse/services/tokenRefresh";
import { getModelsByProviderId } from "open-sse/config/providerModels.js";
import codexProvider from "open-sse/providers/registry/codex.js";
const CODEX_MODELS_URL = `https://chatgpt.com/backend-api/codex/models?client_version=${codexProvider.transport.cliVersion}`;
const parseOpenAIStyleModels = (data) => {
  if (Array.isArray(data)) return data;
  return data?.data || data?.models || data?.results || [];
};

const appendCodexReviewModels = (models) => models.flatMap((model) => {
  const id = model?.id || model?.slug || model?.model || model?.name;
  if (!id) return [];
  const name = model?.display_name || model?.displayName || model?.name || id;
  const normalized = { ...model, id, name };
  const isChatModel = (model?.type || "llm") !== "image" && !id.toLowerCase().includes("embed");
  if (!isChatModel || id.endsWith("-review")) return [normalized];
  return [
    normalized,
    {
      ...normalized,
      id: `${id}-review`,
      name: `${name} Review`,
      upstreamModelId: id,
      quotaFamily: "review",
    },
  ];
});

const parseCodexModels = (data) => appendCodexReviewModels(parseOpenAIStyleModels(data));

const buildOAuthResolver = ({ refreshFn, fetchFn, parseFn, errorLabel }) => async (connection) => {
  const { accessToken, refreshToken } = connection;
  if (!accessToken) {
    return { error: "No valid token found", status: 401 };
  }
  let warning;
  try {
    let response = await fetchFn(accessToken, connection);
    if (!response.ok && (response.status === 401 || response.status === 403) && refreshToken) {
      const refreshed = await refreshFn(connection);
      if (refreshed?.accessToken) {
        await updateProviderCredentials(connection.id, {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken || refreshToken,
          expiresIn: refreshed.expiresIn,
        });
        connection.accessToken = refreshed.accessToken;
        if (refreshed.refreshToken) connection.refreshToken = refreshed.refreshToken;
        response = await fetchFn(refreshed.accessToken, connection);
      }
    }
    if (response.ok) {
      const data = await response.json();
      const models = parseFn(data);
      if (models.length > 0) return { models };
    } else {
      const errorText = await response.text();
      warning = `${errorLabel}: ${response.status} ${errorText}`;
      console.log(`${errorLabel} (falling back to static):`, errorText);
    }
  } catch (error) {
    warning = `${errorLabel}: ${error.message}`;
    console.log(`${errorLabel} (falling back to static):`, error.message);
  }
  return { models: [], warning };
};
export async function GET(request, { params }) {
  const { id } = await params;
  const connection = await getProviderConnectionById(id);
  if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  if (!["codex", "antigravity", "opencode"].includes(connection.provider)) return NextResponse.json({ error: "Unsupported chat provider" }, { status: 400 });
  if (connection.provider === "codex") {
    const result = await buildOAuthResolver({
      refreshFn: c => refreshCodexToken(c.refreshToken),
      fetchFn: token => fetch(CODEX_MODELS_URL, { headers: { Authorization: `Bearer ${token}`, originator: "codex_cli_rs" }, signal: AbortSignal.timeout(15000) }),
      parseFn: parseCodexModels, errorLabel: "Failed to fetch Codex models",
    })(connection);
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ...result, models: result.models.length ? result.models : getModelsByProviderId(connection.provider) });
  }
  return NextResponse.json({ models: getModelsByProviderId(connection.provider) });
}
