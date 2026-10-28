# Next.js security upgrade — 2026-10-23

<!-- next-upgrade: security; path="." -->

Target: `basic` at `170f9f17`, not the older `mine` branch. Installed Next.js
`16.4.0` is updated and pinned to `16.4.3`; the npm lockfile is synchronized.
`experimental.agentUpgrade` is set to `"security"`; unrelated config is preserved.

Verification:

- npm install succeeded; `npm exec -- next --version` reports `16.4.3`.
- Production webpack build and standalone asset copying passed with isolated DATA_DIR.
- Standalone `/login` and `/api/health` returned HTTP 200 on loopback port 20243.
- Native basic suite: 43 passed, 1 failed. The removed-modality assertion in
  `tests/unit/basic-provider-media.test.js:70` also fails on untouched `basic`
  with installed Next.js `16.4.0`: the STT route already exists. No STT code or
  tests were changed to conceal this pre-existing inconsistency.
- npm audit reports one unrelated moderate `ip-address` advisory; no Next.js
  advisory remains. Test dependency installation reports two moderate findings.
- Full Vitest suite and interactive browser flows were not run.

Local/remote branch and commit searches found no equivalent upgrade. Fork open
PR lookup returned none; upstream open PRs were also inspected. No PR or push
was authorized. Upstream/core changes are limited to package manifests and one
Next.js config property; merge-conflict risk is limited to those shared files.

## Outbound TLS and Undici follow-up — 2026-10-25

Scope: local `basic`, starting at `4a6a4234`; no commit, push, deployment or GitHub
issue-setting change. This supplements, not replaces, the dated checks above.

### Two independent fetch layers

`open-sse/utils/proxyFetch.js` captures `globalThis.fetch` as `originalFetch`.
Node's bundled Undici still implements response parsing/decoding even when npm
Undici `ProxyAgent` supplies its dispatcher. Updating npm alone cannot patch that
decoder or an already-running Node process. The lock previously resolved npm
Undici 7.30.0; the declared floor is now `^7.30.1` and lock resolves 7.30.1.

Upstream [GHSA-xjj6-f33q-929c](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c)
(published 2026-10-15) documents a process crash from an excessive-content-encoding
response followed by early close. Affected ranges: `>=6.23.0 <6.29.1`,
`>=7.18.0 <7.30.1`, `>=8.0.0 <8.12.2`; fixes: 6.29.1, 7.30.1, 8.12.2.
The [official npm registry](https://registry.npmjs.org/undici/7.30.1) confirms
7.30.1 and its lockfile SHA-512 integrity (`npm view undici@7.30.1 version dist.integrity engines`).

Supported Node floors are **22.23.4** (bundled Undici 6.29.1) and **24.22.1**
(bundled Undici 7.30.1), both 2026-10-21 security releases:
[Node 22.23.4](https://nodejs.org/en/blog/release/v22.23.4),
[Node 24.22.1](https://nodejs.org/en/blog/release/v24.22.1).
The [official Docker image manifest](https://github.com/docker-library/official-images/blob/master/library/node)
lists `22.23.4-alpine`; Docker keeps the existing Node 22 major but pins that patch
for both builder and runner. Other major versions are not newly supported.
This is a version/source evidence chain for this advisory, not an assumption that
all `22` tags are safe: the advisory explicitly lists **6.29.1 as patched** and
`>=6.23.0 <6.29.1` as affected; Node's
[v22.23.4 bundled package](https://github.com/nodejs/node/blob/v22.23.4/deps/undici/src/package.json)
declares `version: "6.29.1"`. The official-images manifest maps the selected tag
to docker-node commit `80f02a542da739e6a662451d1db66456a0dea253`, directory
`22/alpine3.24`; its
[Dockerfile](https://github.com/nodejs/docker-node/blob/80f02a542da739e6a662451d1db66456a0dea253/22/alpine3.24/Dockerfile)
sets `NODE_VERSION=22.23.4`. A pulled image's identity/runtime still requires
verification; no image digest or actual container-runtime check is claimed.
`engines.node` is an npm compatibility declaration, not a runtime installer or
hard launch guard; verify the actual executable and any `NODE_IMAGE` override.

```sh
node -p 'JSON.stringify({node:process.version,undici:process.versions.undici})'
npm ls undici next --depth=0
```

The machine's default Node was 24.21.0 / bundled Undici 7.29.1 and was **not**
globally upgraded. Validation uses a temporary official Node 24.22.1 binary,
checked against that release's `SHASUMS256.txt`; it reports bundled Undici 7.30.1.
This does not repair existing services or certify a production deployment.

### Fail-closed TLS behavior

Removed the implicit `rejectUnauthorized:false` agent and insecure certificate
retry. Direct requests, connection/env proxies and DNS-bypass requests propagate
certificate errors without TLS downgrade or transport replay, preserving the
original error. Ordinary non-TLS proxy failures retain existing fallback unless
`strictProxy` is enabled. No auth, stored configuration or provider contract was
changed. Legacy `STRICT_SSL` no longer controls networking: all values, including
unset/false/0, retain verification. There is no replacement insecure switch.

Corporate trust must use a reviewed public CA through `NODE_EXTRA_CA_CERTS`
before Node starts, not a disabled TLS verifier. Caller-supplied dispatchers and
Node's own process-level TLS switches remain caller/operator responsibilities;
this patch adds no bypass and does not rewrite persisted settings.

### Local validation

- Official-registry install succeeded (`--ignore-scripts`); no broad audit fix.
  `npm ls --all` exited 0; `npm ls undici next --depth=0` reports 7.30.1 / 16.4.3.
- Regression red/green: TLS unit checks initially failed 15/20 on the old
  fallback. After the patch, focused TLS/proxy checks pass **36/36**, including
  real direct HTTPS, HTTP CONNECT, HTTPS-proxy certificate rejection, explicit
  CA trust, successful direct/proxy HTTP and no credential replay.
- Both global and npm fetch safely reject the advisory's crafted response in
  isolated child processes on Node 24.22.1. Negative control on machine-default
  Node 24.21.0 reproduces the bundled decoder's unhandled
  `UND_ERR_RES_CONTENT_LENGTH_MISMATCH` crash (child exit 1) despite npm 7.30.1.
- Native Docker/manifest checks pass **4/4**. Targeted ESLint on changed JS passes.
  No typecheck script or TypeScript configuration is declared; no typecheck claimed.
- Existing native basic command (concurrency 1): **43 pass / 1 fail** at
  `basic-provider-media.test.js:70`, the documented retained STT route conflict.
- Full Vitest, run from `tests/` with maxWorkers/maxConcurrency 2, isolated data,
  environment-file reads/external fetch blocked and CI snapshot mode: **160 files
  pass / 62 fail / 2 skipped; 1576 tests pass / 157 fail / 10 expected fail /
  18 skipped / 1 todo**. Includes six snapshot failures, removed-provider/module
  expectations and native `node:test` files mis-discovered by Vitest (including
  the Docker test, which passes natively). Not a green suite; baseline equivalence
  was not established for every failure in that initial run. The subsequent
  full before/after comparison below closes that evidence gap. No unrelated test fixes or snapshot
  changes were retained. An initial root-cwd invocation also failed; final counts
  here are the documented package's correct cwd invocation.
- Production webpack build + standalone asset copying pass using one worker,
  `.next-security-validation`, isolated `DATA_DIR`, no `.env` reads or external
  fetch. Standalone `/api/health` and `/login`: HTTP 200 on checked-free loopback
  port 43180; owned child stopped and port released. TLS fixtures use port 0 and
  close their own sockets. No real account/configuration storage was used.
- Docker daemon is unavailable (`dockerDesktopLinuxEngine` pipe missing), so
  image build/runtime validation was not performed; only official image-tag
  verification, static/native Docker checks and local standalone runtime passed.
- Root npm audit still reports **3 unrelated findings**: high `body-parser` and
  `zod`, moderate `ip-address`; test install reports two moderate findings. No
  remaining npm Undici finding was reported. These findings were not auto-fixed.

Core/upstream edits: package manifests, Docker runtime pin and the small
`proxyFetch.js` transport change. README/config/test documentation and scoped
regressions accompany them. Shared manifests and proxy code remain potential
upstream-merge conflict points; no broad refactor was performed.

### Review follow-up: complete HEAD baseline comparison — 2026-10-25

See `UNDICI-TLS-BASELINE.md` for all 62 failure files, test identities, observed
classes, interaction review, exact commands and message-level caveats.

Two disposable `git archive HEAD` copies were compared with identical official
checksum-verified Node 24.22.1, install options, `tests/` cwd/config, CI settings,
isolated data and concurrency 2. Candidate overlaid the reviewed 14-path patch;
main-checkout source was never reset/stashed. Both root/test dependency installs
used `npm ci --ignore-scripts`; only root metadata and Undici 7.30.0 → 7.30.1
differ in dependency locks. No malformed decoder payload was executed: both
decoder cases were explicitly filtered out; the prior crash report remains
historical evidence and was not repeated or hidden.

Both full runs reproduced **exactly the same 62 failing files and 157 failed
assertion occurrences**, including all previous failure files; **zero new failed
identities**. JSON reporter counts: HEAD 1558 passed /157 failed /18 skipped /1 todo;
candidate 1584 passed /157 failed /20 skipped /1 todo. Candidate adds 26 normal TLS
passes and two skipped decoder cases. Of 157 failure messages, 154 match after
path/temp normalization; one differs only by the renamed proxy helper stack, two
by already-failing variable DB write counts. Suite/hook errors match. Repeated
DB checks reproduce the same three failed identities on both sides with variable
received counts; no claim of byte-identical concurrency behavior or DB repair.

Normal TLS/proxy focused before/after: **16 pass /18 fail → 34 pass /0 fail**;
two decoder cases skipped on each side. Existing strict-proxy **8/8** passes both.
Native basic+Docker: **46 pass /1 fail → 47 pass /1 fail**; retained STT-route
assertion identical; added security-floor assertion passes. Synthetic localhost
key/certificate match the retained local generation output and each other;
CN/SAN are localhost/127.0.0.1 only, never production/provider credentials.

The evidence gap was closed for failure identities across the full suite, **not**
for the correctness of the 157 underlying failures. Suite remains red. Docker
image execution, global runtime upgrade and production deployment remain unverified.
