"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Card, Button, Input, Modal, CardSkeleton, Toggle, ConfirmModal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import {
  TUNNEL_BENEFITS,
  TUNNEL_PING_INTERVAL_MS,
  TUNNEL_PING_MAX_MS,
  STATUS_POLL_FAST_MS,
  REACHABLE_MISS_THRESHOLD,
  CLIENT_PING_FAST_MS,
} from "./endpointConstants";
import { clientPingAny } from "./endpointPing";
import useSettingsStore from "@/store/settingsStore";
import EndpointRow from "./components/EndpointRow";
import Tooltip from "./components/Tooltip";
import SecurityWarning from "./components/SecurityWarning";
export default function APIPageClient({ machineId }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState(null);
  const [confirmState, setConfirmState] = useState(null);

  const [requireApiKey, setRequireApiKey] = useState(false);
  const [requireLogin, setRequireLogin] = useState(true);
  const [hasPassword, setHasPassword] = useState(true);
 const [tunnelDashboardAccess, setTunnelDashboardAccess] = useState(false);

 // Cloudflare Tunnel state
  const [tunnelChecking, setTunnelChecking] = useState(true);
  const [tunnelEnabled, setTunnelEnabled] = useState(false);
  const [tunnelReachable, setTunnelReachable] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState("");
  const [tunnelPublicUrl, setTunnelPublicUrl] = useState("");
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [tunnelProgress, setTunnelProgress] = useState("");
  const [tunnelStatus, setTunnelStatus] = useState(null);
  const [showEnableTunnelModal, setShowEnableTunnelModal] = useState(false);
  const [showDisableTunnelModal, setShowDisableTunnelModal] = useState(false);

  // Debounce reachable=false: server may briefly return false during background refresh.
  // Only flip UI to "reconnecting" after N consecutive misses to avoid spinner flicker.
  const tunnelMissRef = useRef(0);
  // Browser-side reachable cache (independent of backend DNS quirks)
  const tunnelClientReachableRef = useRef(false);
  // Track whether reachable=true was ever observed in this session.
  // Distinguishes "Checking..." (initial cold cache) from "Reconnecting..." (lost connection).
  const tunnelEverReachableRef = useRef(false);
  const [tunnelEverReachable, setTunnelEverReachable] = useState(false);

  // API key visibility toggle state
  const [visibleKeys, setVisibleKeys] = useState(new Set());

  // Client-side local/remote detection (UI hint only, not a security gate)
  const [isRemoteHost, setIsRemoteHost] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined")
      setIsRemoteHost(!["localhost", "127.0.0.1", "::1"].includes(window.location.hostname));
  }, []);

  const { copied, copy } = useCopyToClipboard();

  // Security gate: block remote exposure while dashboard uses default password or login is off.
  const isLoginUnsafe = !requireLogin || !hasPassword;
  const unsafeReason = !requireLogin
    ? "Enable \"Require login\" and set a custom password before activating the tunnel."
    : "Change the default dashboard password before activating the tunnel.";

  useEffect(() => {
    fetchData();
    loadSettings();
  }, []);

  // Status poll: only while degraded (not yet reachable). Stop once healthy to avoid spam.
  // Visibility re-check: refresh once when tab becomes visible.
  useEffect(() => {
    if (!tunnelEnabled) return;
    const allHealthy = tunnelReachable;
    const onVisible = () => { if (!document.hidden) syncTunnelStatus(); };
    document.addEventListener("visibilitychange", onVisible);
    if (allHealthy) return () => document.removeEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => { if (!document.hidden) syncTunnelStatus(); }, STATUS_POLL_FAST_MS);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tunnelEnabled, tunnelReachable]);

  // Browser-side periodic ping: probes tunnel URLs directly so UI stays
  // "reachable" even when backend DNS (1.1.1.1) hiccups on *.trycloudflare.com.
  // Adaptive: slow when healthy, fast when degraded; pause when tab hidden.
  useEffect(() => {
    const probeBoth = async () => {
      if (document.hidden) return;
      if (tunnelEnabled && (tunnelUrl || tunnelPublicUrl)) {
        const ok = await clientPingAny(tunnelPublicUrl, tunnelUrl);
        tunnelClientReachableRef.current = ok;
        if (ok) { tunnelMissRef.current = 0; setTunnelReachable(true); if (!tunnelEverReachableRef.current) { tunnelEverReachableRef.current = true; setTunnelEverReachable(true); } }
        else { tunnelMissRef.current += 1; if (tunnelMissRef.current >= REACHABLE_MISS_THRESHOLD) setTunnelReachable(false); }
      } else {
        tunnelClientReachableRef.current = false;
      }
    };
    const anyEnabled = tunnelEnabled && (tunnelUrl || tunnelPublicUrl);
    if (!anyEnabled) return;
    probeBoth();
    const tunnelHealthy = !tunnelEnabled || tunnelReachable;
    if (tunnelHealthy) return;
    const id = setInterval(probeBoth, CLIENT_PING_FAST_MS);
    return () => clearInterval(id);
  }, [tunnelEnabled, tunnelUrl, tunnelPublicUrl, tunnelReachable]);

  // Client-side reachable only (server no longer probes; watchdog handles backend health).
  // Miss-debounce: only flip to false after N consecutive misses.
  const updateReachable = useCallback((_unused, clientRef, missRef, setter, everRef, everSetter) => {
    const reachable = clientRef.current;
    if (reachable) {
      missRef.current = 0;
      setter(true);
      if (!everRef.current) {
        everRef.current = true;
        everSetter(true);
      }
    } else {
      missRef.current += 1;
      if (missRef.current >= REACHABLE_MISS_THRESHOLD) setter(false);
    }
  }, []);

  // Trust user intent (settingsEnabled): UI stays "enabled" while watchdog restarts process
  const syncTunnelStatus = async () => {
    try {
      const statusRes = await fetch("/api/tunnel/status", { cache: "no-store" });
      if (!statusRes.ok) return;
      const data = await statusRes.json();
      const tEnabled = data.tunnel?.settingsEnabled ?? data.tunnel?.enabled ?? false;
      const tUrl = data.tunnel?.tunnelUrl || "";
      setTunnelUrl(tUrl);
      setTunnelPublicUrl(data.tunnel?.publicUrl || "");
      setTunnelEnabled(tEnabled);
      updateReachable(null, tunnelClientReachableRef, tunnelMissRef, setTunnelReachable, tunnelEverReachableRef, setTunnelEverReachable);

    } catch { /* ignore poll errors */ }
  };

  const loadSettings = async () => {
    setTunnelChecking(true);
    try {
      const [settingsData, statusRes] = await Promise.all([
        useSettingsStore.getState().fetchSettings(),
        fetch("/api/tunnel/status", { cache: "no-store" })
      ]);
      if (settingsData) {
        setRequireApiKey(settingsData.requireApiKey || false);
        setRequireLogin(settingsData.requireLogin !== false);
        setHasPassword(settingsData.hasPassword || false);
        setTunnelDashboardAccess(settingsData.tunnelDashboardAccess || false);
      }
      if (statusRes.ok) {
        const data = await statusRes.json();
        const tEnabled = data.tunnel?.settingsEnabled ?? data.tunnel?.enabled ?? false;
        const tUrl = data.tunnel?.tunnelUrl || "";
        setTunnelUrl(tUrl);
        setTunnelPublicUrl(data.tunnel?.publicUrl || "");
        setTunnelEnabled(tEnabled);
        updateReachable(null, tunnelClientReachableRef, tunnelMissRef, setTunnelReachable, tunnelEverReachableRef, setTunnelEverReachable);

      }
    } catch (error) {
      console.log("Error loading settings:", error);
    } finally {
      setTunnelChecking(false);
    }
  };

  const handleTunnelDashboardAccess = async (value) => {
    try {
      const updated = await useSettingsStore.getState().patchSettings({ tunnelDashboardAccess: value });
      if (updated) setTunnelDashboardAccess(value);
    } catch (error) {
      console.log("Error updating tunnelDashboardAccess:", error);
    }
  };

  const handleRequireApiKey = async (value) => {
    try {
      const updated = await useSettingsStore.getState().patchSettings({ requireApiKey: value });
      if (updated) setRequireApiKey(value);
    } catch (error) {
      console.log("Error updating requireApiKey:", error);
    }
  };

  const fetchData = async () => {
    try {
      const fetchKeys = async () => {
        const res = await fetch("/api/keys");
        if (!res.ok) return [];
        const data = await res.json();
        return data.keys || [];
      };

      let existing = await fetchKeys();
      // Auto-provision a default key for first-time users so the endpoint works out of the box.
      if (existing.length === 0) {
        try {
          const createRes = await fetch("/api/keys", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Default Key" }),
          });
          if (createRes.ok) existing = await fetchKeys();
        } catch { /* fall through to empty render */ }
      }
      setKeys(existing);
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  // u2500u2500u2500 Cloudflare Tunnel handlers
  // Ping tunnel health until reachable. Race multiple URLs (shortlink + direct) — 1 OK is enough.
  const pingTunnelHealth = async (...urls) => {
    setTunnelLoading(true);
    setTunnelProgress("Waiting for tunnel ready...");
    const targets = urls.filter(Boolean).map((u) => `${u}/api/health`);
    const start = Date.now();
    while (Date.now() - start < TUNNEL_PING_MAX_MS) {
      await new Promise((r) => setTimeout(r, TUNNEL_PING_INTERVAL_MS));
      const ok = await Promise.any(targets.map(async (h) => {
        const p = await fetch(h, { mode: "cors", cache: "no-store" });
        if (p.ok) return true;
        throw new Error("not ready");
      })).catch(() => false);
      if (ok) {
        setTunnelEnabled(true);
        setTunnelLoading(false);
        setTunnelProgress("");
        return true;
      }
      // Every 5 pings (~10s), check if backend process still alive
      if ((Date.now() - start) % 10000 < TUNNEL_PING_INTERVAL_MS) {
        try {
          const statusRes = await fetch("/api/tunnel/status");
          if (statusRes.ok) {
            const status = await statusRes.json();
            if (!status.tunnel?.enabled) {
              setTunnelStatus({ type: "error", message: "Tunnel process stopped unexpectedly." });
              setTunnelLoading(false);
              setTunnelProgress("");
              return false;
            }
          }
        } catch { /* ignore */ }
      }
    }
    setTunnelStatus({ type: "error", message: "Tunnel created but not reachable. Please try again." });
    setTunnelLoading(false);
    setTunnelProgress("");
    return false;
  };

  const handleEnableTunnel = async () => {
    setShowEnableTunnelModal(false);
    setTunnelLoading(true);
    setTunnelStatus(null);
    setTunnelProgress("Creating tunnel...");

    // Poll download progress while enable request is pending
    let polling = true;
    const pollProgress = async () => {
      while (polling) {
        try {
          const r = await fetch("/api/tunnel/status");
          if (r.ok) {
            const s = await r.json();
            if (s.download?.downloading) {
              setTunnelProgress(`Downloading cloudflared... ${s.download.progress}%`);
            } else if (polling) {
              setTunnelProgress("Creating tunnel...");
            }
          }
        } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    pollProgress();

    try {
      const res = await fetch("/api/tunnel/enable", { method: "POST" });
      polling = false;
      const data = await res.json();
      if (!res.ok) {
        setTunnelStatus({ type: "error", message: data.error || "Failed to enable tunnel" });
        return;
      }

      const url = data.tunnelUrl;
      if (!url) {
        setTunnelStatus({ type: "error", message: "No tunnel URL returned" });
        return;
      }

      setTunnelUrl(url);
      setTunnelPublicUrl(data.publicUrl || "");
      await pingTunnelHealth(data.publicUrl, url);
    } catch (error) {
      setTunnelStatus({ type: "error", message: error.message });
    } finally {
      polling = false;
      setTunnelLoading(false);
      setTunnelProgress("");
    }
  };

  const handleDisableTunnel = async () => {
    setTunnelLoading(true);
    setTunnelStatus(null);
    try {
      const res = await fetch("/api/tunnel/disable", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTunnelEnabled(false);
        setTunnelUrl("");
        setShowDisableTunnelModal(false);
        setTunnelStatus({ type: "success", message: "Tunnel disabled" });
      } else {
        setTunnelStatus({ type: "error", message: data.error || "Failed to disable tunnel" });
      }
    } catch (error) {
      setTunnelStatus({ type: "error", message: error.message });
    } finally {
      setTunnelLoading(false);
    }
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      });
      const data = await res.json();

      if (res.ok) {
        setCreatedKey(data.key);
        await fetchData();
        setNewKeyName("");
        setShowAddModal(false);
      }
    } catch (error) {
      console.log("Error creating key:", error);
    }
  };

  const handleDeleteKey = async (id) => {
    setConfirmState({
      title: "Delete API Key",
      message: "Delete this API key?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
          if (res.ok) {
            setKeys(keys.filter((k) => k.id !== id));
            setVisibleKeys(prev => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          }
        } catch (error) {
          console.log("Error deleting key:", error);
        }
      }
    });
  };

  const handleToggleKey = async (id, isActive) => {
    try {
      const res = await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setKeys(prev => prev.map(k => k.id === id ? { ...k, isActive } : k));
      }
    } catch (error) {
      console.log("Error toggling key:", error);
    }
  };

  const maskKey = (fullKey) => {
    if (!fullKey || fullKey.length <= 10) return fullKey || "";
    return fullKey.slice(0, 6) + "•".repeat(fullKey.length - 10) + fullKey.slice(-4);
  };

  const toggleKeyVisibility = (keyId) => {
    setVisibleKeys(prev => {
      const next = new Set(prev);
      if (next.has(keyId)) next.delete(keyId);
      else next.add(keyId);
      return next;
    });
  };

  const [baseUrl, setBaseUrl] = useState("/v1");

  // Hydration fix: Only access window on client side
  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(`${window.location.origin}/v1`);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const currentEndpoint = baseUrl;

  return (
    <div className="flex flex-col gap-8">
      {/* Endpoint Card */}
      <Card>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">api</span>
          API Endpoint
        </h2>

        {/* Endpoint rows */}
        <div className="flex flex-col gap-2">
          {/* Local */}
          <EndpointRow
            label="Local"
            url={currentEndpoint}
            copyId="local_url"
            copied={copied}
            onCopy={copy}
          />
          {/* Cloudflare Tunnel */}
          <div className="flex items-center gap-2 w-full min-w-0">
            <span className={`text-xs font-mono px-1.5 py-1 rounded shrink-0 min-w-[70px] sm:min-w-[80px] text-center ${
              tunnelEnabled ? "bg-primary/10 text-primary" : "bg-surface-2 text-text-muted"
            }`}>Tunnel</span>
            {tunnelEnabled && !tunnelLoading && tunnelReachable ? (
              <Input value={`${tunnelPublicUrl || tunnelUrl}/v1`} readOnly className="flex-1 min-w-0 font-mono text-sm" />
            ) : tunnelEnabled && !tunnelLoading && !tunnelReachable ? (
              <div className="flex-1 min-w-0 flex items-center gap-2 px-3 py-1.5 rounded border border-amber-300 dark:border-amber-800 bg-amber-500/5 text-sm text-amber-600 dark:text-amber-400 truncate">
                <span className="material-symbols-outlined animate-spin text-sm shrink-0">progress_activity</span>
                <span className="truncate">{tunnelEverReachable ? "Tunnel reconnecting..." : "Tunnel checking..."}</span>
              </div>
            ) : tunnelLoading ? (
              <div className="flex-1 min-w-0 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted truncate">
                <span className="material-symbols-outlined animate-spin text-sm shrink-0">progress_activity</span>
                <span className="truncate">{tunnelProgress || "Creating tunnel..."}</span>
              </div>
            ) : tunnelStatus?.type === "error" ? (
              <div className="flex-1 min-w-0 flex items-center gap-2 px-3 py-1.5 rounded border border-red-300 dark:border-red-800 bg-red-500/5 text-sm text-red-600 dark:text-red-400 truncate">
                <span className="material-symbols-outlined text-sm shrink-0">error</span>
                <span className="truncate">{tunnelStatus.message}</span>
              </div>
            ) : tunnelChecking ? (
              <div className="flex-1 min-w-0 flex items-center gap-2 px-3 py-1.5 rounded border border-border bg-input text-sm text-text-muted truncate">
                <span className="material-symbols-outlined animate-spin text-sm shrink-0">progress_activity</span>
                <span className="truncate">Checking...</span>
              </div>
            ) : (
              <div className="flex-1 min-w-0" />
            )}
            <div className="flex items-center gap-1 shrink-0">
              {tunnelEnabled && !tunnelLoading && tunnelReachable ? (
                <>
                  <button
                    onClick={() => copy(`${tunnelPublicUrl || tunnelUrl}/v1`, "tunnel_url")}
                    className="p-2 hover:bg-black/5 dark:hover:bg-white/5 rounded text-text-muted hover:text-primary transition-colors shrink-0 flex items-center justify-center"
                    title="Copy URL"
                    aria-label="Copy URL"
                  >
                    <span className="material-symbols-outlined text-[18px]">{copied === "tunnel_url" ? "check" : "content_copy"}</span>
                  </button>
                  <button
                    onClick={() => setShowDisableTunnelModal(true)}
                    className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0 flex items-center justify-center"
                    title="Disable Tunnel"
                    aria-label="Disable Tunnel"
                  >
                    <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                  </button>
                </>
              ) : tunnelEnabled && !tunnelLoading && !tunnelReachable ? (
                <button
                  onClick={() => setShowDisableTunnelModal(true)}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0 flex items-center justify-center"
                  title="Disable Tunnel"
                  aria-label="Disable Tunnel"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              ) : tunnelLoading ? (
                <button
                  onClick={() => { setTunnelLoading(false); setTunnelProgress(""); }}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0 flex items-center justify-center"
                  title="Stop"
                  aria-label="Stop"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              ) : tunnelStatus?.type === "error" ? (
                <Button size="sm" icon="cloud_upload" onClick={() => setShowEnableTunnelModal(true)}>Enable</Button>
              ) : tunnelChecking ? (
                <button
                  onClick={() => setTunnelChecking(false)}
                  className="p-2 hover:bg-red-500/10 rounded text-red-500 transition-colors shrink-0 flex items-center justify-center"
                  title="Stop"
                  aria-label="Stop"
                >
                  <span className="material-symbols-outlined text-[18px]">power_settings_new</span>
                </button>
              ) : (
                <Button
                  size="sm"
                  icon="cloud_upload"
                  onClick={() => {
                    if (isLoginUnsafe) {
                      setTunnelStatus({ type: "error", message: `Security required: ${unsafeReason}` });
                      return;
                    }
                    if (!requireApiKey) {
                      setTunnelStatus({ type: "error", message: "Security required: Enable \"Require API key\" before activating the tunnel." });
                      return;
                    }
                    setShowEnableTunnelModal(true);
                  }}
                >
                  Enable
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Pre-enable security gate banner */}
        {isLoginUnsafe && !tunnelEnabled && (
          <div className="mt-4">
            <SecurityWarning
              message={unsafeReason}
              action={{ label: "Open settings", href: "/dashboard/profile" }}
            />
          </div>
        )}

        {/* Security warnings when tunnel is active */}
        {tunnelEnabled && (
          <div className="mt-4 flex flex-col gap-2">
            {!requireApiKey && (
              <SecurityWarning
                message="Require API key is disabled — your endpoint is publicly accessible without authentication."
                action={{ label: "Enable", href: "#require-api-key" }}
              />
            )}
            {(!requireLogin || !hasPassword) && (
              <SecurityWarning
                message={
                  !requireLogin
                    ? "Require login is disabled — anyone can access your dashboard via tunnel."
                    : "Dashboard uses the default password — change it in Profile settings."
                }
                action={{
                  label: !requireLogin ? "Enable" : "Change password",
                  href: "/dashboard/profile",
                }}
              />
            )}
          </div>
        )}

        {/* Tunnel dashboard access option */}
        {tunnelEnabled && (
          <div className="mt-4 pt-4 border-t border-border flex items-center gap-3">
            <Toggle
              checked={tunnelDashboardAccess}
              onChange={() => handleTunnelDashboardAccess(!tunnelDashboardAccess)}
            />
            <div className="flex items-center gap-1.5">
              <p className="font-medium text-sm">Allow dashboard access via tunnel</p>
              <Tooltip text="When enabled, the dashboard can be accessed through your tunnel URL (login still required). When disabled, dashboard access via tunnel is completely blocked." />
            </div>
          </div>
        )}
      </Card>

      {/* API Keys */}
      <Card id="require-api-key">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">vpn_key</span>
            API Keys
          </h2>
          <Button icon="add" onClick={() => setShowAddModal(true)}>
            Create Key
          </Button>
        </div>

        <div className="flex items-center justify-between pb-4 mb-4 border-b border-border">
          <div>
            <p className="font-medium">Require API key</p>
            <p className="text-sm text-text-muted">
              Requests without a valid key will be rejected
            </p>
          </div>
          <Toggle
            checked={requireApiKey}
            onChange={() => handleRequireApiKey(!requireApiKey)}
          />
        </div>

        {isRemoteHost && !requireApiKey && (
          <div className="mb-4 -mt-2">
            <SecurityWarning message="Endpoint is exposed without an API key." />
          </div>
        )}

        {keys.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <span className="material-symbols-outlined text-[32px]">vpn_key</span>
            </div>
            <p className="text-text-main font-medium mb-1">No API keys yet</p>
            <p className="text-sm text-text-muted mb-4">Create your first API key to get started</p>
            <Button icon="add" onClick={() => setShowAddModal(true)}>
              Create Key
            </Button>
          </div>
        ) : (
          <div className="flex flex-col">
            {keys.map((key) => (
              <div
                key={key.id}
                className={`group flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0 ${key.isActive === false ? "opacity-60" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{key.name}</p>
                  <div className="flex items-center gap-2 mt-1 min-w-0">
                    <code className="text-xs text-text-muted font-mono truncate max-w-[200px] sm:max-w-none">
                      {visibleKeys.has(key.id) ? key.key : maskKey(key.key)}
                    </code>
                    <div className="flex h-7 shrink-0 items-center gap-1">
                      <button
                        onClick={() => toggleKeyVisibility(key.id)}
                        className="flex size-7 items-center justify-center rounded-md p-0 text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
                        title={visibleKeys.has(key.id) ? "Hide key" : "Show key"}
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {visibleKeys.has(key.id) ? "visibility_off" : "visibility"}
                        </span>
                      </button>
                      <button
                        onClick={() => copy(key.key, key.id)}
                        className="flex size-7 items-center justify-center rounded-md p-0 text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {copied === key.id ? "check" : "content_copy"}
                        </span>
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-text-muted mt-1">
                    Created {new Date(key.createdAt).toLocaleDateString()}
                  </p>
                  {key.isActive === false && (
                    <p className="text-xs text-orange-500 mt-1">Paused</p>
                  )}
                </div>
                <div className="flex h-10 shrink-0 items-center justify-end gap-2 self-end sm:self-center">
                  <Toggle
                    size="sm"
                    className="h-10"
                    checked={key.isActive ?? true}
                    onChange={(checked) => {
                      if (key.isActive && !checked) {
                        setConfirmState({
                          title: "Pause API Key",
                          message: `Pause API key "${key.name}"?\n\nThis key will stop working immediately but can be resumed later.`,
                          onConfirm: async () => {
                            setConfirmState(null);
                            handleToggleKey(key.id, checked);
                          }
                        });
                      } else {
                        handleToggleKey(key.id, checked);
                      }
                    }}
                    title={key.isActive ? "Pause key" : "Resume key"}
                  />
                  <button
                    onClick={() => handleDeleteKey(key.id)}
                    title="Delete API key"
                    className="flex size-10 items-center justify-center rounded-lg p-0 text-red-500 opacity-100 transition-colors hover:bg-red-500/10 sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Add Key Modal */}
      <Modal
        isOpen={showAddModal}
        title="Create API Key"
        onClose={() => {
          setShowAddModal(false);
          setNewKeyName("");
        }}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Production Key"
          />
          <div className="flex gap-2">
            <Button onClick={handleCreateKey} fullWidth disabled={!newKeyName.trim()}>
              Create
            </Button>
            <Button
              onClick={() => {
                setShowAddModal(false);
                setNewKeyName("");
              }}
              variant="ghost"
              fullWidth
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Created Key Modal */}
      <Modal
        isOpen={!!createdKey}
        title="API Key Created"
        onClose={() => setCreatedKey(null)}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-2 font-medium">
              Save this key now!
            </p>
            <p className="text-sm text-yellow-700 dark:text-yellow-300">
              This is the only time you will see this key. Store it securely.
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              value={createdKey || ""}
              readOnly
              className="flex-1 font-mono text-sm"
            />
            <Button
              variant="secondary"
              icon={copied === "created_key" ? "check" : "content_copy"}
              onClick={() => copy(createdKey, "created_key")}
            >
              {copied === "created_key" ? "Copied!" : "Copy"}
            </Button>
          </div>
          <Button onClick={() => setCreatedKey(null)} fullWidth>
            Done
          </Button>
        </div>
      </Modal>

      {/* Enable Tunnel Modal */}
      <Modal
        isOpen={showEnableTunnelModal}
        title="Enable Tunnel"
        onClose={() => setShowEnableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="bg-surface-2 border border-border-subtle rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-primary">cloud_upload</span>
              <div>
                <p className="text-sm text-text-main font-medium mb-1">
                  Cloudflare Tunnel
                </p>
                <p className="text-sm text-text-muted">
                  Expose your local 9Router to the internet. No port forwarding, no static IP needed. Share endpoint URL with your team or use it in Cursor, Cline, and other AI tools from anywhere.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {TUNNEL_BENEFITS.map((benefit) => (
              <div key={benefit.title} className="flex flex-col items-center text-center p-3 rounded-lg bg-sidebar/50">
                <span className="material-symbols-outlined text-xl text-primary mb-1">{benefit.icon}</span>
                <p className="text-xs font-semibold">{benefit.title}</p>
                <p className="text-xs text-text-muted">{benefit.desc}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-text-muted">
            Requires outbound port 7844 (TCP/UDP). Connection may take 10-30s.
          </p>

          <div className="flex gap-2">
            <Button onClick={handleEnableTunnel} fullWidth>
              Start Tunnel
            </Button>
            <Button onClick={() => setShowEnableTunnelModal(false)} variant="ghost" fullWidth>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Disable Cloudflare Tunnel Modal */}
      <Modal
        isOpen={showDisableTunnelModal}
        title="Disable Tunnel"
        onClose={() => !tunnelLoading && setShowDisableTunnelModal(false)}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">The Cloudflare tunnel will be disconnected. Remote access via tunnel URL will stop working.</p>
          <div className="flex gap-2">
            <Button onClick={handleDisableTunnel} fullWidth disabled={tunnelLoading} variant="danger">
              {tunnelLoading ? "Disabling..." : "Disable"}
            </Button>
            <Button onClick={() => setShowDisableTunnelModal(false)} variant="ghost" fullWidth disabled={tunnelLoading}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </div>
  );
}


APIPageClient.propTypes = {
  machineId: PropTypes.string.isRequired,
};
