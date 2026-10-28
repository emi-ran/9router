# Undici/TLS baseline comparison — 2026-10-25

## Result and limits

Compared the **entire existing Vitest suite**, not a representative subset:
HEAD `4a6a4234` against the reviewed local security patch. Both produced the same
**62 failing files / 157 failed assertion occurrences (155 distinct names)**.
No new failed file, failed assertion identity, missing prior failed file, or
changed suite/hook error was found. This establishes failure-identity baseline
equivalence in the isolated environment; it does **not** make the suite green,
prove every underlying failure harmless, or certify production/Docker runtime.

No malformed decoder response, crash payload or unpatched-runtime negative
control was executed during this follow-up. Both existing decoder cases were
explicitly excluded by test-name filter and recorded skipped. Earlier decoder
results in `NEXT-SECURITY-UPGRADE.md` remain historical evidence, not rerun checks.

## Reproduction conditions

- Disposable copies: `%LOCALAPPDATA%/Temp/opencode/9router-baseline-20261025/`:
  `baseline/` from `git archive HEAD`, `candidate/` from the same archive plus
  the 14 reviewed changed/new paths. No main-checkout reset, stash, commit or
  source rewrite. Tracked archive/checkout text line endings already matched.
- Same checksum-verified official Windows Node **24.22.1**, reporting bundled
  Undici **7.30.1**, and same npm CLI. Both copies installed root/test dependencies
  with `npm ci --ignore-scripts --no-fund --registry=https://registry.npmjs.org/`.
  Root lock package differences are only the root metadata and npm Undici
  **7.30.0 → 7.30.1**; test lockfiles are byte-identical. Native-addon install
  scripts intentionally did not run on either side.
- Each command ran from its own `tests/` directory, with the byte-identical
  `vitest.config.js`, `CI=true`, maxWorkers/maxConcurrency **2**, fresh isolated
  `DATA_DIR`, and its own `scripts/basic-validation-preload.cjs` blocking `.env`
  reads/external fetch. No live provider credentials or account storage.

```sh
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --maxConcurrency=2 \
  --testNamePattern='^(?!.*excessive content-encoding).*' \
  --reporter=json --outputFile=../comparison-result.json
```

JSON reporter assertion status counts (expected-failure passes included in
`passed`; Vitest's aggregate suite counters count nested describes, not files):

| Side | Files passed / failed | Assertions passed / failed / skipped / todo |
| --- | --- | --- |
| HEAD | 160 / 62 | 1558 / 157 / 18 / 1 |
| Patched | 162 / 62 | 1584 / 157 / 20 / 1 |

The two added files supply 26 passing assertions and two deliberately skipped
decoder cases. Native `node:test` cases are counted separately below.
Comparison keys are relative file + full assertion name + occurrence ordinal;
the ordinal preserves three distinct `rejects malformed upstream JSON` cases.
Absolute checkout paths, random temporary DB suffixes and ANSI formatting were
normalized for message comparison, not actual/expected assertion values.

Evidence retained outside Git in the disposable directory: `baseline.json`,
`candidate.json`, `comparison.json`, both `*-native.log`, both `*-focus.json`,
four `*-db-repeat*.json`; `compare.py`, `analyze.py`, `focused.py` capture commands
and comparison. No claim that machine-local evidence is permanently archived.

## Interaction review before attribution

- **Direct proxy caller:** `claude-header-forwarding.test.js`: 19 failures load
  removed `executors/default.js`; its remaining failure expects disabled
  got-scraping behavior and reaches the blocked external-fetch guard in both
  versions. Same guard message; only helper name/line offsets changed from
  `fetchWithTlsFallback` to `fetchWithDispatcher`.
- **Proxy mocked:** `codex-oauth-stt`, `codex-stt-persisted-refresh`,
  `force-stream-config`, `usage-dispatch` mock `proxyFetch`; same failed identities
  and messages before/after. No inference that those failures are acceptable.
- **Manifest/Docker consumers:** `basic-selected-version` expects old 0.5.104
  metadata in both versions. `basic-docker-config` is a native `node:test` file
  mis-discovered by Vitest in both versions; native checks pass 3/3 before,
  4/4 after (new security-floor assertion).
- **Comment only:** `golden-url-header` mentions proxyFetch but fails collection
  on removed `default.js` in both versions.
- **Normal transport acceptance:** copied only the new TLS tests/fixtures into
  the disposable baseline *after* its full-suite run. Baseline: 16 pass / 18 fail /
  2 skipped; patched: **34 pass / 0 fail / 2 skipped**. Existing strict-proxy
  tests pass **8/8** on both. New fail-closed unit tests improve 5 pass / 15 fail
  to 20 pass; normal TLS integration improves 3 pass / 3 fail to 6 pass. Decoder
  test bodies did not run. Loopback servers used port 0 and owned-socket cleanup.
- Native basic + Docker command (concurrency 1): HEAD **46 pass / 1 fail**;
  patched **47 pass / 1 fail**. Both fail exactly at
  `basic-provider-media.test.js:70`, retained STT route versus removed-modality
  assertion. The extra pass is the new Docker security-floor assertion.

## Failure classes and complete file inventory

Classes describe **observed failure surface**, not independently proven root
causes. Every row below reproduced on both copies; counts include duplicate
parameterized assertion names. All paths relative to `tests/`.

| Class | Files | Failed assertions |
| --- | ---: | ---: |
| Missing module/dependency during collection | 13 | 0 |
| Native test runner discovery | 1 | 0 |
| Missing lowdb dependency / benchmark setup | 1 | 0 |
| DB/native binding/cleanup | 3 | 7 |
| Snapshot mismatch | 3 | 6 |
| Unexpected pass of `it.fails` / mixed translation shape | 3 | 5 |
| Test cwd/source-path reads | 1 | 13 |
| STT/API/UI expectation mismatch | 3 | 21 |
| Provider/catalog/translation/contract/mock expectation mismatch (mixed) | 34 | 105 |
| **Total** | **62** | **157** |

| File | Fail count | Observed group |
| --- | ---: | --- |
| `translator/agent-client-fixes.test.js` | 0 | missing Kiro translator |
| `translator/bugs-3905-deepseek-tool-type.test.js` | 2 | provider quirk expectations |
| `translator/bugs-claudeCode-context.test.js` | 1 | unexpected `it.fails` pass |
| `translator/bugs-gemini-cursor-commandcode.test.js` | 3 | 2 unexpected passes + missing messages shape |
| `translator/bugs-openai-bridge.test.js` | 1 | unexpected `it.fails` pass |
| `translator/bugs-toClaude-context.test.js` | 1 | reasoning translation |
| `translator/golden-request.test.js` | 1 | snapshot |
| `translator/golden-response-stream.test.js` | 2 | snapshots |
| `translator/golden-translator-concerns.test.js` | 3 | snapshots |
| `translator/golden-url-header.test.js` | 0 | missing default executor |
| `translator/thinking-unified.test.js` | 2 | reasoning-effort expectations |
| `unit/aggregator-providers-batch.test.js` | 0 | missing default executor |
| `unit/anthropic-gateway-passthrough.test.js` | 3 | missing default executor within tests |
| `unit/antigravity-ide-version.test.js` | 0 | missing MITM module |
| `unit/antigravity-oauth-client.test.js` | 2 | missing Gemini CLI/source shape |
| `unit/antigravity-quota-routing.test.js` | 3 | mock missing AI_PROVIDERS export |
| `unit/basic-docker-config.test.js` | 0 | native runner discovery |
| `unit/basic-import-runtime.test.js` | 1 | model-list expectations |
| `unit/basic-model-enumeration.test.js` | 1 | model-list expectations |
| `unit/basic-selected-version.test.js` | 2 | 0.5.104 versus 0.5.109 |
| `unit/capabilities.test.js` | 3 | provider capabilities |
| `unit/claude-header-forwarding.test.js` | 20 | 19 missing executor + external-fetch guard |
| `unit/codex-oauth-stt.test.js` | 19 | mocked STT/API/audio expectations |
| `unit/codex-stt-media-ui.test.js` | 1 | UI source assertion |
| `unit/codex-stt-persisted-refresh.test.js` | 1 | mocked STT 503 versus 200 |
| `unit/combo-autoswitch.test.js` | 2 | routing/reference identity |
| `unit/combo-presets.test.js` | 5 | removed preset functions/results |
| `unit/combo-zero-content.test.js` | 1 | response identity |
| `unit/compatible-provider-connections.test.js` | 3 | 400 versus 201; cleanup EPERM |
| `unit/db-benchmark.test.js` | 0 | missing lowdb setup dependency |
| `unit/db-concurrent.test.js` | 3 | DB aggregate/write-count failures |
| `unit/db-sqlite-vs-lowdb.test.js` | 1 | DB roundtrip value missing |
| `unit/fetch-success-clears-account.test.js` | 2 | 400 versus 200/429 |
| `unit/force-stream-config.test.js` | 3 | unsupported OpenAI provider/force-stream flag |
| `unit/gemini-3.7-antigravity.test.js` | 1 | missing registry model |
| `unit/gemini-3.8-antigravity.test.js` | 1 | missing registry model |
| `unit/gemini-36-integration.test.js` | 0 | missing Gemini CLI module |
| `unit/gemini-37-integration.test.js` | 0 | missing CLI tools module |
| `unit/gemini-38-integration.test.js` | 0 | missing CLI tools module |
| `unit/gemini-native-endpoint.test.js` | 1 | missing TTS model |
| `unit/github-responses-routing.test.js` | 0 | missing GitHub executor |
| `unit/gpt-6-context-window.test.js` | 2 | context-window expectations |
| `unit/hermes-vision-detection.test.js` | 1 | vision-adapter model selection |
| `unit/kiro-image-forwarding.test.js` | 0 | missing MITM Kiro handler |
| `unit/mitm-root-ca.test.js` | 1 | missing MITM CA module |
| `unit/model-catalog-scope.test.js` | 1 | catalog capability shape |
| `unit/model-routing.test.js` | 2 | removed/compatible provider routing; cleanup EPERM |
| `unit/openai-compatible-apitype-resolution.test.js` | 0 | missing default executor |
| `unit/openai-responses-multiturn.test.js` | 0 | missing Grok executor |
| `unit/openai-to-claude.test.js` | 1 | missing input delta |
| `unit/opencode-zen-models.test.js` | 10 | registry/transports expectations |
| `unit/provider-display-split.test.js` | 4 | missing provider/display values |
| `unit/reasoningContentInjector.test.js` | 4 | MiniMax rules/missing default executor |
| `unit/request-details-tab.test.js` | 3 | null data/native binding/provider list; cleanup EPERM |
| `unit/security-audit.test.js` | 13 | cwd-relative reads resolve under tests/src |
| `unit/system-inject.test.js` | 0 | missing RTK module |
| `unit/thinking-levels-kiro.test.js` | 0 | missing Kiro constants |
| `unit/token-refresh-generic.test.js` | 8 | missing refresh function/iterator |
| `unit/translator-helpers-edge.test.js` | 1 | missing hoisted system content |
| `unit/translator-request-normalization.test.js` | 4 | arrays versus string/raw NDJSON |
| `unit/usage-dispatch.test.js` | 1 | unsupported GitHub usage dispatch |
| `unit/v1-models-combo-context.test.js` | 6 | missing combo provider limits |

## Message differences and residual uncertainty

Complete failed assertion title inventory follows. Each file maps to the class
table above; counts include repeated parameterized titles. Collection/setup-only
files have zero failed assertion titles and their exact failure surface is in
the preceding table. Text encoding artifacts in upstream titles are rendered as
readable arrows/dashes here; raw full names and ordinal comparison are in JSON.

### Translator assertions (16)

- `bugs-3905-deepseek-tool-type`: runs only for providers declaring requireClaudeToolType; declares the quirk only on the MiniMax providers (registry tripwire).
- `bugs-claudeCode-context`: tool_result image block is preserved.
- `bugs-gemini-cursor-commandcode`: image content is preserved; respects client max_tokens; image content is preserved as native CommandCode image blocks.
- `bugs-openai-bridge`: tool_result with image block is not turned into raw JSON / dropped.
- `bugs-toClaude-context`: assistant reasoning_content becomes a thinking block.
- `golden-request`: full body (image base64 + tool_result).
- `golden-response-stream`: text + reasoning + toolUse + usage + stop; content + thinking + tool_calls + done usage.
- `golden-translator-concerns`: text + reasoning + tool + finish-step usage; toolUse then stop — lock current finish_reason behavior; tool_calls then done_reason=stop — lock current finish_reason.
- `thinking-unified`: GLM-5.2 also gets reasoning_effort (supported from 5.2 onward); aggregator (siliconflow) GLM model → forced openai reasoning_effort.

### Provider/catalog/contract assertions (80)

- `anthropic-gateway-passthrough`: keeps unknown client flags alongside the pinned set on claude; forwards client flags on anthropic-compatible Claude models; forwards client flags on the anthropic provider.
- `antigravity-oauth-client`: google client shared by gemini + gemini-cli; src oauth.js imports shared client + keeps full shape.
- `antigravity-quota-routing`: skips exhausted account/model and selects the next account; reports retry time when every account is cache-blocked; lets account back into rotation once reset time has passed.
- `basic-import-runtime`: import drops unsupported legacy provider rows while keeping retained ones normalized.
- `basic-model-enumeration`: legacy active rows cannot enumerate; enabled models remain usable.
- `basic-selected-version`: keeps root, CLI and root lock metadata at 0.5.104; clears the equal-version notification without disabling newer-release checks.
- `capabilities`: reports Kiro GPT 5.6 models with the Kiro 272k context window; deepseek-v4-pro via codebuddy-cn uses openai thinking format; minimax-m3 via codebuddy-cn has vision (provider override).
- `combo-autoswitch`: web_search tool -> search; keeps order when no model matches.
- `combo-presets`: Cursor live ids become unprefixed names seeded with cu/…; Cursor falls back to static cu registry when live catalog is empty; Claude aliases map opus → cc/claude-opus-5 and registry models seed cc/…; marks existing names with exists: true; drops invalid names from Claude/Cursor catalogs.
- `combo-zero-content`: passes through text/event-stream without consuming the response.
- `compatible-provider-connections`: creates one API-key connection for an OpenAI-compatible node; creates one API-key connection for an Anthropic-compatible node; allows multiple connections on the same compatible node.
- `fetch-success-clears-account`: clears a stale provider lock after a successful fetch; scopes provider failures to web fetch.
- `force-stream-config`: only openai/codex/commandcode force streaming; keeps forced-stream providers streaming for JSON clients when body.stream is undefined; keeps forced-stream providers streaming for JSON clients when body.stream is false.
- `gemini-3.7-antigravity`: registers gemini-3.7-flash in gemini provider registry.
- `gemini-3.8-antigravity`: registers gemini-3.8-flash in gemini provider registry.
- `gemini-native-endpoint`: lists Gemini TTS models using standard Google model names.
- `gpt-6-context-window`: leaves the gateways that truncate lower on their own numbers; keeps Devin CLI's seven GPT-5.4/5.5 variants at the gateway's 200k limit.
- `hermes-vision-detection`: auto-switches non-vision model (deepseek-v4-pro) to Vision Adapter model (Kimi-K3).
- `mitm-root-ca`: creates Root CA files synchronously for direct server startup.
- `model-catalog-scope`: rebuilds an older-schema file instead of trusting its etag.
- `model-routing`: keeps built-in provider aliases ahead of compatible node prefixes; still routes non-reserved compatible node prefixes.
- `openai-to-claude`: omits empty Read pages tool argument before emitting Claude input deltas.
- `opencode-zen-models`: matches the documented model IDs; declares [claude] for Claude + Qwen + union-alpha models; declares [openai-responses] for GPT/Grok/Spark responses models; declares [openai] only for chat-only models (GLM/Kimi/MiMo) → guards /messages routing; declares openai / claude / openai-responses transports; resolveTransport picks the endpoint matching the client sourceFormat; uses x-api-key + anthropicVersion on the claude transport; routes MiniMax/Qwen + claude-format client to /messages; routes DeepSeek + responses-format client to /responses; routes Muse Spark (responses-only) to /responses, never to /messages.
- `provider-display-split`: AI_PROVIDERS entries still carry merged display + transport; display fields source from providersDisplay.js; helpers still work after split; Cloudflare exposes API-key authentication on its free-tier card.
- `reasoningContentInjector`: injects reasoning_content on a minimax assistant message that lacks it; injects reasoning_content on minimax assistant message with tool_calls but no reasoning_content; applies provider-level rule for provider 'minimax-cn' (scope all); DefaultExecutor transformRequest runs the injector for minimax.
- `token-refresh-generic`: iflow: Basic Auth header from clientId:clientSecret, form body keeps client_secret; github: omits client_secret when config has none; kimi: merges X-Msh-* headers from credentials.providerSpecificData.deviceId; claude: JSON body, client_id only (no client_secret); returns null on non-ok response; returns null when refreshToken missing; dedupes concurrent calls with same refresh token (same dedupKey); uses the extension JSON refresh contract.
- `translator-helpers-edge`: hoists mid-conversation system messages into top-level system.
- `translator-request-normalization`: claudeToOpenAIRequest flattens text-only content arrays into string; filterToOpenAIFormat flattens text-only arrays to string; translateRequest keeps /v1/messages Claude->OpenAI text payloads string-safe; parseSSELine supports provider raw NDJSON stream lines.
- `usage-dispatch`: every supported provider routes to its handler (no fallback message).
- `v1-models-combo-context`: uses the real provider for a ocg UI-alias seat; uses the real provider for a xmtp UI-alias seat; uses the real provider for a ps UI-alias seat; uses the real provider for a ds UI-alias seat; carries provider-scoped limits through a nested combo; publishes Devin CLI's 200k limit for a dv combo seat.

### Direct proxy/header assertions (20)

`unit/claude-header-forwarding.test.js`:

- uses static provider defaults when no model is given
- includes heavy-agent beta flags for claude-opus-5
- includes heavy-agent beta flags for claude-sonnet-5
- omits heavy-agent beta flags for claude-haiku-4-5-20251001
- omits heavy-agent beta flags for claude-fable-5
- sets x-api-key auth when apiKey is provided
- sets Bearer Authorization when only accessToken is provided
- includes Accept: text/event-stream when stream=true
- omits Accept: text/event-stream when stream=false
- does not throw when no model is given
- sets x-claude-code-session-id from metadata.user_id on Claude OAuth
- omits x-claude-code-session-id for non-OAuth API keys
- strips x-app and anthropic-dangerous-direct-browser-access for non-Anthropic host
- removes claude-code-20250219 from anthropic-beta for non-Anthropic host
- keeps other beta flags intact after stripping
- does NOT strip headers when baseUrl is api.anthropic.com
- does NOT strip headers when baseUrl is empty (defaults to Anthropic)
- sends context-management beta for a Claude model on a custom host
- gates the beta flags on the model id, not the provider prefix
- routes api.anthropic.com to gotScraping (non-streaming) and returns ok response

### STT/API/UI assertions (21)

`unit/codex-oauth-stt.test.js` (19):

- retries 401 only once even when refreshed token also fails
- forwards a valid language hint to the Codex transcribe endpoint
- returns text format with no asset metadata
- rejects empty, invalid audio and unsupported MIME
- converts real compressed MP3 and WebM audio to 24 kHz PCM WAV
- rejects duration over 120 seconds instead of silently truncating
- forces one persisted refresh after 401 and retries with the updated token
- does not retry when refresh returns unchanged or malformed credentials
- sanitizes upstream 429 and only locks the account for account-scoped failures
- sanitizes upstream 500 and only locks the account for account-scoped failures
- sanitizes upstream 503 and only locks the account for account-scoped failures
- rejects malformed upstream JSON (**3 separate parameterized occurrences**)
- cleans conversion temp directories on success and malformed audio
- bounds upstream response size as an upstream error
- sanitizes transport exceptions
- sanitizes even errors carrying an attacker-controlled status
- routes authenticated multipart through direct HTTPS to fixed OAuth-only Codex upstream

Other STT files:

- `codex-stt-media-ui`: renders only json/text options and runs the supported transcription request.
- `codex-stt-persisted-refresh`: uses the real persisted refresh service before sending expired-account OAuth audio.

### DB/native/cleanup assertions (7)

- `db-concurrent`: 100 parallel saveRequestUsage → no count loss; mixed concurrent: usage + details + connections + aliases; daily summary aggregates correctly under parallel writes.
- `db-sqlite-vs-lowdb`: exportDb / importDb roundtrip.
- `request-details-tab`: oversized field → stored truncated + reparseable (no circular); backup file omits requestDetails rows but keeps other tables; returns unique provider list without parsing data blobs.

### Cwd/source-read assertions (13)

`unit/security-audit.test.js`:

- source should contain maskApiKey function
- getUsageHistory should use apiKeyMasked instead of apiKey
- getUsageStats should use apiKeyMasked in byApiKey entries
- byApiKey object keys should use masked key, not raw key
- source should contain validateProxyUrl function
- source should contain escapeHtml function
- should escape ampersand, angle brackets, and quotes
- should use safeMessage in rendered HTML, not raw message
- manager.js should define LOCK_FILE constant
- should use O_EXCL flag (wx) for atomic creation
- should clean up lock file on all exit paths
- mitmIsRestarting should be set before first await expression
- mitmIsRestarting should be reset on max-restarts early return

### Message-level review

After path/temp normalization, **154/157** assertion failure messages match
exactly; suite/hook messages all match. Three differing messages:

1. Claude routing external-network guard: identical failure, expected stack
   helper rename/line shifts in changed `proxyFetch.js` only.
2. DB mixed concurrent writes: received **15 → 20**, expected **50**, both failed.
3. DB daily summary: received **1 → 2**, expected **50**, both failed.

DB repeat checks used the same Node/config/concurrency: HEAD mixed counts
**12, 12**; candidate **10, 9**, each expected 50 and failed. Both repeated
100-write tests received 2 instead of 100; daily counts both 1 instead of 50.
This demonstrates numerical variability without a new failing assertion, not
byte-identical concurrency behavior or a proven DB root cause. No DB code was
changed and no bulk repair/suppression was applied. These retained failures
remain open quality problems, outside this TLS patch's acceptance scope.

## Synthetic fixture verification

`localhost-key.pem.txt` is the **publicly disclosed synthetic test key**, generated
locally for these loopback fixtures, not a user/provider/production credential.
The retained generation outputs in the temp fixture directory match both repo
files byte-for-byte after trimming. `crypto.X509Certificate` confirms matching
private/public key, self-issued `CN=localhost`, SAN exactly `DNS:localhost` and
`IP Address:127.0.0.1`; validity 2026-10-25 through 2036-10-22. SHA-256 certificate
fingerprint: `90:1A:C0:DA:26:F1:D3:FF:97:0C:63:3E:E6:7A:09:1B:A5:42:F9:05:6C:CC:A6:DB:34:45:A5:EE:C9:72:0A:CB`.
References are restricted to the TLS integration tests and documentation. Never
install this certificate into a system/production trust store or reuse the key.
