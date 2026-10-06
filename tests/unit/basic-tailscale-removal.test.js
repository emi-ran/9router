import { beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";

const state = vi.hoisted(() => ({ raw: {}, tunnel: { settingsEnabled: false }, getTunnelStatus: vi.fn() }));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => ({
  get: () => ({ data: JSON.stringify(state.raw) }),
  transaction: (fn) => fn(),
  run: (_sql, args) => { state.raw = JSON.parse(args[0]); },
}) }));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => state.raw, cleanupProviderConnections: async () => {} }));
vi.mock("@/lib/tunnel", () => ({
  getTunnelStatus: state.getTunnelStatus,
  getDownloadStatus: () => ({ downloading: false }),
  enableTunnel: vi.fn(), getTunnelService: vi.fn(), setTunnelUnexpectedExitCallback: vi.fn(),
  killCloudflared: vi.fn(), isCloudflaredRunning: vi.fn(), ensureCloudflared: vi.fn(), checkInternet: vi.fn(),
  WATCHDOG_INTERVAL_MS: 60000, NETWORK_CHECK_INTERVAL_MS: 5000,
  RESTART_COOLDOWN_MS: 120000, NETWORK_SETTLE_MS: 2500, VIRTUAL_IFACE_REGEX: /^(utun|tun)/i,
}));
import { getSettings, updateSettings, exportSettings } from "../../src/lib/db/repos/settingsRepo.js";
import { configureTunnelMonitoring } from "../../src/shared/services/initializeApp.js";
import { GET } from "../../src/app/api/tunnel/status/route.js";

beforeEach(() => {
  state.raw = { tailscaleEnabled: true, tailscaleUrl: "https://old.ts.net", mitmSudoEncrypted: "opaque-legacy", tunnelEnabled: false };
  state.getTunnelStatus.mockResolvedValue(state.tunnel);
  global.__tunnelStatusCache.value = null;
  configureTunnelMonitoring({ tunnelEnabled: false });
});

it("ignores legacy settings while preserving raw values across unrelated updates", async () => {
  const settings = await getSettings();
  expect(settings).not.toHaveProperty("tailscaleEnabled");
  expect(settings).not.toHaveProperty("tailscaleUrl");
  expect(settings).not.toHaveProperty("mitmSudoEncrypted");
  expect(settings.tunnelEnabled).toBe(false);
  const original = { ...state.raw };
  await updateSettings({ requireApiKey: true, tailscaleEnabled: false, mitmSudoEncrypted: "replacement" });
  expect(await exportSettings()).toMatchObject(original);
  expect((await getSettings()).requireApiKey).toBe(true);
});

it("does not monitor legacy Tailscale but keeps Cloudflare watchdog and network monitor", () => {
  configureTunnelMonitoring(state.raw);
  expect(global.__appSingleton.watchdogInterval).toBeNull();
  expect(global.__appSingleton.networkMonitorInterval).toBeNull();
  configureTunnelMonitoring({ tunnelEnabled: true });
  expect(global.__appSingleton.watchdogInterval).not.toBeNull();
  expect(global.__appSingleton.networkMonitorInterval).not.toBeNull();
  configureTunnelMonitoring({ tunnelEnabled: false });
});

it("returns only Cloudflare status even with stale hot-reload cache", async () => {
  const response = await GET();
  expect(await response.json()).toEqual({ tunnel: state.tunnel, download: { downloading: false } });
  global.__tunnelStatusCache.value.tailscale = { enabled: true };
  expect(await (await GET()).json()).not.toHaveProperty("tailscale");
});

it("removes API, UI, bootstrap and packaging consumers without removing retained gates", () => {
  const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  for (const action of ["check", "disable", "enable", "install"]) {
    expect(fs.existsSync(new URL(`../../src/app/api/tunnel/tailscale-${action}/route.js`, import.meta.url))).toBe(false);
  }
  for (const file of ["src/lib/tunnel/index.js", "src/shared/services/initializeApp.js", "cli/cli.js", "cli/scripts/build-cli.js", "Dockerfile"]) {
    expect(read(file)).not.toMatch(/tailscale|@\/mitm|src["/, ]+mitm|buildMitm|killProxyByPidFile/i);
  }
  const ui = read("src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js");
  expect(ui).not.toMatch(/tailscale|\bts[A-Z]|setTs|showTs|showDisableTs/);
  expect(ui).toContain("Cloudflare Tunnel");
  expect(ui).toContain('label="Local"');
  expect(ui).toContain("isLoginUnsafe");
  expect(ui).toContain("tunnelDashboardAccess");
  const guard = read("src/dashboardGuard.js");
  expect(guard).not.toMatch(/tailscale/);
  expect(guard).toContain('"/api/tunnel/enable"');
  expect(guard).toContain("settings.tunnelDashboardAccess === true");
  const login = read("src/app/api/auth/login/route.js");
  expect(login).not.toMatch(/tailscale/);
  expect(login).toContain("mustChangePassword");
  expect(login).toContain("setLoginCookies");
});
