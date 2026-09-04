"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import ProviderIcon from "@/shared/components/ProviderIcon";
import CompactSelect from "@/shared/components/CompactSelect";
import QuotaTable from "./QuotaTable";
import Toggle from "@/shared/components/Toggle";
import Tooltip from "@/shared/components/Tooltip";
import {
  parseQuotaData,
  calculatePercentage,
  filterQuotasByVisibility,
  getHiddenQuotaRows,
  getQuotaVisibilityKey,
  getConnectionLabel,
  getCodexPlan,
  getConnectionQuotaRemaining,
  sortVisibleConnections,
  buildLoadingState,
  filterQuotaStateByConnections,
  getConnectionsEmptyMessage,
  getPageSizeLabel,
  getConnectionsPaginationSummary,
  getSafePagination,
  getSafeTotals,
  shouldResetPage,
  getPaginationPageValue,
  getProviderOptions,
  reconcileConnectionsPage,
  getQuotaCache,
  setQuotaCache,
  getCustomCardOrder,
  setCustomCardOrder,
  updateCustomCardOrderList,
  QUOTA_CACHE_KEY,
  REFRESH_INTERVAL_MS,
  CLAUDE_REFRESH_INTERVAL_MS,
  DEPLETED_QUOTA_THRESHOLD,
  AUTO_REFRESH_STORAGE_KEY,
  CONNECTIONS_PAGE_SIZE,
  ACCOUNT_PAGE_SIZE_OPTIONS,
  ACCOUNT_PAGE_SIZE_MAX,
  ACCOUNT_FILTER_OPTIONS,
  QUOTA_SORT_OPTIONS,
} from "./utils";
import Card from "@/shared/components/Card";
import { ConfirmModal, EditConnectionModal } from "@/shared/components";
import { USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

// Maps the stored providerSpecificData.authMethod to a human label for Kiro.
// Values come from the Kiro connect flows: builder-id/idc (device code),
// google/github (social), imported (refresh-token paste), api_key (headless).
const KIRO_METHOD_LABELS = {
  "builder-id": "AWS Builder ID",
  idc: "IAM Identity Center",
  google: "Google",
  github: "GitHub",
  imported: "Imported Token",
  api_key: "API Key",
};

const AUTO_PING_SETTINGS_KEYS = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing",
};

const AUTO_PING_TOOLTIPS = {
  claude: "When your 5h quota runs out, auto-sends a request the moment it resets so a new window starts right away.",
  codex: "Auto-starts the next 5h Codex window after reset by sending a tiny gpt-5.5 request. Consumes a small amount of quota.",
};

function kiroMethodLabel(conn) {
  const m = conn.providerSpecificData?.authMethod;
  if (m && KIRO_METHOD_LABELS[m]) return KIRO_METHOD_LABELS[m];
  return conn.authType === "api_key" ? "API Key" : "OAuth";
}

function getConnectionSecondaryLabel(connection) {
  if (connection.name?.trim() && connection.email?.trim() && connection.name.trim() !== connection.email.trim()) {
    return connection.email.trim();
  }

  if (connection.name?.trim() && connection.displayName?.trim() && connection.name.trim() !== connection.displayName.trim()) {
    return connection.displayName.trim();
  }

  return null;
}

// Region is stored for builder-id/idc/api_key flows; social and imported flows
// omit it, so fall back to the region segment of the profileArn
// (arn:aws:codewhisperer:<region>:...).
function kiroRegion(conn) {
  const r = conn.providerSpecificData?.region;
  if (r) return r;
  const arn = conn.providerSpecificData?.profileArn;
  const seg = typeof arn === "string" ? arn.split(":")[3] : "";
  return seg || "";
}

function getCodexResetCreditCount(quota) {
  const value = quota?.raw?.resetCredits?.availableCount;
  const count = typeof value === "number" ? value : Number(value);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
}

function formatCreditDate(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "N/A";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimeRemaining(value) {
  if (!value) return "N/A";
  const diffMs = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(diffMs)) return "N/A";
  if (diffMs <= 0) return "Expired";
  const totalHours = Math.ceil(diffMs / (60 * 60 * 1000));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
}

function SortableCard({
  id,
  conn,
  index,
  totalCount,
  isCustomReorderActive,
  quota,
  isLoading,
  error,
  isInactive,
  isCodex,
  resetCreditCount,
  isResettingLimit,
  rowBusy,
  visibleQuotas,
  hiddenQuotaRows,
  autoPingMaps,
  copied,
  copy,
  mobileActionsConnId,
  setMobileActionsConnId,
  mobileHiddenRevealed,
  setMobileHiddenRevealed,
  quotaSortMode,
  onRefreshProvider,
  onToggleAutoPing,
  onHideQuota,
  onShowQuota,
  onSelectEdit,
  onDeleteConnection,
  onToggleActive,
  onOpenResetConfirm,
  onViewCodexResetCredits,
  onMoveCard,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled: !isCustomReorderActive,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? "none" : transition,
    opacity: isDragging ? 0.35 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  const isFirst = index === 0;
  const isLast = index === totalCount - 1;
  const codexPlan = isCodex ? getCodexPlan(quota, conn) : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group/card flex flex-col rounded-xl border border-border-subtle bg-surface shadow-[var(--shadow-soft)] transition-[border-color,box-shadow,opacity] hover:border-border ${
        isInactive ? "opacity-60 bg-surface/50" : ""
      } ${isDragging ? "ring-2 ring-primary/40 shadow-xl" : ""}`}
    >
      {/* Card Header */}
      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 border-b border-border-subtle/80 bg-surface-2/20">
        <div className="flex items-center gap-2 min-w-0">
          {/* Drag Handle & Reorder controls */}
          {isCustomReorderActive && (
            <div className="flex items-center -ml-1 mr-0.5 shrink-0">
              <button
                {...attributes}
                {...listeners}
                type="button"
                aria-label={`Drag to reorder ${getConnectionLabel(conn) || conn.provider}`}
                title="Drag to reorder card (Hold / touch or drag handle)"
                className="flex h-7 w-5 cursor-grab touch-none items-center justify-center rounded text-text-muted hover:bg-surface-3 hover:text-text-primary active:cursor-grabbing focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                <span className="material-symbols-outlined text-[18px]">
                  drag_indicator
                </span>
              </button>
            </div>
          )}

          <div className="size-8 shrink-0 rounded-lg flex items-center justify-center p-1 bg-surface-2 border border-border-subtle overflow-hidden">
            <ProviderIcon
              src={`/providers/${conn.provider}.png`}
              alt={conn.provider}
              size={24}
              className="size-6 object-contain"
              fallbackText={
                conn.provider?.slice(0, 2).toUpperCase() || "PR"
              }
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-bold text-text-primary capitalize truncate">
                {conn.provider}
              </h3>
              {isInactive && (
                <span className="rounded bg-surface-3 px-1.5 py-0.2 text-[9.5px] font-medium text-text-muted">
                  Off
                </span>
              )}
            </div>
            {getConnectionLabel(conn) ? (
              <p className="text-[11px] font-medium text-text-muted truncate leading-tight" title={getConnectionLabel(conn)}>
                {getConnectionLabel(conn)}
              </p>
            ) : null}
            {getConnectionSecondaryLabel(conn) ? (
              <p className="text-[10px] text-text-muted/70 truncate leading-tight" title={getConnectionSecondaryLabel(conn)}>
                {getConnectionSecondaryLabel(conn)}
              </p>
            ) : null}
            {codexPlan ? (
              <span className="mt-1 inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-primary">
                {codexPlan}
              </span>
            ) : null}
          </div>
        </div>

        {/* Header Actions - Desktop */}
        <div className="hidden items-center gap-3 shrink-0 pr-1 sm:flex">
          {isCodex && (
            <div className="flex items-center rounded-full border border-border-subtle bg-surface-2/60 px-1.5 py-0.5">
              <Tooltip
                text={
                  resetCreditCount > 0
                    ? `Use one Codex reset credit. Available: ${resetCreditCount}`
                    : "No Codex reset credits available"
                }
              >
                <button
                  type="button"
                  onClick={() => onOpenResetConfirm(conn, resetCreditCount)}
                  disabled={resetCreditCount <= 0 || isLoading || rowBusy}
                  aria-label={
                    resetCreditCount > 0
                      ? `Use one Codex reset credit. ${resetCreditCount} available.`
                      : "No Codex reset credits available"
                  }
                   className={`flex h-7 items-center justify-center gap-1 rounded-full px-1.5 text-[11px] font-medium tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    resetCreditCount > 0
                      ? "text-primary hover:bg-primary/10"
                      : "text-text-muted"
                  }`}
                >
                  <span className={`material-symbols-outlined text-[14px] ${isResettingLimit ? "animate-spin" : ""}`}>
                    {isResettingLimit ? "progress_activity" : "restart_alt"}
                  </span>
                  <span>{resetCreditCount}</span>
                </button>
              </Tooltip>
              <Tooltip text="View reset credit history/expiry">
                <button
                  type="button"
                  onClick={() => onViewCodexResetCredits(conn)}
                  disabled={isLoading || rowBusy}
                  aria-label="View Codex reset credit expiry"
                   className="flex h-7 w-6 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[14px]">schedule</span>
                </button>
              </Tooltip>
            </div>
          )}

          {AUTO_PING_SETTINGS_KEYS[conn.provider] && conn.authType === "oauth" && (
            <Tooltip text={AUTO_PING_TOOLTIPS[conn.provider]}>
              <button
                type="button"
                onClick={() => onToggleAutoPing(conn.id, conn.provider, !(autoPingMaps[conn.provider]?.[conn.id] === true))}
                aria-label="Toggle auto-ping"
                className={`flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-text-muted transition-[background-color,border-color,color,opacity] hover:bg-surface-2 hover:text-text-primary ${autoPingMaps[conn.provider]?.[conn.id] === true ? "border-amber-500/30 bg-amber-500/10 text-amber-500" : "opacity-75"}`}
              >
                <span className="material-symbols-outlined text-[16px]">bolt</span>
              </button>
            </Tooltip>
          )}

          <Tooltip text="Refresh quota">
            <button
              type="button"
              onClick={() => onRefreshProvider(conn.id, conn.provider)}
              disabled={isLoading || rowBusy}
              aria-label="Refresh quota"
              className="flex h-7 w-7 scale-90 items-center justify-center rounded-lg text-text-muted opacity-80 transition-[background-color,color,opacity,transform] hover:scale-100 hover:bg-surface-2 hover:text-text-primary hover:opacity-100 disabled:opacity-50"
            >
              <span
                className={`material-symbols-outlined text-[16px] ${isLoading ? "animate-spin text-primary" : ""}`}
              >
                refresh
              </span>
            </button>
          </Tooltip>

          <Tooltip text="Edit connection">
            <button
              type="button"
              onClick={() => onSelectEdit(conn)}
              disabled={rowBusy}
              aria-label="Edit connection"
              className="flex h-7 w-7 scale-90 items-center justify-center rounded-lg text-text-muted opacity-80 transition-[background-color,color,opacity,transform] hover:scale-100 hover:bg-surface-2 hover:text-text-primary hover:opacity-100 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">
                edit
              </span>
            </button>
          </Tooltip>

          <Tooltip text="Delete connection">
            <button
              type="button"
              onClick={() => onDeleteConnection(conn.id)}
              disabled={rowBusy}
              aria-label="Delete connection"
              className="flex h-7 w-7 scale-90 items-center justify-center rounded-lg text-text-muted opacity-80 transition-[background-color,color,opacity,transform] hover:scale-100 hover:bg-rose-500/10 hover:text-rose-500 hover:opacity-100 disabled:opacity-50"
            >
              <span
                className={`material-symbols-outlined text-[16px] ${rowBusy ? "animate-pulse" : ""}`}
              >
                delete
              </span>
            </button>
          </Tooltip>

          <div
            className="inline-flex h-8 items-center border-l border-border-subtle pl-3"
            title={
              (conn.isActive ?? true)
                ? "Disable connection"
                : "Enable connection"
            }
          >
            <Toggle
              size="sm"
              checked={conn.isActive ?? true}
              disabled={rowBusy}
              onChange={(nextActive) =>
                onToggleActive(conn.id, nextActive)
              }
            />
          </div>
        </div>

        {/* Header Actions - Mobile Compact & Overflow */}
        <div className="flex sm:hidden items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onRefreshProvider(conn.id, conn.provider)}
            disabled={isLoading || rowBusy}
            aria-label="Refresh quota"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary disabled:opacity-50"
          >
            <span
              className={`material-symbols-outlined text-[16px] ${isLoading ? "animate-spin text-primary" : ""}`}
            >
              refresh
            </span>
          </button>

          <div className="inline-flex items-center px-0.5">
            <Toggle
              size="sm"
              checked={conn.isActive ?? true}
              disabled={rowBusy}
              onChange={(nextActive) =>
                onToggleActive(conn.id, nextActive)
              }
            />
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() =>
                setMobileActionsConnId((prev) =>
                  prev === conn.id ? null : conn.id
                )
              }
              aria-label="More actions"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
            >
              <span className="material-symbols-outlined text-[18px]">
                more_vert
              </span>
            </button>

            {mobileActionsConnId === conn.id && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 bg-transparent"
                  aria-label="Close menu"
                  onClick={() => setMobileActionsConnId(null)}
                />
                <div className="absolute right-0 z-50 mt-1 w-48 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-xl ring-1 ring-black/10 dark:ring-white/10">
                  {isCustomReorderActive && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setMobileActionsConnId(null);
                          onMoveCard(conn.id, "up");
                        }}
                        disabled={isFirst}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-text-primary hover:bg-surface-2 disabled:opacity-40"
                      >
                        <span className="material-symbols-outlined text-[16px] text-text-muted">
                          arrow_upward
                        </span>
                        <span>Move earlier</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMobileActionsConnId(null);
                          onMoveCard(conn.id, "down");
                        }}
                        disabled={isLast}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-text-primary hover:bg-surface-2 disabled:opacity-40"
                      >
                        <span className="material-symbols-outlined text-[16px] text-text-muted">
                          arrow_downward
                        </span>
                        <span>Move later</span>
                      </button>
                      <div className="my-1 h-px bg-border-subtle" />
                    </>
                  )}

                  {isCodex && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setMobileActionsConnId(null);
                          onOpenResetConfirm(conn, resetCreditCount);
                        }}
                        disabled={
                          resetCreditCount <= 0 ||
                          isLoading ||
                          rowBusy
                        }
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-text-primary hover:bg-surface-2 disabled:opacity-40"
                      >
                        <span className="material-symbols-outlined text-[16px] text-primary">
                          restart_alt
                        </span>
                        <span>Reset Limit ({resetCreditCount})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMobileActionsConnId(null);
                          onViewCodexResetCredits(conn);
                        }}
                        disabled={isLoading || rowBusy}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-text-primary hover:bg-surface-2 disabled:opacity-40"
                      >
                        <span className="material-symbols-outlined text-[16px] text-text-muted">
                          schedule
                        </span>
                        <span>Reset Credits History</span>
                      </button>
                      <div className="my-1 h-px bg-border-subtle" />
                    </>
                  )}

                  {AUTO_PING_SETTINGS_KEYS[conn.provider] &&
                    conn.authType === "oauth" && (
                      <button
                        type="button"
                        onClick={() => {
                          onToggleAutoPing(
                            conn.id,
                            conn.provider,
                            !(
                              autoPingMaps[conn.provider]?.[conn.id] ===
                              true
                            )
                          );
                          setMobileActionsConnId(null);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-text-primary hover:bg-surface-2"
                      >
                        <span
                          className={`material-symbols-outlined text-[16px] ${autoPingMaps[conn.provider]?.[conn.id] === true ? "text-amber-500" : "text-text-muted"}`}
                        >
                          bolt
                        </span>
                        <span>
                          Auto-ping:{" "}
                          {autoPingMaps[conn.provider]?.[conn.id] ===
                          true
                            ? "On"
                            : "Off"}
                        </span>
                      </button>
                    )}

                  <button
                    type="button"
                    onClick={() => {
                      setMobileActionsConnId(null);
                      onSelectEdit(conn);
                    }}
                    disabled={rowBusy}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-text-primary hover:bg-surface-2 disabled:opacity-40"
                  >
                    <span className="material-symbols-outlined text-[16px] text-text-muted">
                      edit
                    </span>
                    <span>Edit Connection</span>
                  </button>

                  <div className="my-1 h-px bg-border-subtle" />

                  <button
                    type="button"
                    onClick={() => {
                      setMobileActionsConnId(null);
                      onDeleteConnection(conn.id);
                    }}
                    disabled={rowBusy}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-rose-500 hover:bg-rose-500/10 disabled:opacity-40"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      delete
                    </span>
                    <span>Delete Connection</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Kiro extra metadata bar if relevant */}
      {conn.provider === "kiro" && (
        <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-1.5 bg-surface-2/40 border-b border-border-subtle/50 text-[10.5px]">
          <span className="rounded-md bg-brand-500/10 px-1.5 py-0.5 font-medium text-brand-600 dark:text-brand-300">
            {kiroMethodLabel(conn)}
          </span>
          {kiroRegion(conn) && (
            <span className="rounded-md bg-blue-500/10 px-1.5 py-0.5 font-medium text-blue-600 dark:text-blue-400">
              {kiroRegion(conn)}
            </span>
          )}
          <span
            className={`rounded-md px-1.5 py-0.5 font-medium ${
              isInactive
                ? "bg-surface-3 text-text-muted"
                : conn.testStatus === "active" || conn.testStatus === "success"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : conn.testStatus === "error" || conn.testStatus === "expired" || conn.testStatus === "unavailable"
                    ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                    : "bg-surface-3 text-text-muted"
            }`}
          >
            {isInactive ? "disabled" : conn.testStatus || "unknown"}
          </span>
          {conn.providerSpecificData?.profileArn && (
            <button
              type="button"
              onClick={() => copy(conn.providerSpecificData.profileArn, conn.id)}
              title={conn.providerSpecificData.profileArn}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border-subtle px-1.5 py-0.5 text-text-muted transition-colors hover:text-primary hover:border-primary/30"
            >
              <span className="material-symbols-outlined text-[12px]">
                {copied === conn.id ? "check" : "content_copy"}
              </span>
              <code className="truncate font-mono text-[10px]">
                {conn.providerSpecificData.profileArn}
              </code>
            </button>
          )}
        </div>
      )}

      {/* Card Content / Quotas */}
      <div className="flex-1 p-3">
        {isLoading ? (
          <div className="space-y-2 py-2">
            <div className="flex items-center justify-between">
              <div className="h-3 w-24 bg-surface-3/80 rounded animate-pulse" />
              <div className="h-3 w-12 bg-surface-3/80 rounded animate-pulse" />
            </div>
            <div className="h-1.5 w-full bg-surface-3/60 rounded-full animate-pulse" />
            <div className="flex items-center justify-between">
              <div className="h-2.5 w-16 bg-surface-3/60 rounded animate-pulse" />
              <div className="h-2.5 w-20 bg-surface-3/60 rounded animate-pulse" />
            </div>
          </div>
        ) : error ? (
          <div className="flex items-center gap-2.5 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-rose-500">
            <span className="material-symbols-outlined shrink-0 text-[18px]">
              error
            </span>
            <p className="truncate">{error}</p>
          </div>
        ) : quota?.message ? (
          <div className="rounded-lg border border-border-subtle bg-surface-2/30 p-3 text-center text-xs text-text-muted">
            <p>{quota.message}</p>
          </div>
        ) : (
          <QuotaTable
            quotas={visibleQuotas}
            compact
            sortMode="default"
            showSortLabel={
              conn.provider === "codex" && quotaSortMode !== "default"
            }
            onHideQuota={(quotaRow) => onHideQuota(conn.provider, quotaRow)}
          />
        )}
        {hiddenQuotaRows.length > 0 && (
          <div className="mt-2.5 border-t border-border-subtle/60 pt-2 text-[10px] text-text-muted">
            {/* Mobile toggle button / count */}
            <div className="flex sm:hidden items-center justify-between gap-2">
              <button
                type="button"
                onClick={() =>
                  setMobileHiddenRevealed((prev) => ({
                    ...prev,
                    [conn.id]: !prev[conn.id],
                  }))
                }
                className="flex items-center gap-1 font-medium text-text-muted hover:text-text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">
                  {mobileHiddenRevealed[conn.id]
                    ? "expand_less"
                    : "visibility_off"}
                </span>
                <span>
                  {hiddenQuotaRows.length} hidden quota
                  {hiddenQuotaRows.length > 1 ? "s" : ""}
                </span>
              </button>
              <button
                type="button"
                onClick={() =>
                  setMobileHiddenRevealed((prev) => ({
                    ...prev,
                    [conn.id]: !prev[conn.id],
                  }))
                }
                className="text-[10px] text-primary underline decoration-primary/30"
              >
                {mobileHiddenRevealed[conn.id] ? "Hide list" : "Show list"}
              </button>
            </div>

            {/* Mobile expanded reveal chips */}
            {mobileHiddenRevealed[conn.id] && (
              <div className="mt-2 flex sm:hidden flex-wrap gap-1">
                {hiddenQuotaRows.map((quotaRow) => (
                  <button
                    key={getQuotaVisibilityKey(quotaRow)}
                    type="button"
                    onClick={() =>
                      onShowQuota(conn.provider, quotaRow)
                    }
                    className="inline-flex items-center gap-1 rounded border border-border-subtle bg-surface-2/60 px-2 py-1 text-[10px] text-text-primary transition-colors hover:bg-surface-3"
                    title="Unhide this quota row"
                  >
                    <span className="material-symbols-outlined text-[11px] text-text-muted">
                      visibility
                    </span>
                    <span>{quotaRow.name}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Desktop horizontal strip */}
            <div className="hidden sm:flex min-w-0 items-center gap-1.5">
              <span className="material-symbols-outlined shrink-0 text-[13px]">
                visibility_off
              </span>
              <span className="shrink-0 font-medium">Hidden:</span>
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap">
                {hiddenQuotaRows.map((quotaRow) => (
                  <button
                    key={getQuotaVisibilityKey(quotaRow)}
                    type="button"
                    onClick={() =>
                      onShowQuota(conn.provider, quotaRow)
                    }
                    className="shrink-0 rounded border border-border-subtle bg-surface-2/50 px-1.5 py-0.5 text-[10px] transition-colors hover:bg-surface-3 hover:text-text-primary"
                    title="Show this quota row"
                  >
                    {quotaRow.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProviderLimits() {
  const { copied, copy } = useCopyToClipboard();
  const [connections, setConnections] = useState([]);
  const [quotaData, setQuotaData] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoPingMaps, setAutoPingMaps] = useState({ claude: {}, codex: {} });
  const [lastUpdated, setLastUpdated] = useState(null);
  const [hasHydratedAutoRefresh, setHasHydratedAutoRefresh] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [resettingLimitId, setResettingLimitId] = useState(null);
  const [resetConfirmState, setResetConfirmState] = useState(null);
  const [resetCreditsState, setResetCreditsState] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [proxyPools, setProxyPools] = useState([]);
  const [providerFilter, setProviderFilter] = useState("all");
  const [providerOptions, setProviderOptions] = useState([]);
  const [accountFilter, setAccountFilter] = useState("all");
  const [quotaSortMode, setQuotaSortMode] = useState("default");
  const [quotaVisibility, setQuotaVisibility] = useState({});
  const [expiringFirst, setExpiringFirst] = useState(false);
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [bulkToggling, setBulkToggling] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(CONNECTIONS_PAGE_SIZE);
  const [customPageSizeInput, setCustomPageSizeInput] = useState(
    String(CONNECTIONS_PAGE_SIZE),
  );
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: CONNECTIONS_PAGE_SIZE,
    total: 0,
    totalPages: 1,
  });
  const [totals, setTotals] = useState({
    eligibleConnections: 0,
    providerFilteredConnections: 0,
  });

  const [customCardOrder, setCustomCardOrderState] = useState([]);

  const isCustomReorderActive = !expiringFirst && (providerFilter !== "codex" || quotaSortMode === "default");

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = getCustomCardOrder();
    setCustomCardOrderState(stored);
  }, []);

  const handleResetCardOrder = useCallback(() => {
    setCustomCardOrderState([]);
    setCustomCardOrder([]);
  }, []);

  const [mobileActionsConnId, setMobileActionsConnId] = useState(null);
  const [mobileHiddenRevealed, setMobileHiddenRevealed] = useState({});
  const intervalRef = useRef(null);
  const countdownRef = useRef(null);
  const tickCountRef = useRef(0);

  const fetchConnections = useCallback(
    async (targetPage = page) => {
      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          pageSize: String(pageSize),
          accountStatus: accountFilter,
          sort: "priority",
        });

        if (providerFilter !== "all") {
          params.set("provider", providerFilter);
        }

        const response = await fetch(
          `/api/providers/client?${params.toString()}`,
        );
        if (!response.ok) throw new Error("Failed to fetch connections");

        const data = await response.json();
        const connectionList = data.connections || [];
        const nextPagination = getSafePagination(data.pagination, pageSize);
        const nextTotals = getSafeTotals(data.totals, connectionList.length);

        setConnections(connectionList);
        setProviderOptions(getProviderOptions(data.providerOptions));
        setPagination(nextPagination);
        setTotals(nextTotals);
        setPage(getPaginationPageValue(data.pagination, targetPage));
        return connectionList;
      } catch (error) {
        console.error("Error fetching connections:", error);
        setConnections([]);
        setProviderOptions([]);
        setPagination({ page: 1, pageSize, total: 0, totalPages: 1 });
        setTotals({ eligibleConnections: 0, providerFilteredConnections: 0 });
        return [];
      }
    },
    [accountFilter, page, pageSize, providerFilter],
  );

  // Fetch quota for a specific connection
  const fetchQuota = useCallback(async (connectionId, provider, { force = false } = {}) => {
    setLoading((prev) => ({ ...prev, [connectionId]: true }));
    setErrors((prev) => ({ ...prev, [connectionId]: null }));

    try {
      console.log(
        `[ProviderLimits] Fetching quota for ${provider} (${connectionId})`,
      );
      const url = `/api/usage/${connectionId}${force ? "?force=1" : ""}`;
      const response = await fetch(url);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || response.statusText;

        // Handle different error types gracefully
        if (response.status === 404) {
          // Connection not found - skip silently
          console.warn(
            `[ProviderLimits] Connection not found for ${provider}, skipping`,
          );
          return;
        }

        if (response.status === 401) {
          // Auth error - show message instead of throwing
          console.warn(
            `[ProviderLimits] Auth error for ${provider}:`,
            errorMsg,
          );
          const quotaEntry = {
            quotas: [],
            message: errorMsg,
          };
          setQuotaData((prev) => ({
            ...prev,
            [connectionId]: quotaEntry,
          }));
          setQuotaCache(connectionId, quotaEntry);
          return;
        }

        throw new Error(`HTTP ${response.status}: ${errorMsg}`);
      }

      const data = await response.json();
      console.log(`[ProviderLimits] Got quota for ${provider}:`, data);

      // Parse quota data using provider-specific parser
      const parsedQuotas = parseQuotaData(provider, data);

      const quotaEntry = {
        quotas: parsedQuotas,
        plan: data.plan || null,
        message: data.message || null,
        raw: data,
      };

      setQuotaData((prev) => ({
        ...prev,
        [connectionId]: quotaEntry,
      }));
      setQuotaCache(connectionId, quotaEntry);
    } catch (error) {
      console.error(
        `[ProviderLimits] Error fetching quota for ${provider} (${connectionId}):`,
        error,
      );
      setErrors((prev) => ({
        ...prev,
        [connectionId]: error.message || "Failed to fetch quota",
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [connectionId]: false }));
    }
  }, []);

  // Refresh quota for a specific provider
  const refreshProvider = useCallback(
    async (connectionId, provider) => {
      await fetchQuota(connectionId, provider, { force: true });
      setLastUpdated(new Date());
    },
    [fetchQuota],
  );

  const handleResetCodexLimit = useCallback(
    async (connectionId, provider) => {
      if (provider !== "codex" || resettingLimitId) return;

      setResettingLimitId(connectionId);
      setErrors((prev) => ({ ...prev, [connectionId]: null }));

      try {
        const response = await fetch(`/api/usage/${connectionId}/codex-reset-credits`, { method: "POST" });
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(result.message || result.error || result.code || "Failed to reset Codex limit");
        }

        await fetchQuota(connectionId, provider);
        setLastUpdated(new Date());
      } catch (error) {
        setErrors((prev) => ({ ...prev, [connectionId]: error.message || "Failed to reset Codex limit" }));
      } finally {
        setResettingLimitId(null);
      }
    },
    [fetchQuota, resettingLimitId],
  );

  const handleViewCodexResetCredits = useCallback(async (connection) => {
    setResetCreditsState({ connection, loading: true, error: null, data: null });
    try {
      const response = await fetch(`/api/usage/${connection.id}/codex-reset-credits`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || result.message || "Failed to load Codex reset credits");
      }
      const credits = Array.isArray(result.credits) ? [...result.credits] : [];
      credits.sort((a, b) => {
        const aTime = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.POSITIVE_INFINITY;
        const bTime = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.POSITIVE_INFINITY;
        return aTime - bTime;
      });
      setResetCreditsState({ connection, loading: false, error: null, data: { ...result, credits } });
    } catch (error) {
      setResetCreditsState({ connection, loading: false, error: error.message || "Failed to load Codex reset credits", data: null });
    }
  }, []);

  const handleDeleteConnection = useCallback(
    async (id) => {
      if (!confirm("Delete this connection?")) return;
      setDeletingId(id);
      try {
        const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
        if (res.ok) {
          setQuotaData((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          setLoading((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          setErrors((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });

          if (typeof window !== "undefined") {
            try {
              const cache = getQuotaCache();
              if (cache[id]) {
                delete cache[id];
                window.localStorage.setItem(
                  QUOTA_CACHE_KEY,
                  JSON.stringify(cache),
                );
              }
            } catch (e) {
              console.error("Error deleting cache entry:", e);
            }
          }

          await reconcileConnectionsPage(fetchConnections, page);
        }
      } catch (error) {
        console.error("Error deleting connection:", error);
      } finally {
        setDeletingId(null);
      }
    },
    [fetchConnections, page],
  );

  const handleToggleConnectionActive = useCallback(
    async (id, isActive) => {
      setTogglingId(id);
      try {
        const res = await fetch(`/api/providers/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive }),
        });
        if (res.ok) {
          setQuotaData((prev) => {
            const next = { ...prev };
            return next;
          });
          await reconcileConnectionsPage(fetchConnections, page);
        }
      } catch (error) {
        console.error("Error updating connection status:", error);
      } finally {
        setTogglingId(null);
      }
    },
    [fetchConnections, page],
  );

  const handleUpdateConnection = useCallback(
    async (formData) => {
      if (!selectedConnection?.id) return;
      const connectionId = selectedConnection.id;
      const provider = selectedConnection.provider;
      try {
        const res = await fetch(`/api/providers/${connectionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });
        if (res.ok) {
          await fetchConnections();
          setShowEditModal(false);
          setSelectedConnection(null);
          if (USAGE_SUPPORTED_PROVIDERS.includes(provider)) {
            await fetchQuota(connectionId, provider);
          }
        }
      } catch (error) {
        console.error("Error saving connection:", error);
      }
    },
    [selectedConnection, fetchConnections, fetchQuota],
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/proxy-pools?isActive=true", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data?.proxyPools) {
          setProxyPools(data.proxyPools);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshAll = useCallback(async (force = false) => {
    if (refreshingAll) return;

    setRefreshingAll(true);
    setCountdown(60);

    // Throttle Claude: poll its quota every Nth auto-tick (manual force bypasses)
    const tick = (tickCountRef.current += 1);
    const claudeEvery = Math.round(CLAUDE_REFRESH_INTERVAL_MS / REFRESH_INTERVAL_MS);
    const shouldFetch = (conn) =>
      force || conn.provider !== "claude" || tick % claudeEvery === 0;

    try {
      const visibleConnections = await fetchConnections(page);

      setLoading(buildLoadingState(visibleConnections));
      setErrors((prev) =>
        filterQuotaStateByConnections(prev, visibleConnections),
      );
      setQuotaData((prev) =>
        filterQuotaStateByConnections(prev, visibleConnections),
      );

      await Promise.all(
        visibleConnections
          .filter(shouldFetch)
          .map((conn) => fetchQuota(conn.id, conn.provider)),
      );

      setLastUpdated(new Date());
    } catch (error) {
      console.error("Error refreshing all providers:", error);
    } finally {
      setRefreshingAll(false);
    }
  }, [refreshingAll, fetchConnections, fetchQuota, page]);

  useEffect(() => {
    const initializeData = async () => {
      setConnectionsLoading(true);
      const visibleConnections = await fetchConnections(page);
      setConnectionsLoading(false);

      // Always fetch fresh quota on mount, no cache display
      setLoading(buildLoadingState(visibleConnections));
      setErrors((prev) =>
        filterQuotaStateByConnections(prev, visibleConnections),
      );
      setQuotaData((prev) =>
        filterQuotaStateByConnections(prev, visibleConnections),
      );

      await Promise.all(
        visibleConnections.map((conn) => fetchQuota(conn.id, conn.provider)),
      );
      setLastUpdated(new Date());
    };

    initializeData();
  }, [fetchConnections, fetchQuota, page]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
    setAutoRefresh(stored === null ? true : stored === "true");
    setHasHydratedAutoRefresh(true);
  }, []);

  // Persist auto-refresh preference
  useEffect(() => {
    if (typeof window === "undefined" || !hasHydratedAutoRefresh) return;
    window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(autoRefresh));
  }, [autoRefresh, hasHydratedAutoRefresh]);

  // Load auto-ping per-connection maps
  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((s) => {
        setAutoPingMaps({
          claude: s?.claudeAutoPing?.connections || {},
          codex: s?.codexAutoPing?.connections || {},
        });
        setQuotaVisibility(s?.quotaVisibility || {});
      })
      .catch(() => {});
  }, []);

  const toggleAutoPing = useCallback(async (connectionId, provider, on) => {
    const settingsKey = AUTO_PING_SETTINGS_KEYS[provider];
    if (!settingsKey) return;

    const previous = autoPingMaps;
    const nextProviderMap = { ...(autoPingMaps[provider] || {}), [connectionId]: on };
    const nextMaps = { ...autoPingMaps, [provider]: nextProviderMap };
    setAutoPingMaps(nextMaps);
    try {
      const r = await fetch("/api/settings", { cache: "no-store" });
      const s = r.ok ? await r.json() : {};
      const cfg = { ...(s[settingsKey] || {}), connections: nextProviderMap };
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [settingsKey]: cfg }),
      });
    } catch {
      setAutoPingMaps(previous);
    }
  }, [autoPingMaps]);

  const updateQuotaVisibility = useCallback(async (nextVisibility, previousVisibility) => {
    setQuotaVisibility(nextVisibility);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotaVisibility: nextVisibility }),
      });
      if (!response.ok) throw new Error("Failed to update quota visibility");
    } catch (error) {
      console.error("Error updating quota visibility:", error);
      setQuotaVisibility(previousVisibility);
    }
  }, []);

  const handleHideQuota = useCallback((provider, quota) => {
    const key = getQuotaVisibilityKey(quota);
    if (!provider || !key) return;

    const previous = quotaVisibility;
    const providerVisibility = previous[provider] || {};
    const hidden = new Set(providerVisibility.hidden || []);
    hidden.add(key);
    const next = {
      ...previous,
      [provider]: {
        ...providerVisibility,
        hidden: [...hidden],
      },
    };
    updateQuotaVisibility(next, previous);
  }, [quotaVisibility, updateQuotaVisibility]);

  const handleShowQuota = useCallback((provider, quota) => {
    const key = getQuotaVisibilityKey(quota);
    if (!provider || !key) return;

    const previous = quotaVisibility;
    const providerVisibility = previous[provider] || {};
    const hidden = new Set(providerVisibility.hidden || []);
    hidden.delete(key);
    const next = {
      ...previous,
      [provider]: {
        ...providerVisibility,
        hidden: [...hidden],
      },
    };
    updateQuotaVisibility(next, previous);
  }, [quotaVisibility, updateQuotaVisibility]);

  // Auto-refresh interval
  useEffect(() => {
    if (!hasHydratedAutoRefresh || !autoRefresh) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      return;
    }

    // Main refresh interval
    intervalRef.current = setInterval(() => {
      refreshAll();
    }, REFRESH_INTERVAL_MS);

    // Countdown interval
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) return 60;
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoRefresh, refreshAll, hasHydratedAutoRefresh]);

  // Pause auto-refresh when tab is hidden (Page Visibility API)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        if (countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
      } else if (autoRefresh && hasHydratedAutoRefresh) {
        // Resume auto-refresh when tab becomes visible
        intervalRef.current = setInterval(() => refreshAll(), REFRESH_INTERVAL_MS);
        countdownRef.current = setInterval(() => {
          setCountdown((prev) => (prev <= 1 ? 60 : prev - 1));
        }, 1000);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [autoRefresh, refreshAll, hasHydratedAutoRefresh]);

  const sortedConnections = useMemo(
    () =>
      sortVisibleConnections(
        connections,
        quotaData,
        expiringFirst,
        providerFilter,
        quotaSortMode,
        customCardOrder,
      ),
    [
      connections,
      quotaData,
      expiringFirst,
      providerFilter,
      quotaSortMode,
      customCardOrder,
    ],
  );

  const handleDragEnd = useCallback(
    (event) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const currentIds = sortedConnections.map((connection) => String(connection.id));
      const oldIndex = currentIds.indexOf(String(active.id));
      const newIndex = currentIds.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;

      const updatedList = updateCustomCardOrderList(
        customCardOrder,
        arrayMove(currentIds, oldIndex, newIndex),
      );
      setCustomCardOrderState(updatedList);
      setCustomCardOrder(updatedList);
    },
    [customCardOrder, sortedConnections],
  );

  const handleMoveCard = useCallback(
    (connectionId, direction) => {
      const currentIds = sortedConnections.map((connection) => String(connection.id));
      const currentIndex = currentIds.indexOf(String(connectionId));
      const nextIndex = direction === "up" || direction === "left"
        ? currentIndex - 1
        : currentIndex + 1;
      if (currentIndex === -1 || nextIndex < 0 || nextIndex >= currentIds.length) return;

      const updatedList = updateCustomCardOrderList(
        customCardOrder,
        arrayMove(currentIds, currentIndex, nextIndex),
      );
      setCustomCardOrderState(updatedList);
      setCustomCardOrder(updatedList);
    },
    [customCardOrder, sortedConnections],
  );

  // Connection is depleted when any quota entry hit the threshold
  const isConnectionDepleted = (conn) => {
    const quotas = quotaData[conn.id]?.quotas;
    if (!quotas?.length) return false;
    return quotas.some((q) => {
      if (!q.total || q.total <= 0) return false;
      return calculatePercentage(q.used, q.total) <= DEPLETED_QUOTA_THRESHOLD;
    });
  };

  const bulkSetActive = useCallback(
    async (targetIds, isActive) => {
      if (!targetIds.length || bulkToggling) return;
      setBulkToggling(true);
      try {
        await Promise.all(
          targetIds.map((id) =>
            fetch(`/api/providers/${id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ isActive }),
            }),
          ),
        );
        await reconcileConnectionsPage(fetchConnections, page);
      } catch (error) {
        console.error("Error bulk toggling connections:", error);
      } finally {
        setBulkToggling(false);
      }
    },
    [bulkToggling, fetchConnections, page],
  );

  const handleDisableDepleted = () => {
    const ids = sortedConnections
      .filter((c) => (c.isActive ?? true) && isConnectionDepleted(c))
      .map((c) => c.id);
    bulkSetActive(ids, false);
  };

  const handleEnableAvailable = () => {
    const ids = sortedConnections
      .filter((c) => !(c.isActive ?? true) && !isConnectionDepleted(c))
      .map((c) => c.id);
    bulkSetActive(ids, true);
  };

  const selectedProviderLabel =
    providerFilter === "all" ? "All providers" : providerFilter;
  const hasEligibleConnections = totals.eligibleConnections > 0;
  const hasVisibleConnections = sortedConnections.length > 0;
  const emptyState = getConnectionsEmptyMessage(
    totals,
    providerFilter,
    accountFilter,
  );
  const connectionsPageSummary = getConnectionsPaginationSummary(pagination);
  const isCustomPageSize = !ACCOUNT_PAGE_SIZE_OPTIONS.includes(pageSize);
  const pageSizeLabel = getPageSizeLabel(pageSize, isCustomPageSize);

  if (!connectionsLoading && !hasEligibleConnections) {
    return (
      <div className="rounded-2xl border border-border-subtle bg-surface p-12 text-center shadow-[var(--shadow-soft)]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2 text-text-muted">
          <span className="material-symbols-outlined text-[32px] opacity-60">cloud_off</span>
        </div>
        <h3 className="mt-4 text-base font-semibold text-text-primary">
          No Providers Connected
        </h3>
        <p className="mt-1.5 text-xs text-text-muted max-w-sm mx-auto leading-relaxed">
          Connect to providers with OAuth or API keys to track your live API quotas, limits, and reset schedules.
        </p>
      </div>
    );
  }

  if (!connectionsLoading && !hasVisibleConnections) {
    return (
      <div className="rounded-2xl border border-border-subtle bg-surface p-12 text-center shadow-[var(--shadow-soft)]">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2 text-text-muted">
          <span className="material-symbols-outlined text-[32px] opacity-60">{emptyState.icon}</span>
        </div>
        <h3 className="mt-4 text-base font-semibold text-text-primary">
          {emptyState.title}
        </h3>
        <p className="mt-1.5 text-xs text-text-muted max-w-sm mx-auto leading-relaxed">
          {emptyState.description}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface/50 px-3 py-2.5 sm:px-3.5">
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">
            Quota Accounts
          </span>
          <span className="rounded-full border border-border-subtle bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-muted">
            {pagination.total || sortedConnections.length}
          </span>
        </div>

        <div className="flex min-w-0 max-w-full flex-nowrap items-center gap-2 overflow-x-auto pb-1 sm:overflow-visible sm:pb-0">
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setProviderMenuOpen((prev) => !prev)}
              className="flex h-8 items-center justify-between gap-1.5 rounded-lg border border-border-subtle bg-surface px-2.5 text-xs text-text-primary shadow-xs transition-colors hover:bg-surface-2 hover:border-border"
              aria-haspopup="menu"
              aria-expanded={providerMenuOpen}
              title="Filter quota providers"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {providerFilter === "all" ? (
                  <span className="material-symbols-outlined text-[15px] text-text-muted">
                    apps
                  </span>
                ) : (
                  <ProviderIcon
                    src={`/providers/${providerFilter}.png`}
                    alt={providerFilter}
                    size={16}
                    className="size-4 rounded object-contain"
                    fallbackText={providerFilter.slice(0, 2).toUpperCase()}
                  />
                )}
                <span className="truncate capitalize font-medium">
                  {selectedProviderLabel}
                </span>
              </span>
              <span className="material-symbols-outlined text-[15px] text-text-muted">
                expand_more
              </span>
            </button>

            {providerMenuOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-30 bg-transparent"
                  aria-label="Close provider filter"
                  onClick={() => setProviderMenuOpen(false)}
                />
                <div className="absolute left-0 sm:left-auto sm:right-0 z-40 mt-1.5 w-60 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-xl ring-1 ring-black/5 dark:ring-white/5">
                  <button
                    type="button"
                    onClick={() => {
                      if (shouldResetPage(providerFilter, "all")) {
                        setPage(1);
                      }
                      setProviderFilter("all");
                      setProviderMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${providerFilter === "all" ? "bg-primary/10 text-primary font-medium" : "text-text-primary hover:bg-surface-2"}`}
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      apps
                    </span>
                    <span>All providers</span>
                    {providerFilter === "all" && (
                      <span className="material-symbols-outlined ml-auto text-[16px]">
                        check
                      </span>
                    )}
                  </button>
                  <div className="my-1 h-px bg-border-subtle" />
                  <div className="max-h-60 overflow-y-auto space-y-0.5">
                    {providerOptions.map((provider) => (
                      <button
                        key={provider}
                        type="button"
                        onClick={() => {
                          if (shouldResetPage(providerFilter, provider)) {
                            setPage(1);
                          }
                          setProviderFilter(provider);
                          setProviderMenuOpen(false);
                        }}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${providerFilter === provider ? "bg-primary/10 text-primary font-medium" : "text-text-primary hover:bg-surface-2"}`}
                      >
                        <ProviderIcon
                          src={`/providers/${provider}.png`}
                          alt={provider}
                          size={18}
                          className="size-4.5 rounded object-contain"
                          fallbackText={provider.slice(0, 2).toUpperCase()}
                        />
                        <span className="capitalize">
                          {provider}
                        </span>
                        {providerFilter === provider && (
                          <span className="material-symbols-outlined ml-auto text-[16px]">
                            check
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <select
            value={accountFilter}
            onChange={(event) => {
              const nextValue = event.target.value;
              if (shouldResetPage(accountFilter, nextValue)) {
                setPage(1);
              }
              setAccountFilter(nextValue);
            }}
            className="h-8 shrink-0 rounded-lg border border-border-subtle bg-surface px-2 text-xs font-medium text-text-primary outline-none transition-colors hover:bg-surface-2 hover:border-border"
            aria-label="Filter accounts by status"
          >
            {ACCOUNT_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {providerFilter === "codex" && (
            <select
              value={quotaSortMode}
              onChange={(event) => setQuotaSortMode(event.target.value)}
              className="h-8 shrink-0 rounded-lg border border-border-subtle bg-surface px-2 text-xs font-medium text-text-primary outline-none transition-colors hover:bg-surface-2 hover:border-border"
              aria-label="Sort Codex quotas by remaining"
            >
              {QUOTA_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => setExpiringFirst((prev) => !prev)}
            aria-pressed={expiringFirst}
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${expiringFirst ? "border-amber-500/40 bg-amber-500/10 text-amber-500" : "border-border-subtle bg-surface text-text-muted hover:bg-surface-2 hover:text-text-primary"}`}
            title="Sort accounts by earliest quota reset time"
          >
            <span className="material-symbols-outlined text-[15px]">
              hourglass_top
            </span>
            <span className="text-[11px] sm:text-xs">Expiring</span>
          </button>

          {/* Bulk: disable depleted */}
          <button
            type="button"
            onClick={handleDisableDepleted}
            disabled={bulkToggling}
            className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-rose-500/20 bg-rose-500/5 px-2 sm:px-2.5 text-xs font-medium text-rose-500 transition-colors hover:bg-rose-500/10 disabled:opacity-50"
            title="Disable connections with depleted quota on current page"
          >
            <span className="material-symbols-outlined text-[15px]">block</span>
            <span className="hidden sm:inline">Turn off Empty</span>
            <span className="sm:hidden text-[11px]">Off Empty</span>
          </button>

          {/* Bulk: enable available */}
          <button
            type="button"
            onClick={handleEnableAvailable}
            disabled={bulkToggling}
            className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2 sm:px-2.5 text-xs font-medium text-emerald-500 transition-colors hover:bg-emerald-500/10 disabled:opacity-50"
            title="Enable connections that still have quota on current page"
          >
            <span className="material-symbols-outlined text-[15px]">
              check_circle
            </span>
            <span className="hidden sm:inline">Turn on Available</span>
            <span className="sm:hidden text-[11px]">On Avail</span>
          </button>

          {customCardOrder.length > 0 && isCustomReorderActive && (
            <button
              type="button"
              onClick={handleResetCardOrder}
              className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-border-subtle bg-surface px-2 sm:px-2.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
              title="Reset card order to default grouping"
            >
              <span className="material-symbols-outlined text-[15px]">
                restart_alt
              </span>
              <span className="hidden sm:inline">Reset Order</span>
              <span className="sm:hidden text-[11px]">Reset</span>
            </button>
          )}

          {/* Auto-refresh toggle */}
          <button
            type="button"
            onClick={() => setAutoRefresh((prev) => !prev)}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-2 sm:px-2.5 text-xs font-medium transition-colors hover:bg-surface-2 hover:border-border"
            title={autoRefresh ? "Disable auto-refresh" : "Enable auto-refresh"}
          >
            <span
              className={`material-symbols-outlined text-[16px] ${
                autoRefresh ? "text-primary" : "text-text-muted"
              }`}
            >
              {autoRefresh ? "toggle_on" : "toggle_off"}
            </span>
            <span className="text-[11px] text-text-primary sm:text-xs">
              Auto
            </span>
            {autoRefresh && (
              <span className="text-[10px] text-text-muted tabular-nums">
                ({countdown}s)
              </span>
            )}
          </button>

          {/* Refresh all button */}
          <button
            type="button"
            onClick={() => refreshAll(true)}
            disabled={refreshingAll}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface text-text-muted shadow-[var(--shadow-soft)] transition-[background-color,color,border-color,transform] hover:-translate-y-px hover:bg-surface-2 hover:text-text-primary hover:border-border disabled:opacity-50"
            title="Refresh all"
          >
            <span
              className={`material-symbols-outlined text-[16px] ${refreshingAll ? "animate-spin text-primary" : ""}`}
            >
              refresh
            </span>
          </button>
        </div>
      </div>

      {/* Provider cards: 2 columns, compact */}
      {expiringFirst && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
          Expiring-first sort is active. Card dragging is disabled while semantic expiry sorting is enabled.
        </div>
      )}

      {providerFilter === "codex" && quotaSortMode !== "default" && (
        <div className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">
          Codex remaining % sort is active. Card dragging is disabled while semantic quota sorting is enabled.
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sortedConnections.map((c) => String(c.id))}
          strategy={rectSortingStrategy}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sortedConnections.map((conn, index) => {
              const quota = quotaData[conn.id];
              const isLoading = loading[conn.id];
              const error = errors[conn.id];

              // Use table layout for all providers
              const isInactive = conn.isActive === false;
              const isCodex = conn.provider === "codex";
              const resetCreditCount = getCodexResetCreditCount(quota);
              const isResettingLimit = resettingLimitId === conn.id;
              const rowBusy = deletingId === conn.id || togglingId === conn.id || isResettingLimit;
              const rawQuotas = quota?.quotas || [];
              const visibleQuotas = filterQuotasByVisibility(conn.provider, rawQuotas, quotaVisibility);
              const hiddenQuotaRows = getHiddenQuotaRows(conn.provider, rawQuotas, quotaVisibility);

              return (
                <SortableCard
                  key={conn.id}
                  id={String(conn.id)}
                  conn={conn}
                  index={index}
                  totalCount={sortedConnections.length}
                  isCustomReorderActive={isCustomReorderActive}
                  quota={quota}
                  isLoading={isLoading}
                  error={error}
                  isInactive={isInactive}
                  isCodex={isCodex}
                  resetCreditCount={resetCreditCount}
                  isResettingLimit={isResettingLimit}
                  rowBusy={rowBusy}
                  visibleQuotas={visibleQuotas}
                  hiddenQuotaRows={hiddenQuotaRows}
                  autoPingMaps={autoPingMaps}
                  copied={copied}
                  copy={copy}
                  mobileActionsConnId={mobileActionsConnId}
                  setMobileActionsConnId={setMobileActionsConnId}
                  mobileHiddenRevealed={mobileHiddenRevealed}
                  setMobileHiddenRevealed={setMobileHiddenRevealed}
                  quotaSortMode={quotaSortMode}
                  onRefreshProvider={refreshProvider}
                  onToggleAutoPing={toggleAutoPing}
                  onHideQuota={handleHideQuota}
                  onShowQuota={handleShowQuota}
                  onSelectEdit={(c) => {
                    setSelectedConnection(c);
                    setShowEditModal(true);
                  }}
                  onDeleteConnection={handleDeleteConnection}
                  onToggleActive={handleToggleConnectionActive}
                  onOpenResetConfirm={(c, count) => setResetConfirmState({ connection: c, resetCreditCount: count })}
                  onViewCodexResetCredits={handleViewCodexResetCredits}
                  onMoveCard={handleMoveCard}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      <div className="rounded-xl border border-border-subtle bg-surface px-3 py-2.5 shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-text-muted">{connectionsPageSummary}</span>
          <div className="flex flex-wrap items-center gap-2">
            <CompactSelect
              value={isCustomPageSize ? "custom" : String(pageSize)}
              onChange={(nextValue) => {
                if (nextValue === "custom") return;
                const nextPageSize = Number.parseInt(nextValue, 10);
                if (Number.isFinite(nextPageSize)) {
                  setPage(1);
                  setPageSize(nextPageSize);
                  setCustomPageSizeInput(String(nextPageSize));
                }
              }}
              options={[
                ...ACCOUNT_PAGE_SIZE_OPTIONS.map((option) => ({ value: String(option), label: `${option} / page` })),
                { value: "custom", label: "Custom" },
              ]}
              ariaLabel="Accounts per page"
              className="w-[122px]"
              openUp
            />
            <input
              type="number"
              min="1"
              max={String(ACCOUNT_PAGE_SIZE_MAX)}
              inputMode="numeric"
              value={customPageSizeInput}
              onChange={(event) => setCustomPageSizeInput(event.target.value)}
              onBlur={() => {
                const parsedValue = Number.parseInt(customPageSizeInput, 10);
                if (!Number.isFinite(parsedValue)) {
                  setCustomPageSizeInput(String(pageSize));
                  return;
                }
                const nextPageSize = Math.min(ACCOUNT_PAGE_SIZE_MAX, Math.max(1, parsedValue));
                setPage(1);
                setPageSize(nextPageSize);
                setCustomPageSizeInput(String(nextPageSize));
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                const parsedValue = Number.parseInt(customPageSizeInput, 10);
                if (!Number.isFinite(parsedValue)) {
                  setCustomPageSizeInput(String(pageSize));
                  return;
                }
                const nextPageSize = Math.min(ACCOUNT_PAGE_SIZE_MAX, Math.max(1, parsedValue));
                setPage(1);
                setPageSize(nextPageSize);
                setCustomPageSizeInput(String(nextPageSize));
              }}
              className="h-8 w-20 rounded-lg border border-border-subtle bg-surface px-2 text-xs font-medium text-text-primary outline-none transition-colors hover:bg-surface-2 hover:border-border"
              aria-label="Custom accounts per page"
              placeholder="Custom"
            />
            <span className="text-xs text-text-muted">Page {pagination.page} / {pagination.totalPages}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={
                pagination.page <= 1 || connectionsLoading || refreshingAll
              }
              className="flex h-8 items-center rounded-lg border border-border-subtle bg-surface px-2.5 text-xs font-medium text-text-primary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              First
            </button>
            <button
              type="button"
              onClick={() =>
                setPage((currentPage) => Math.max(1, currentPage - 1))
              }
              disabled={
                pagination.page <= 1 || connectionsLoading || refreshingAll
              }
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-subtle bg-surface text-text-primary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous accounts page"
            >
              <span className="material-symbols-outlined text-[16px]">
                chevron_left
              </span>
            </button>
            <button
              type="button"
              onClick={() =>
                setPage((currentPage) =>
                  Math.min(pagination.totalPages, currentPage + 1),
                )
              }
              disabled={
                pagination.page >= pagination.totalPages ||
                connectionsLoading ||
                refreshingAll
              }
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-subtle bg-surface text-text-primary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next accounts page"
            >
              <span className="material-symbols-outlined text-[16px]">
                chevron_right
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPage(pagination.totalPages)}
              disabled={
                pagination.page >= pagination.totalPages ||
                connectionsLoading ||
                refreshingAll
              }
              className="flex h-8 items-center rounded-lg border border-border-subtle bg-surface px-2.5 text-xs font-medium text-text-primary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Last
            </button>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={Boolean(resetConfirmState)}
        onClose={() => {
          if (!resettingLimitId) setResetConfirmState(null);
        }}
        onConfirm={async () => {
          const connection = resetConfirmState?.connection;
          if (!connection) return;
          await handleResetCodexLimit(connection.id, connection.provider);
          setResetConfirmState(null);
        }}
        title="Reset Codex limit?"
        message={`Use 1 Codex reset credit for ${getConnectionLabel(resetConfirmState?.connection || {}) || "this account"}. This cannot be undone. Remaining credits: ${resetConfirmState?.resetCreditCount ?? 0}.`}
        confirmText="Reset limit"
        cancelText="Cancel"
        variant="danger"
        loading={Boolean(resettingLimitId)}
      />

      {resetCreditsState && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 px-4 py-4 sm:px-6 sm:py-6" role="dialog" aria-modal="true" aria-labelledby="codex-reset-credit-expiry-title">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-border-subtle bg-surface-2/40 px-4 py-3">
              <div className="min-w-0">
                <h3 id="codex-reset-credit-expiry-title" className="text-sm font-semibold text-text-primary">Codex Reset Credit Expiry</h3>
                <p className="mt-0.5 truncate text-xs text-text-muted">
                  {getConnectionLabel(resetCreditsState.connection) || "Codex account"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setResetCreditsState(null)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
                aria-label="Close reset credit expiry modal"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>

            <div className="max-h-[70vh] overflow-auto bg-surface p-4">
              {resetCreditsState.loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-xs text-text-muted">
                  <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                  Loading reset credits...
                </div>
              ) : resetCreditsState.error ? (
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-500">
                  {resetCreditsState.error}
                </div>
              ) : resetCreditsState.data?.credits?.length ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-xl border border-border-subtle bg-surface-2/40 px-3 py-2 text-xs text-text-muted">
                    <span>{resetCreditsState.data.credits.length} reset credit{resetCreditsState.data.credits.length === 1 ? "" : "s"}</span>
                    <span className="font-medium text-text-primary">{resetCreditsState.data.availableCount ?? 0} available</span>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-border-subtle">
                    <table className="w-full min-w-[500px] text-left text-xs">
                      <thead className="bg-surface-2/60 text-[11px] uppercase tracking-wider text-text-muted">
                        <tr>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 font-medium">Granted At</th>
                          <th className="px-3 py-2 font-medium">Expires At</th>
                          <th className="px-3 py-2 font-medium">Remaining</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resetCreditsState.data.credits.map((credit, index) => (
                          <tr key={`${credit.status}-${credit.expiresAt || index}`} className="border-t border-border-subtle">
                            <td className="px-3 py-2">
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-medium text-primary">
                                {credit.status || "unknown"}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-text-muted">{formatCreditDate(credit.grantedAt)}</td>
                            <td className="px-3 py-2 text-text-primary">{formatCreditDate(credit.expiresAt)}</td>
                            <td className="px-3 py-2 font-medium text-text-primary">{formatTimeRemaining(credit.expiresAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-border-subtle bg-surface-2/40 px-3 py-8 text-center text-xs text-text-muted">
                  No reset credit details returned for this account.
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        proxyPools={proxyPools}
        onSave={handleUpdateConnection}
        onClose={() => {
          setShowEditModal(false);
          setSelectedConnection(null);
        }}
      />
    </div>
  );
}
