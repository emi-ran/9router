"use client";

import { cn } from "@/shared/utils/cn";
import { formatResetTime } from "./utils";

// Calculate color based on remaining percentage
const getColorClasses = (remainingPercentage) => {
  if (remainingPercentage > 70) {
    return {
      text: "text-emerald-500 dark:text-emerald-400",
      bg: "bg-emerald-500 dark:bg-emerald-400",
      bgLight: "bg-emerald-500/10",
      dot: "bg-emerald-500",
    };
  }

  if (remainingPercentage >= 30) {
    return {
      text: "text-amber-500 dark:text-amber-400",
      bg: "bg-amber-500 dark:bg-amber-400",
      bgLight: "bg-amber-500/10",
      dot: "bg-amber-500",
    };
  }

  // 0-29% including 0% (out of quota) - show red
  return {
    text: "text-rose-500 dark:text-rose-400",
    bg: "bg-rose-500 dark:bg-rose-400",
    bgLight: "bg-rose-500/10",
    dot: "bg-rose-500",
  };
};

// Format reset time display
const formatResetTimeDisplay = (resetTime) => {
  if (!resetTime) return null;
  
  try {
    const resetDate = new Date(resetTime);
    const now = new Date();
    const isToday = resetDate.toDateString() === now.toDateString();
    const isTomorrow = resetDate.toDateString() === new Date(now.getTime() + 86400000).toDateString();
    
    const timeStr = resetDate.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    
    if (isToday) return `Today, ${timeStr}`;
    if (isTomorrow) return `Tomorrow, ${timeStr}`;
    
    return resetDate.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return null;
  }
};

export default function QuotaProgressBar({
  percentage = 0,
  label = "",
  used = 0,
  total = 0,
  unlimited = false,
  resetTime = null,
  recurring = true,
}) {
  const colors = getColorClasses(percentage);
  const countdown = formatResetTime(resetTime);
  const resetDisplay = formatResetTimeDisplay(resetTime);

  // recurring defaults true. One-shot packs (e.g. CodeBuddy CN bonus packs)
  // set recurring:false: resetTime is a hard expiry, so word it as "expires".
  const resetWord = recurring ? "Reset" : "Expires";

  // percentage is already remaining percentage (from ProviderLimitCard)
  const remaining = percentage;
  
  return (
    <div className="space-y-2">
      {/* Label and percentage */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", colors.dot)} />
          <span className="font-semibold text-text-primary truncate">
            {label}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className={cn("font-semibold tabular-nums text-xs", colors.text)}>
            {unlimited ? "Unlimited" : `${remaining}%`}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      {!unlimited && (
        <div className="h-1.5 w-full rounded-full overflow-hidden bg-surface-3/80 dark:bg-neutral-800">
          <div
            className={cn("h-full transition-all duration-300 rounded-full", colors.bg)}
            style={{ width: `${Math.min(remaining, 100)}%` }}
          />
        </div>
      )}

      {/* Usage details and countdown */}
      <div className="flex items-center justify-between text-[11px] text-text-muted tabular-nums">
        <span className="font-mono text-[10.5px]">
          {used.toLocaleString()} / {total.toLocaleString()}
        </span>
        {countdown !== "-" && (
          <div className="flex items-center gap-1">
            <span className="font-medium text-text-primary">{resetWord} in {countdown}</span>
          </div>
        )}
      </div>

      {/* Reset time display */}
      {resetDisplay && (
        <div className="text-xs text-text-muted/70">
          {resetWord} at {resetDisplay}
        </div>
      )}
    </div>
  );
}
