"use client";

import { useState, useEffect, useRef } from "react";
import { getStatusVariant as getConnectionStatusVariant } from "@/shared/utils/connectionStatus";
import PropTypes from "prop-types";
import { Badge, Toggle, Tooltip } from "@/shared/components";
import CooldownTimer from "./CooldownTimer";

export default function ConnectionRow({ connection, plan = null, proxyPools, isOAuth, isFirst, isLast, onMoveUp, onMoveDown, onToggleActive, onUpdateProxy, onEdit, onDelete, oneByOneStatus = null, autoPing = null }) {
  const [showProxyDropdown, setShowProxyDropdown] = useState(false);
  const [showMobileActions, setShowMobileActions] = useState(false);
  const [showMobileProxyOptions, setShowMobileProxyOptions] = useState(false);
  const [updatingProxy, setUpdatingProxy] = useState(false);
  const proxyDropdownRef = useRef(null);

  const proxyPoolMap = new Map((proxyPools || []).map((pool) => [pool.id, pool]));
  const boundProxyPoolId = connection.providerSpecificData?.proxyPoolId || null;
  const boundProxyPool = boundProxyPoolId ? proxyPoolMap.get(boundProxyPoolId) : null;
  const hasLegacyProxy = connection.providerSpecificData?.connectionProxyEnabled === true && !!connection.providerSpecificData?.connectionProxyUrl;
  const hasAnyProxy = !!boundProxyPoolId || hasLegacyProxy;
  const proxyDisplayText = boundProxyPool
    ? `Pool: ${boundProxyPool.name}`
    : boundProxyPoolId
      ? `Pool: ${boundProxyPoolId} (inactive/missing)`
      : hasLegacyProxy
        ? `Legacy: ${connection.providerSpecificData?.connectionProxyUrl}`
        : "";
  const autoPingTooltip = autoPing?.provider === "codex"
    ? "Auto-starts the next 5h Codex window after reset by sending a tiny gpt-5.5 request. Consumes a small amount of quota."
    : "When your 5h quota runs out, auto-sends a request the moment it resets so a new window starts right away.";

  let maskedProxyUrl = "";
  if (boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl) {
    const rawProxyUrl = boundProxyPool?.proxyUrl || connection.providerSpecificData?.connectionProxyUrl;
    try {
      const parsed = new URL(rawProxyUrl);
      maskedProxyUrl = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    } catch {
      maskedProxyUrl = rawProxyUrl;
    }
  }

  const noProxyText = boundProxyPool?.noProxy || connection.providerSpecificData?.connectionNoProxy || "";

  let proxyBadgeVariant = "default";
  if (boundProxyPool?.isActive === true) {
    proxyBadgeVariant = "success";
  } else if (boundProxyPoolId || hasLegacyProxy) {
    proxyBadgeVariant = "error";
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!showProxyDropdown && !showMobileActions) return;
    const handler = (e) => {
      if (proxyDropdownRef.current && !proxyDropdownRef.current.contains(e.target)) {
        setShowProxyDropdown(false);
        setShowMobileActions(false);
        setShowMobileProxyOptions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showProxyDropdown, showMobileActions]);

  const handleSelectProxy = async (poolId) => {
    setUpdatingProxy(true);
    try {
      await onUpdateProxy(poolId === "__none__" ? null : poolId);
    } finally {
      setUpdatingProxy(false);
      setShowProxyDropdown(false);
      setShowMobileActions(false);
      setShowMobileProxyOptions(false);
    }
  };

  const rowAuthType = connection.authType || (isOAuth ? "oauth" : "apikey");
  const isOAuthConnection = rowAuthType === "oauth";
  const isCookieConnection = rowAuthType === "cookie";
  const authLabel = isOAuthConnection ? "OAuth" : isCookieConnection ? "Cookie" : "API Key";
  const displayName = connection.name?.trim()
    || connection.email?.trim()
    || connection.displayName?.trim()
    || (isOAuthConnection ? "OAuth Account" : isCookieConnection ? "Cookie Account" : "API Key");
  const secondaryDisplayName = connection.name?.trim() && connection.email?.trim() && connection.name.trim() !== connection.email.trim()
    ? connection.email.trim()
    : connection.name?.trim() && connection.displayName?.trim() && connection.name.trim() !== connection.displayName.trim()
      ? connection.displayName.trim()
      : null;
  const liveCodexPlan = plan?.trim();
  const storedCodexPlan = connection.providerSpecificData?.chatgptPlanType?.trim();
  const codexPlan = connection.provider === "codex"
    ? liveCodexPlan && liveCodexPlan.toLowerCase() !== "unknown"
      ? liveCodexPlan
      : storedCodexPlan
    : null;
  const subscriptionExpiry = connection.provider === "codex" && codexPlan && !codexPlan.toLowerCase().includes("free")
    ? connection.providerSpecificData?.chatgptSubscriptionActiveUntil
    : null;
  const subscriptionExpiryDate = subscriptionExpiry ? new Date(subscriptionExpiry) : null;

  // Use useState + useEffect for impure Date.now() to avoid calling during render
  const [now, setNow] = useState(null);
  const [isCooldown, setIsCooldown] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(timeout);
  }, []);

  const subscriptionDaysRemaining = subscriptionExpiryDate && Number.isFinite(subscriptionExpiryDate.getTime()) && now !== null
    ? Math.ceil((subscriptionExpiryDate.getTime() - now) / 86_400_000)
    : null;
  const subscriptionExpiryLabel = subscriptionDaysRemaining === null
    ? null
    : subscriptionDaysRemaining < 0
      ? "Subscription ended"
      : subscriptionDaysRemaining === 0
        ? "Ends today"
        : `Ends in ${subscriptionDaysRemaining} day${subscriptionDaysRemaining === 1 ? "" : "s"}`;

  // Get earliest model lock timestamp (useEffect handles the Date.now() comparison)
  const modelLockUntil = Object.entries(connection)
    .filter(([k]) => k.startsWith("modelLock_"))
    .map(([, v]) => v)
    .filter(v => !!v)
    .sort()[0] || null;

  useEffect(() => {
    const checkCooldown = () => {
      const until = Object.entries(connection)
        .filter(([k]) => k.startsWith("modelLock_"))
        .map(([, v]) => v)
        .filter(v => v && new Date(v).getTime() > Date.now())
        .sort()[0] || null;
      setIsCooldown(!!until);
    };

    checkCooldown();
    const interval = modelLockUntil ? setInterval(checkCooldown, 1000) : null;
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [modelLockUntil]);

  // Determine effective status (override unavailable if cooldown expired)
  const effectiveStatus = (connection.testStatus === "unavailable" && !isCooldown)
    ? "active"  // Cooldown expired u2192 treat as active
    : connection.testStatus;

  const getStatusVariant = () => getConnectionStatusVariant(connection.isActive, effectiveStatus);

  const getOneByOneVariant = () => {
    if (!oneByOneStatus) return "default";
    if (oneByOneStatus.state === "success") return "success";
    if (oneByOneStatus.state === "failed") return "error";
    if (oneByOneStatus.state === "testing") return "primary";
    return "default";
  };

  const getOneByOneLabel = () => {
    if (!oneByOneStatus) return null;
    if (oneByOneStatus.state === "queued") return "queued";
    if (oneByOneStatus.state === "testing") return "testing";
    if (oneByOneStatus.state === "success") return "success";
    if (oneByOneStatus.state === "failed") return oneByOneStatus.error ? `failed: ${oneByOneStatus.error}` : "failed";
    return null;
  };

  return (
    <div className={`group relative flex min-w-0 flex-col gap-3 rounded-lg p-2 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between ${connection.isActive === false ? "opacity-60" : ""}`}>
      <div className="flex min-w-0 flex-1 items-start gap-2 pr-[76px] sm:items-center sm:gap-3 sm:pr-48">
        {/* Priority arrows */}
        <div className="hidden shrink-0 flex-col sm:flex">
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className={`p-0.5 rounded ${isFirst ? "text-text-muted/30 cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-primary"}`}
          >
            <span className="material-symbols-outlined text-sm">keyboard_arrow_up</span>
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className={`p-0.5 rounded ${isLast ? "text-text-muted/30 cursor-not-allowed" : "hover:bg-sidebar text-text-muted hover:text-primary"}`}
          >
            <span className="material-symbols-outlined text-sm">keyboard_arrow_down</span>
          </button>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{displayName}</p>
          {secondaryDisplayName && (
            <p className="text-xs text-text-muted truncate">{secondaryDisplayName}</p>
          )}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
            <Badge variant={getStatusVariant()} size="sm" dot>
              {connection.isActive === false ? "disabled" : (effectiveStatus || "Unknown")}
            </Badge>
            <Badge variant="default" size="sm">
              {authLabel}
            </Badge>
            {codexPlan && codexPlan.toLowerCase() !== "unknown" && (
              <Badge variant="primary" size="sm">
                {codexPlan}
              </Badge>
            )}
            {subscriptionExpiryLabel && (
              <Badge variant="default" size="sm" title={subscriptionExpiry}>
                {subscriptionExpiryLabel}
              </Badge>
            )}
            {hasAnyProxy && (
              <Badge variant={proxyBadgeVariant} size="sm">
                Proxy
              </Badge>
            )}
            {isCooldown && connection.isActive !== false && <CooldownTimer until={modelLockUntil} />}
            {connection.lastError && connection.isActive !== false && (
              <span className="max-w-full truncate text-xs text-red-500 sm:max-w-[300px]" title={connection.lastError}>
                {connection.lastError}
              </span>
            )}
            <span className="text-xs text-text-muted">#{connection.priority}</span>
            {connection.globalPriority && (
              <span className="text-xs text-text-muted">Auto: {connection.globalPriority}</span>
            )}
            {getOneByOneLabel() && (
              <Badge variant={getOneByOneVariant()} size="sm">
                {getOneByOneLabel()}
              </Badge>
            )}
          </div>
          {hasAnyProxy && (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="max-w-full truncate text-[11px] text-text-muted sm:max-w-[420px]" title={proxyDisplayText}>
                {proxyDisplayText}
              </span>
              {maskedProxyUrl && (
                <code className="max-w-full truncate rounded bg-black/5 px-1 py-0.5 font-mono text-[10px] text-text-muted dark:bg-white/5 sm:max-w-[260px]">
                  {maskedProxyUrl}
                </code>
              )}
              {noProxyText && (
                <span className="max-w-full truncate text-[11px] text-text-muted sm:max-w-[320px]" title={noProxyText}>
                  no_proxy: {noProxyText}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center justify-end gap-2" ref={proxyDropdownRef}>
        <div className="hidden sm:flex sm:flex-none sm:gap-1">
          {/* Proxy button with inline dropdown */}
          {(proxyPools || []).length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowProxyDropdown((v) => !v)}
                title="Proxy"
                className={`flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${hasAnyProxy ? "text-primary" : "text-text-muted hover:text-primary"}`}
                disabled={updatingProxy}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {updatingProxy ? "progress_activity" : "lan"}
                </span>
              </button>
              {showProxyDropdown && (
                <div className="absolute right-0 top-full z-50 mt-1 max-w-[78vw] min-w-[160px] rounded-lg border border-border bg-bg py-1 shadow-lg">
                  <button
                    onClick={() => handleSelectProxy("__none__")}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${!boundProxyPoolId ? "text-primary font-medium" : "text-text-main"}`}
                  >
                    None
                  </button>
                  {(proxyPools || []).map((pool) => (
                    <button
                      key={pool.id}
                      onClick={() => handleSelectProxy(pool.id)}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5 ${boundProxyPoolId === pool.id ? "text-primary font-medium" : "text-text-main"}`}
                    >
                      {pool.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {autoPing && (
            <Tooltip text={autoPingTooltip}>
              <button
                onClick={() => autoPing.onToggle(!autoPing.on)}
                title="Toggle auto-ping"
                className={`flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${autoPing.on ? "text-primary" : "text-text-muted hover:text-primary"}`}
              >
                <span className="material-symbols-outlined text-[18px]">bolt</span>
              </button>
            </Tooltip>
          )}
          <button onClick={onEdit} title="Edit connection" className="flex size-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5">
            <span className="material-symbols-outlined text-[18px]">edit</span>
          </button>
          <button onClick={onDelete} title="Delete connection" className="flex size-8 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-500/10">
            <span className="material-symbols-outlined text-[18px] leading-none">delete</span>
          </button>
        </div>
        <Toggle
          size="sm"
          variant="connection"
          className="h-8"
          checked={connection.isActive ?? true}
          onChange={onToggleActive}
          title={(connection.isActive ?? true) ? "Disable connection" : "Enable connection"}
        />
        <div className="relative sm:hidden">
          <button
            type="button"
            onClick={() => {
              setShowMobileActions((visible) => !visible);
              setShowMobileProxyOptions(false);
            }}
            aria-label="More connection actions"
            aria-expanded={showMobileActions}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <span className="material-symbols-outlined text-[19px]">more_vert</span>
          </button>
          {showMobileActions && (
            <div className="absolute right-0 z-50 mt-1 w-52 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-xl ring-1 ring-black/10 dark:ring-white/10">
              {showMobileProxyOptions ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowMobileProxyOptions(false)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-text-primary transition-colors hover:bg-surface-2"
                  >
                    <span className="material-symbols-outlined text-[16px] text-text-muted">arrow_back</span>
                    <span>Choose proxy</span>
                  </button>
                  <div className="my-1 h-px bg-border-subtle" />
                  <button
                    type="button"
                    onClick={() => handleSelectProxy("__none__")}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-surface-2 ${!boundProxyPoolId ? "text-primary" : "text-text-primary"}`}
                  >
                    <span className="material-symbols-outlined text-[16px]">link_off</span>
                    <span>None</span>
                  </button>
                  <div className="max-h-[min(50vh,18rem)] overflow-y-auto">
                    {(proxyPools || []).map((pool) => (
                      <button
                        type="button"
                        key={pool.id}
                        onClick={() => handleSelectProxy(pool.id)}
                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-surface-2 ${boundProxyPoolId === pool.id ? "text-primary" : "text-text-primary"}`}
                      >
                        <span className="material-symbols-outlined text-[16px]">lan</span>
                        <span className="truncate">{pool.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onMoveUp();
                      setShowMobileActions(false);
                    }}
                    disabled={isFirst}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-text-primary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="material-symbols-outlined text-[16px] text-text-muted">arrow_upward</span>
                    <span>Move earlier</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onMoveDown();
                      setShowMobileActions(false);
                    }}
                    disabled={isLast}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-text-primary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="material-symbols-outlined text-[16px] text-text-muted">arrow_downward</span>
                    <span>Move later</span>
                  </button>
                  <div className="my-1 h-px bg-border-subtle" />
                  {(proxyPools || []).length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowMobileProxyOptions(true)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-surface-2 ${hasAnyProxy ? "text-primary" : "text-text-primary"}`}
                    >
                      <span className="material-symbols-outlined text-[16px]">lan</span>
                      <span className="min-w-0 flex-1 truncate">{boundProxyPool?.name || "Proxy"}</span>
                      <span className="material-symbols-outlined text-[16px] text-text-muted">chevron_right</span>
                    </button>
                  )}
              {autoPing && (
                <button
                  type="button"
                  onClick={() => {
                    autoPing.onToggle(!autoPing.on);
                    setShowMobileActions(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-surface-2 ${autoPing.on ? "text-amber-500" : "text-text-primary"}`}
                >
                  <span className="material-symbols-outlined text-[16px]">bolt</span>
                  <span>{autoPing.on ? "Auto-ping on" : "Auto-ping off"}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  onEdit();
                  setShowMobileActions(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-text-primary transition-colors hover:bg-surface-2"
              >
                <span className="material-symbols-outlined text-[16px] text-text-muted">edit</span>
                <span>Edit connection</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onDelete();
                  setShowMobileActions(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-rose-500 transition-colors hover:bg-rose-500/10"
              >
                <span className="material-symbols-outlined text-[16px]">delete</span>
                <span>Delete connection</span>
              </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

ConnectionRow.propTypes = {
  connection: PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    displayName: PropTypes.string,
    modelLockUntil: PropTypes.string,
    testStatus: PropTypes.string,
    isActive: PropTypes.bool,
    lastError: PropTypes.string,
    priority: PropTypes.number,
    globalPriority: PropTypes.number,
  }).isRequired,
  plan: PropTypes.string,
  proxyPools: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    proxyUrl: PropTypes.string,
    noProxy: PropTypes.string,
    isActive: PropTypes.bool,
  })),
  isOAuth: PropTypes.bool.isRequired,
  isFirst: PropTypes.bool.isRequired,
  isLast: PropTypes.bool.isRequired,
  onMoveUp: PropTypes.func.isRequired,
  onMoveDown: PropTypes.func.isRequired,
  onToggleActive: PropTypes.func.isRequired,
  onUpdateProxy: PropTypes.func,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  oneByOneStatus: PropTypes.shape({
    state: PropTypes.string,
    error: PropTypes.string,
  }),
  autoPing: PropTypes.shape({
    on: PropTypes.bool,
    onToggle: PropTypes.func,
    provider: PropTypes.string,
  }),
};
