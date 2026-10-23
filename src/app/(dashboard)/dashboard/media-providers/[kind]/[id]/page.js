"use client";

import { useParams, notFound } from "next/navigation";
import Link from "next/link";

import { Card, Badge, NoAuthProxyCard, ProviderInfoCard } from "@/shared/components";
import CodexTranscriptionNotice from "@/mine/stt/CodexTranscriptionNotice.jsx";
import { SttExampleCard } from "./components/SttExampleCard";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS,  } from "@/shared/constants/providers";
import ConnectionsCard from "@/app/(dashboard)/dashboard/providers/components/ConnectionsCard";
import ModelsCard from "@/app/(dashboard)/dashboard/providers/components/ModelsCard";
import { KIND_EXAMPLE_CONFIG } from "./components/exampleShared";
import { GenericExampleCard } from "./components/GenericExampleCard";

// MediaProviderDetailPage
export default function MediaProviderDetailPage() {
  const { kind, id } = useParams();
  const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kind);
  const isCustom = false;
  if (!kindConfig) return notFound();

  const builtInProvider = AI_PROVIDERS[id];

  // For custom embedding nodes, build a synthetic provider object
  const provider = builtInProvider;

  if (!isCustom && !builtInProvider) return notFound();

  const kinds = provider.serviceKinds ?? ["llm"];
  if (!isCustom && !kinds.includes(kind)) return notFound();

  return (
    <div className="flex flex-col gap-8">
      {/* Back */}
      <div>
        <Link
          href={`/dashboard/media-providers/${kind}`}
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary transition-colors mb-4"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          {kindConfig.label}
        </Link>

        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="size-12 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${provider.color}15` }}>
            <ProviderIcon
              src={`/providers/${provider.id}.png`}
              alt={provider.name}
              size={48}
              className="object-contain rounded-lg max-w-[48px] max-h-[48px]"
              fallbackText={provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
              fallbackColor={provider.color}
            />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <h1 className="text-3xl font-semibold tracking-tight">{provider.name}</h1>
              {!isCustom && provider.notice?.apiKeyUrl && (
                <a
                  href={provider.notice.apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">open_in_new</span>
                  Get API Key
                </a>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {false}
              {kinds.map((k) => (
                <Badge key={k} variant={k === kind ? "primary" : "default"} size="sm">
                  {k.toUpperCase()}
                </Badge>
              ))}
            </div>
          </div>
          {false}
        </div>
      </div>

      {/* Kind-specific notice (e.g. codex/image requires Plus) */}
      {!isCustom && provider.kindNotice?.[kind] && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400">
          <span className="material-symbols-outlined text-[20px] mt-0.5">warning</span>
          <p className="text-sm">{provider.kindNotice[kind]}</p>
        </div>
      )}

      {/* Provider notice text (only when there's actual text content) */}
      {!isCustom && provider.notice?.text && !provider.deprecated && (
        <div className="flex flex-col gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 sm:flex-row sm:items-center">
          <span className="material-symbols-outlined text-[16px] text-blue-500 shrink-0">info</span>
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-blue-600 dark:text-blue-400">{provider.notice.text}</p>
          {provider.notice.apiKeyUrl && (
            <a
              href={provider.notice.apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex justify-center rounded bg-blue-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600 sm:py-0.5"
            >
              Get API Key →
            </a>
          )}
        </div>
      )}

      {kind === "stt" && id === "codex" && (
        <>
          <CodexTranscriptionNotice />
          <p className="text-sm text-text-muted">
            Accounts, priorities, proxies and enable/disable settings are shared with chat.{" "}
            <Link href="/dashboard/providers/codex" className="text-primary hover:underline">Manage Codex chat accounts</Link>
          </p>
        </>
      )}

      {/* Connections */}
      {!isCustom && provider.noAuth ? (
        <NoAuthProxyCard providerId={id} />
      ) : (
        <ConnectionsCard providerId={id} isOAuth={kind === "stt" && id === "codex"} />
      )}

      {/* Models - hidden for tts/webSearch/webFetch (provider IS the model); custom uses prefix as alias */}
      {kind === "stt" && id === "codex" && (
        <Card>
          <h2 className="text-lg font-semibold mb-2">Models</h2>
          <code className="text-sm">cx/transcribe</code>
          <p className="text-xs text-text-muted mt-1">Codex transcription · json / text</p>
        </Card>
      )}
      {kind !== "stt" && kind !== "tts" && kind !== "webSearch" && kind !== "webFetch" && (
        <ModelsCard
          providerId={id}
          kindFilter={kind}
          providerAliasOverride={undefined}
        />
      )}

      {/* Provider Info — config-driven, supports searchConfig, fetchConfig, ttsConfig, embeddingConfig, systemoneConfig, searchViaChat */}
      {!isCustom && (provider.searchConfig || provider.fetchConfig || provider.ttsConfig || provider.sttConfig || provider.embeddingConfig || provider.systemoneConfig || provider.searchViaChat) && (
        <ProviderInfoCard
          config={
            kind === "webFetch" ? provider.fetchConfig
              :     provider.searchConfig || { mode: "chat-completions", defaultModel: provider.searchViaChat?.defaultModel, pricingUrl: provider.searchViaChat?.pricingUrl, freeTier: provider.searchViaChat?.freeTier }
          }
          provider={provider}
          title={`${kindConfig.label} Config`}
        />
      )}

      {/* Example — per kind */}
      {kind === "embedding" && (
        null
      )}
      {kind === "tts" && null}
      {kind === "stt" && id === "codex" && <SttExampleCard providerId={id} />}
      {!isCustom && KIND_EXAMPLE_CONFIG[kind] && <GenericExampleCard providerId={id} kind={kind} />}

      {false}
    </div>
  );
}
