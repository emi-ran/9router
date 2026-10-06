"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getProvidersByKind } from "@/shared/constants/providers";
import Badge from "@/shared/components/Badge";
import Card from "@/shared/components/Card";
import ProviderIcon from "@/shared/components/ProviderIcon";

export default function ProvidersPage() {
  const [connections, setConnections] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    const timeout = setTimeout(() => controller.abort(), 10000);
    async function loadConnections() {
      try {
        const response = await fetch("/api/providers", { signal: controller.signal });
        if (!response.ok) throw new Error("Failed to load connections");
        const data = await response.json();
        if (!Array.isArray(data.connections) || data.connections.some(c => !c || typeof c.provider !== "string")) {
          throw new Error("Invalid connections response");
        }
        if (mounted) setConnections(data.connections);
      } catch {
        if (mounted) setError(true);
      } finally {
        clearTimeout(timeout);
      }
    }
    loadConnections();
    return () => {
      mounted = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  function renderStatus(provider) {
    if (provider.noAuth) return <Badge variant="success" size="sm" dot>Ready</Badge>;
    if (error) return <Badge variant="error" size="sm">Unable to load connections</Badge>;
    if (connections === null) return <span className="text-text-muted">Loading connections...</span>;
    const accounts = connections.filter(c => c.provider === provider.id && c.authType === "oauth");
    if (!accounts.length) return <span className="text-text-muted">No connections</span>;
    const enabled = accounts.filter(c => c.isActive !== false);
    if (!enabled.length) return <Badge size="sm">Disabled</Badge>;
    const statuses = enabled.map(c => {
      const cooldown = Object.entries(c).some(([key, value]) =>
        key.startsWith("modelLock_") && new Date(value).getTime() > Date.now());
      return c.testStatus === "unavailable" && !cooldown ? "active" : c.testStatus;
    });
    const connected = statuses.filter(s => s === "active" || s === "success").length;
    const failed = statuses.filter(s => ["error", "expired", "unavailable"].includes(s)).length;
    const unknown = enabled.length - connected - failed;
    return <>
      {connected > 0 && <Badge variant="success" size="sm" dot>{connected} Connected</Badge>}
      {failed > 0 && <Badge variant="error" size="sm" dot>{failed} Error</Badge>}
      {unknown > 0 && <Badge size="sm">{unknown} Unknown</Badge>}
    </>;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold">Providers</h1>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {getProvidersByKind("llm").map(provider => (
          <Link key={provider.id} href={`/dashboard/providers/${provider.id}`}
            className="group min-w-0 rounded-[14px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
            <Card padding="xs" className="h-full shadow-none transition-colors hover:bg-surface-2">
              <div className="flex min-w-0 items-center gap-3">
                <ProviderIcon providerId={provider.id} alt="" size={40}
                  className="shrink-0 rounded-lg object-contain" fallbackText={provider.textIcon || provider.id.slice(0, 2).toUpperCase()}
                  fallbackColor={provider.color} />
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">{provider.name}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs" aria-live="polite">
                    {provider.noAuth && <span className="text-text-muted">Free</span>}
                    {renderStatus(provider)}
                  </div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
