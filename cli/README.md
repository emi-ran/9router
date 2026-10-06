# 9Router Basic Fork Launcher

Launcher starts packaged dashboard/API server, default port `20128`.
Build distribution with `npm run cli:pack` from repository root.
Packaged server must come from this fork, not upstream 40-provider artifacts.

Chat supports Antigravity, Codex and OpenCode Free. Image and Search remain.
Configure API clients manually using dashboard Endpoint & Key and model aliases
`ag/`, `cx/`, `oc/`. `9router connect` and `9router xai video` are unavailable.

Password dashboard login, remember-me, CSRF, OAuth refresh, combos and multi-account
fallback remain. No token compression, dashboard SSO or Cowork configuration.
Tailscale install/connect/Funnel and MITM packaging/process hooks are removed;
Cloudflare Tunnel remains. Launcher does not uninstall or stop machine VPN services.
See root README and `docs/BASIC-CLEANUP-STATUS.md` for support/validation scope.

MIT license retained in `LICENSE`.
