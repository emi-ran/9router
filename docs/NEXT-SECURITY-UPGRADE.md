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
