# 9Router Basic Fork

Local AI gateway and Next.js dashboard. Chat providers: **Antigravity**, **Codex**,
**OpenCode Free**. Client formats: OpenAI Chat Completions, Responses, Claude and
Gemini. Image generation and Search remain independent media endpoints. Web Fetch
supports **TinyFish** and **Tavily** only.

## Run from source

Use installed Node.js/npm dependencies:

Next.js is pinned to `16.4.3` for the security update from installed `16.4.0`.
`experimental.agentUpgrade: "security"` enables security upgrade reminders;
it does not automatically install updates.

```sh
npm install
npm run dev
npm run build
npm run start
```

Development/start scripts default to port `20127`. CLI launcher defaults to
`20128`. Configure `DATA_DIR` for isolated development/testing storage. Never use
live account storage for tests. Source builds are private package `9router-app`;
upstream published npm/Docker artifacts are not releases of this reduced fork.

Keep npm lockfiles and project documentation in Git. Dependency directories,
local Next.js build outputs and Playwright capture logs are ignored; `.env`
files remain private, with `.env.example` available as a tracked template.

## Connect and route

Dashboard Providers connects Codex/Antigravity OAuth accounts. OpenCode Free
requires no OAuth. Dashboard Endpoint & Key supplies client URL and API key.
Configure client manually with `/v1` endpoint and prefixed model:

```text
cx/<codex-model>
ag/<antigravity-model>
oc/<opencode-free-model>
```

Combos retain fallback, round-robin and fusion. Vision adapter selects only
retained, capable chat models. Missing capability returns explicit HTTP 400;
conversation history and images are not discarded to make request fit.
Usage, quota tracking, proxy pools, API keys and password dashboard login remain.
Remember-me and CSRF controls remain; dashboard SSO does not.
Dashboard language is English only. Legacy locale cookies render English without
rewriting stored data. `POST /api/locale` accepts `en`; other values return HTTP 400.

## API

- `POST /v1/chat/completions`, `/v1/responses`, `/v1/messages`
- `GET /v1/models` (retained chat models)
- `POST /v1/images/generations`, `/v1/images/understanding`
- `POST /v1/search`, `/v1/web/fetch`

Image/Search provider credentials stay modality-specific. Media registry entries
must not become generic chat fallback providers.

## Removed scope

Token Saver (RTK, Headroom, Caveman, Ponytail, PXPIPE), CLI configuration tools,
Cowork preset MCP bridges, embedding, TTS, STT, video, SystemOne, dashboard SSO,
9Remote, 9English, Tailscale integration and MITM runtime are removed.
Cloudflare Tunnel and local/LAN endpoints remain. No machine VPN services, DNS,
certificates or stored legacy settings are modified by this removal.
CLI launcher remains; `connect` and `xai video`
commands are unavailable. Unsupported legacy provider records stay on disk but
cannot authorize chat, refresh, quota or model enumeration. No destructive
cleanup migration is required.

## Checks

```sh
npm --prefix tests ci
npm --prefix tests run test:basic
npm --prefix tests test
npm run build
```

Native reduced-scope regressions and Vitest use separate discovery. Existing
suite contains upstream-era expectations; current validation status and open
failures are recorded in `docs/BASIC-CLEANUP-STATUS.md`. Passing build does not
prove runtime acceptance.

## License

MIT, preserved in `LICENSE`. Upstream 9Router attribution preserved in Git history
and license. Historical translated/upstream guides are not supported-feature
specifications for this fork.
