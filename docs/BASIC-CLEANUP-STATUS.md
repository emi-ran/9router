# Basic cleanup integration status — 2026-10-07

## Delivered

- Provider cards restored for Antigravity, Codex and OpenCode Free only: existing
  40px logos, compact flat cards, bold names and connection-status badges.
  One abortable `/api/providers` request has a 10-second timeout; loading/failure
  never masquerades as zero connections. Counts exclude disabled/non-OAuth
  accounts; errors, unknown state and active model cooldowns remain visible.
  OpenCode Free shows `Free` / `Ready` without account authentication.
  Mocked card regressions and JSX parsing passed; native basic suite **44/44**.
  Isolated rendered fixture used real Card/Badge/ProviderIcon, generated project
  CSS and local logo assets, with mocked connection data (no DB/env/provider
  calls). Screenshots inspected at 1280px and 360px: 40px logos loaded, compact
  cards, mobile single column, no horizontal overflow. Captures:
  `.opencode-playwright/provider-cards-desktop.png` and `provider-cards-mobile.png`.
  Authenticated full-dashboard hydration/build was not rerun for this page-only
  change; existing full-suite failures below remain unresolved.

- English-only UI: removed language selectors, non-English literal dictionaries
  and translated READMEs and Gitbook content/labels/selectors (including Turkish UI dictionary). Legacy cookie values
  resolve to English without storage updates; locale API retains validation and
  accepts only `en`. Theme/account controls remain.
- Removed MITM startup bootstrap, alias-cache sync, DNS restoration and signal DNS
   cleanup from app initialization. Cloudflare Tunnel monitoring remains.
   Tailscale API/UI/startup/install integration and now-dead MITM runtime/helpers,
   CLI packaging/process hooks and exclusive certificate dependencies removed.
   Stored Tailscale/MITM settings remain physically intact, ignored at runtime.
- Shared chat routing accepts Antigravity, Codex and OpenCode Free only.
- Removed saver dispatch/plumbing, profile SSO forms/state, remote promotions,
  CLI configuration commands, PXPIPE/MITM screens and Cowork-only MCP bridge/API.
- Cowork bridge had only two preset-plugin endpoints and shutdown hook; no
  independent command/config consumer existed. Removed rather than null stub.
- Retained provider preset buttons/API, including OpenCode Free.
- Removed Kiro/Cursor/CommandCode/Ollama translator registrations and files;
  OpenAI/Responses/Claude/Gemini/Antigravity translation remains.
- Unsupported refresh/quotas rejected; stored settings ignored without migration.
- Historical media in conversation participates in capability detection.
  Capacity errors become HTTP 400; single capable replacement and fusion use
  capability-safe candidates. No adapter history stripping.
- Image media resolution remains separate from chat allowlist. Media adapters
  without retained chat executor no longer trigger generic executor lookup.
- Removed SAML dependency; root lock updated without changing product dependency
  declarations otherwise. Installed existing test dependency and generated versioned lockfile; no commit was made.
- New mock HTTP and mock DB tests cover legacy rows, aliases, custom/enabled
  models, nested/cyclic combos, limits, historical images, fusion and HTTP 400.

## Actual checks

- Tailscale follow-up: native `test:basic` **36/36 passed**; focused Vitest
  **6 files / 53 tests passed** (removal/settings preservation, dashboard guard,
  remember-me, Cloudflare PID ownership, import runtime and English locale).
- Isolated root `npm run build` and postbuild **EXIT_CODE=0**
  (`tailscale-build.log`), temporary DATA_DIR, preload blocking .env reads and
  external fetch, `.next-basic-validation` output. First attempt failed because
  Windows backslashes in NODE_OPTIONS preload path were stripped; forward-slash
  path corrected. Build route manifest contains only retained tunnel endpoints.
- Playwright authenticated through isolated password API; desktop and 390x844
  endpoint rendered Local/Tunnel controls, no Tailscale. Mobile no horizontal
  overflow. All four removed Tailscale endpoints returned **404**. No tunnel
  activation, machine VPN/service/DNS/certificate action or real account storage.
  Form-login click did not establish verified navigation; API login did.
- Full suite not rerun for Tailscale-only delta. Latest full result below remains
  **56 failed files / 142 passed; 128 failed tests / 1280 passed; 18 pending / 1 todo**.
  Unrelated failures not hidden or reclassified. Historical changelog retained.
- Root lock regenerated offline, scripts disabled: removed unused direct
  `node-forge`/`selfsigned`; no dependency upgrades. CLI has no lockfile.

- Finisher: native suite 36/36 passed; focused retained suite 14 files / 138 tests
  passed (prior 126 plus English/MITM and image-fetch hardening checks).
- Finisher full Vitest from repository root: 152 failed files, 138 passed;
  344 failed tests, 1335 passed, 18 pending, 1 todo out of 1698. Exit code 1.
  JSON/log: `s4-finisher-final-suite.json` / `s4-finisher-final-suite.log`.
  This is still not acceptance. No retained assertions deleted or weakened.
- Finisher isolated production build and postbuild completed with `EXIT_CODE=0`
  (`s4-finisher-build.log`). Main app English-only code and MITM startup removal
  included; subsequent Gitbook-only changes are excluded from main app build.
- Playwright reached isolated login with `lang=en` and English password/remember-me
  controls. Locale API `en` returned 200, `tr` returned 400. Profile remained
  auth-guarded after attempted isolated form login; profile desktop/mobile checks
  remain unverified. No real account storage used.
- Image-fetch test failure traced to DNS mock returning object despite production
  `lookup({ all: true })` expecting array. Corrected mock shapes; all 9 image
  hardening assertions passed. Production image helper unchanged from HEAD.
- SQLite test teardown closes adapter before deleting Windows temporary directory.
  Concurrent test now finishes without EPERM, but 3 retained counter assertions
  fail. `usageRepo.js` and `driver.js` exactly match HEAD (newline-normalized).
  Timestamp/content deduplication merges independent identical requests within
  same millisecond: isolated 100-write test counted 3; 50-write daily test counted
  1. Baseline source defect established, not fixed by changing assertions.

- Native basic suite: 36 passed, 0 failed (includes S1 capacity checks).
- Focused retained Vitest: 12 files / 126 tests passed. Includes password session,
  dashboard guard, trusted peer, token refresh, background scheduling, stream
  abort, continuity and account fallback plus new routing/model regressions.
- Full Vitest after targeted obsolete feature-test deletion: 151 failed files,
  136 passed, 2 skipped; 357 failed tests, 1338 passed, 11 expected failures,
  18 skipped, 1 todo. This is not acceptance.
- Prior isolated production build log reached postbuild asset-copy success,
  Next 16.4.0, 81 static pages, but lacked process exit marker. Build exit success
  was not independently confirmed. Preload blocked environment file reads/external
  fetch; temporary DATA_DIR isolated DB.
- Chrome browser unavailable: connection to 127.0.0.1:9222/json/version failed.
  No rendered desktop/mobile assertions or screenshots were produced.

## Remaining blockers

### Bounded follow-up classification

Final actual checks after follow-up changes:

- Native: **36 passed / 0 failed**, exit 0 (`s4-bounded-native.log`).
- Focused retained + import/custom-capabilities: **18 files / 161 tests passed**,
  exit 0 (`s4-bounded-focused.log`).
- Full Vitest: **56 failed files / 142 passed; 128 failed tests / 1280 passed;
  18 pending / 1 todo**, exit 1 (`s4-bounded-final-suite.json` and `.log`).
- Final isolated root build/postbuild: **EXIT_CODE=0** (`s4-bounded-build.log`).
- Gitbook existing build command: **EXIT_CODE=1**, missing Next package under
  configured Turbopack root (`s4-bounded-gitbook.log`). No dependency install.
- Remaining 56-file exact table: [BASIC-FAILURE-REMAINING.md](BASIC-FAILURE-REMAINING.md):
  **54 unknown**, **2 demonstrated baseline**. Unknown includes mixed obsolete
  expectations, not 54 proven retained production defects. No provenance guessed.

Every failed file from `s4-finisher-final-suite.json` is listed with exact failing
assertions and evidence in [BASIC-FAILURE-INVENTORY.md](BASIC-FAILURE-INVENTORY.md).

| Category | Files | Outcome |
| --- | ---: | --- |
| Removed-feature obsolete | 93 | Dedicated retired provider, CLI settings, MITM and token-saver suites removed. Mixed suites retained. |
| Retained new regression | 3 | Codex image DNS mock fixed; cached-token DB teardown closed; quota Codex suite no longer imports removed Claude usage. |
| Demonstrated baseline failure | 2 | DB timestamp dedup and security masking source tripwire; HEAD-equivalent source evidence recorded; assertions retained. |
| Unknown | 54 | Exact paths/assertions listed; unresolved provenance explicitly not labeled baseline. Mixed obsolete/retained expectations require source-level analysis. |

New offline regressions exercise real `importDb` with mocked adapter, preserving
legacy active rows physically while model enumeration and executor lookup reject
them. Custom boolean capability overrides now appear in `/v1/models` DTO;
non-boolean overrides are ignored. Codex quota locks no longer clear on unchanged
reset observations or skipped pings; retained scheduler assertions cover this.

Exact remaining blockers:

- **Product/data decision:** DB request identity/idempotency requires approval;
  independent identical same-millisecond requests currently deduplicate. No
  schema or persistence change made.
- **Missing route/ownership:** `/v1/images/understanding` is advertised in
  `src/shared/constants/providers.js` but `src/app/api/v1/images` contains only
  `generations`. `src/app/api/v1/models/info/route.js` points imageToText at chat
  completions. A nonexistent route cannot receive end-to-end mock verification.
  Adding endpoint is public-contract/S1 ownership decision; not silently added.
  Existing mocked chat adapter checks preserve images and capability HTTP 400.
- **Environment:** actual `npm --prefix gitbook run build` exited 1 because
  Turbopack root `gitbook` could not resolve `next/package.json`; Gitbook-local
  dependencies are not installed. No install or config workaround performed.
- **Retained/mixed failures:** 54 unknown files require analysis; exact inventory
  includes Antigravity OAuth/quota mocks, Codex registry, translators, image Codex
  headers, model catalog, observability and mixed legacy catalogs. No acceptance
  claim, no broad test exclusions added.
- **UI:** isolated login/API verified previously; authenticated profile/mobile
  still unverified. No real credentials/storage were accessed.
- **Shared runtime:** Tailscale removal eliminated final MITM password/DNS consumers;
  MITM directory and build hooks removed. Cloudflare remains independent.

Full-suite failures contain both obsolete upstream provider expectations and
retained failures. Retained DB concurrency tests showed lost usage counts and
Windows temporary SQLite cleanup EPERM (three teardown sites now close adapters;
full suite still needs per-file lifecycle analysis). Security/translator/image/tool-loop
tests still need failure-by-failure scope analysis; they were not deleted to
force green. Runtime MITM bootstrap/alias infrastructure, obsolete public
translations/assets, historical translated READMEs/architecture text and further
feature-specific tests remain. English-only translations/translated README/Gitbook
cleanup and app MITM bootstrap removal are now delivered. No release-ready claim.

Existing DB legacy records remain intact without reactivation; new database imports filter unsupported providers and normalize configuration to basic fork constraints upon replacement. Chat/refresh/model/quotas reject retired
records, and import pre-validation prevents partial writes or corrupted DB state:
- Bounded recursion and explicit ceiling (max combo nesting depth 20) reject excessively nested combo chains before writes, avoiding stack overflow or silent truncation.
- Global 3-state cycle detection drops cyclic combo graphs deterministically while acyclic DAGs with shared/repeated children resolve soundly.
- Combos with removed modalities (video, tts, embedding) are dropped.
- Model alias validation resolves alias chains to canonical provider/model targets while dropping dangling, cyclic, and bare-provider strings.
- Custom models enforce provider media registry allowlists.
- Any validation failure rolls back before writes, preserving existing SQLite database bytes and table rows intact.
Image-to-text entire route path and isolated UI checks remain unverified.
Broad shared core edits create high upstream merge-conflict risk.

Validation logs/inventory live in approved temporary directory under
`opencode/s4-*.log` and `s4-changed-paths.json`; no real account credentials used.

## Cleanups 1-4 and Header Donate Removal — 2026-10-07

### Delivered

1. **Translator Playground Removal:**
   - Removed translator playground UI (`src/app/(dashboard)/dashboard/translator/page.js`) and settings toggle `enableTranslator`.
   - Removed playground API endpoints: `src/app/api/translator/load/route.js`, `save/route.js`, `send/route.js`, `translate/route.js`.
   - Removed unused Monaco packages (`monaco-editor`, `@monaco-editor/react`) from `package.json` and synchronized `package-lock.json`.
   - Preserved core format translation engine under `open-sse/translator/**` and SSE console stream route `/api/translator/console-logs`.

2. **Google Analytics Instrumentation Removal:**
   - Removed `<GoogleAnalytics>` component from `src/app/layout.js`.
   - Removed `@next/third-parties` dependency from `package.json` and synchronized `package-lock.json`.

3. **Separate Gitbook Application Removal & Documentation Migration:**
   - Removed separate Gitbook app (`gitbook/**`) and GitHub Pages deployment workflow (`.github/workflows/gitbook-pages.yml`).
   - Cleaned Gitbook exclusions from `next.config.mjs` and root `.gitignore`.
   - Migrated and preserved all 20 substantive English documentation files under `docs/gitbook/` (deployment, features including combos, quota-tracking, smart-routing, getting-started, integration, providers, troubleshooting, and faq).

4. **ProviderTopology & XYFlow Removal:**
   - Removed `src/app/(dashboard)/dashboard/usage/components/ProviderTopology.js` and its tab/render wiring in `src/shared/components/UsageStats.js`.
   - Removed `@xyflow/react` dependency from `package.json` and synchronized `package-lock.json`.
   - Preserved all Recharts charts (`UsageChart`, `ProviderBarChart`, `TopModelsChart`), overview cards, tables, and request lists in `UsageStats.js`.

5. **Header Donate Button & Modal Removal:**
   - Removed Donate trigger button and modal state from `src/shared/components/Header.js`.
   - Deleted unused `src/shared/components/DonateModal.js` component.
   - Preserved `GITHUB_CONFIG.donateUrl` in `src/shared/constants/config.js` to avoid breaking config exports.
   - Header logo, global search, theme toggle, profile menu, and mobile navigation remain fully intact.

### Validation

- Native basic test suite (`npm --prefix tests run test:basic`): **44 passed / 0 failed** (exit code 0; 8 new assertions verifying removal of Translator playground UI/APIs, Gitbook directory, ProviderTopology, and DonateModal).
- Locale check (`cd tests && npx vitest run unit/basic-english-locale.test.js`): **1 file / 3 passed** (exit code 0).
- Isolated Next.js production build (`npx next build --webpack` with temporary isolated `DATA_DIR` and preload): **72/72 pages generated, exit code 0**.
- Full Vitest suite remains at documented historical baseline red (56 failed files / 128 failed tests) and is not claimed green.
