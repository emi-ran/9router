"use client";

import { useEffect, useMemo, useState } from "react";
import { formatResetTime, getRemainingPercentage } from "./utils";

const PAGE_SIZE = 10;

/**
 * Format reset time display (Today, 12:00 PM)
 */
function formatResetTimeDisplay(resetTime) {
  if (!resetTime) return null;

  try {
    const date = new Date(resetTime);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let dayStr = "";
    if (date >= today && date < tomorrow) {
      dayStr = "Today";
    } else if (date >= tomorrow && date < new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)) {
      dayStr = "Tomorrow";
    } else {
      dayStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }

    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    return `${dayStr}, ${timeStr}`;
  } catch {
    return null;
  }
}

/**
 * Get color classes based on remaining percentage
 */
function getColorClasses(remainingPercentage) {
  if (remainingPercentage > 70) {
    return {
      text: "text-emerald-500 dark:text-emerald-400",
      bg: "bg-emerald-500 dark:bg-emerald-400",
      bgLight: "bg-emerald-500/10",
      dot: "bg-emerald-500",
      badge: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    };
  }

  if (remainingPercentage >= 30) {
    return {
      text: "text-amber-500 dark:text-amber-400",
      bg: "bg-amber-500 dark:bg-amber-400",
      bgLight: "bg-amber-500/10",
      dot: "bg-amber-500",
      badge: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    };
  }

  return {
    text: "text-rose-500 dark:text-rose-400",
    bg: "bg-rose-500 dark:bg-rose-400",
    bgLight: "bg-rose-500/10",
    dot: "bg-rose-500",
    badge: "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  };
}

function sortQuotas(quotas, sortMode) {
  if (sortMode === "remaining-asc") {
    return [...quotas].sort((a, b) => a.remaining - b.remaining || a.name.localeCompare(b.name));
  }

  if (sortMode === "remaining-desc") {
    return [...quotas].sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name));
  }

  return quotas;
}

/**
 * Quota Table Component - Table-based display for quota data
 */
export default function QuotaTable({
  quotas = [],
  compact = false,
  sortMode = "default",
  showSortLabel = false,
  onHideQuota = null,
}) {
  const [page, setPage] = useState(1);

  const normalizedQuotas = useMemo(
    () => quotas.map((quota, index) => ({
      ...quota,
      index,
      remaining: getRemainingPercentage(quota),
    })),
    [quotas],
  );

  const sortedQuotas = useMemo(
    () => sortQuotas(normalizedQuotas, sortMode),
    [normalizedQuotas, sortMode],
  );

  const totalPages = Math.max(1, Math.ceil(sortedQuotas.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);

  if (!quotas || quotas.length === 0) {
    return null;
  }

  const currentPageRows = sortedQuotas.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const pageStart = sortedQuotas.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(safePage * PAGE_SIZE, sortedQuotas.length);

  const cellPad = compact ? "py-2 px-2.5" : "py-2.5 px-3";
  const nameText = compact ? "text-xs" : "text-sm";
  const resetPrimary = compact ? "text-[11px]" : "text-xs";
  const resetSecondary = compact ? "text-[10px] leading-tight" : "text-[11px]";
  const sortLabel = "Sorted by account remaining";
  const hasHideAction = typeof onHideQuota === "function";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium text-text-muted">
          {sortedQuotas.length} quota{sortedQuotas.length > 1 ? "s" : ""}
        </div>
        {showSortLabel && (
          <div className="rounded-md border border-border-subtle bg-surface-2/60 px-2 py-0.5 text-[10px] font-medium text-text-muted">
            {sortLabel}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        {currentPageRows.map((quota) => {
          const isUnlimited = quota.unlimited === true;
          const colors = getColorClasses(quota.remaining);
          const countdown = formatResetTime(quota.resetAt);
          const resetDisplay = formatResetTimeDisplay(quota.resetAt);
          // recurring defaults true: a missing flag means the quota
          // refreshes at resetAt. Bonus/one-shot packs set recurring:false
          // and their resetAt is a hard expiry, so word it as "expires".
          const recurring = quota.recurring !== false;
          const countdownLabel = recurring ? `in ${countdown}` : `exp in ${countdown}`;

          return (
            <div
              key={`${quota.name}-${quota.index}`}
              className={`group/row relative flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-border-subtle/70 bg-surface-2/30 hover:bg-surface-2/70 transition-all ${cellPad}`}
            >
              {/* Top/Left: Name + Status */}
              <div className="flex items-center justify-between sm:justify-start sm:w-40 shrink-0 gap-2 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isUnlimited ? "bg-emerald-500" : colors.dot}`} />
                  <span className={`${nameText} font-medium text-text-primary truncate`} title={quota.name}>
                    {quota.name}
                  </span>
                </div>
                {/* Mobile-only percentage badge */}
                <div className="sm:hidden flex items-center gap-1.5">
                  <span className={`inline-flex items-center rounded-full border px-1.5 py-0.2 text-[10px] font-semibold tabular-nums ${isUnlimited ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-500" : colors.badge}`}>
                    {isUnlimited ? "∞" : `${quota.remaining}%`}
                  </span>
                </div>
              </div>

              {/* Middle: Progress + used/total */}
              <div className="min-w-0 flex-1 space-y-1">
                {!isUnlimited && (
                  <div className="h-1.5 w-full rounded-full overflow-hidden bg-surface-3/80 dark:bg-neutral-800">
                    <div
                      className={`h-full transition-all duration-300 rounded-full ${colors.bg}`}
                      style={{ width: `${Math.min(quota.remaining, 100)}%` }}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between gap-1 text-[11px] tabular-nums">
                  <span
                    className="text-text-muted truncate font-mono text-[10.5px]"
                    title={
                      isUnlimited
                        ? `${quota.used.toLocaleString()} used · Unlimited`
                        : `${quota.used.toLocaleString()} / ${quota.total > 0 ? quota.total.toLocaleString() : "∞"}`
                    }
                  >
                    {isUnlimited
                      ? `${quota.used.toLocaleString()} used · Unlimited`
                      : `${quota.used.toLocaleString()} / ${quota.total > 0 ? quota.total.toLocaleString() : "∞"}`}
                  </span>
                  <span className={`hidden sm:inline font-semibold text-[11px] ${isUnlimited ? "text-emerald-500" : colors.text}`}>
                    {isUnlimited ? "Unlimited" : `${quota.remaining}%`}
                  </span>
                </div>
              </div>

              {/* Right: Reset time info */}
              <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0 sm:w-28 text-right">
                {countdown !== "-" || resetDisplay ? (
                  <div className="min-w-0 flex flex-row sm:flex-col items-center sm:items-end gap-1.5 sm:gap-0">
                    {countdown !== "-" && (
                      <span className={`${resetPrimary} font-medium text-text-primary truncate tabular-nums`}>
                        {countdownLabel}
                      </span>
                    )}
                    {resetDisplay && (
                      <span className={`${resetSecondary} text-text-muted/80 truncate`} title={resetDisplay}>
                        {resetDisplay}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className={`${resetPrimary} text-text-muted/60`}>—</span>
                )}

                {/* Hide action button */}
                {hasHideAction && (
                  <button
                    type="button"
                    onClick={() => onHideQuota(quota)}
                    className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-3 hover:text-text-primary transition-all"
                    title="Hide this quota row"
                    aria-label={`Hide quota ${quota.name}`}
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      visibility_off
                    </span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="rounded-md border border-black/10 bg-black/[0.02] px-2 py-1.5 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex items-center justify-between gap-2 text-[10px] text-text-muted">
            <span>
              Showing {pageStart}-{pageEnd} of {sortedQuotas.length}
            </span>
            <span>
              Page {safePage} / {totalPages}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setPage(safePage - 1)}
              disabled={safePage <= 1}
              className="flex h-6 items-center rounded-md border border-black/10 px-2 text-[10px] text-text-primary transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage(safePage + 1)}
              disabled={safePage >= totalPages}
              className="flex h-6 items-center rounded-md border border-black/10 px-2 text-[10px] text-text-primary transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
