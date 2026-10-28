# Basic fork regression checks

Tests have separate declared Vitest dependency and generated versioned npm lockfile.
No commit was made during cleanup.

```sh
npm --prefix tests ci --ignore-scripts
npm --prefix tests run test:basic
npm --prefix tests test
```

Focused outbound transport regressions (max concurrency 1, loopback port 0):

```sh
npm --prefix tests test -- unit/proxy-fetch-tls.test.js unit/proxy-fetch-tls.integration.test.js unit/strict-proxy-enforcement.test.js --maxWorkers=1 --maxConcurrency=1 --testNamePattern='^(?!.*excessive content-encoding).*'
node --test --test-concurrency=1 tests/unit/basic-docker-config.test.js
```

Run from supported patched Node 22.23.4+ or 24.22.1+. Integration tests reject
self-signed certificates for direct HTTPS, HTTP CONNECT and HTTPS proxies,
verify explicit CA trust and successful direct/proxy HTTP. The command above
explicitly skips both malformed decoder-response cases; these were not executed
during the baseline-review follow-up. Historical decoder checks are documented
separately in `../docs/NEXT-SECURITY-UPGRADE.md`.
Fixture key/certificate are public synthetic localhost test identities,
not credentials. Servers bind exclusively to loopback port 0 and close their own
sockets. Unit tests cover all certificate error codes, legacy `STRICT_SSL`
values, no TLS replay, DNS-bypass rejection and existing `strictProxy`/`NO_PROXY`.
Full same-environment HEAD-versus-patch failure comparison and exact limits:
`../docs/UNDICI-TLS-BASELINE.md`.

Native checks cover provider/media allowlists, removed routes, password-only
login, aliases and capacity adapters. Vitest checks include mocked DB model
enumeration and mocked HTTP chat dispatch. Native `.mjs` checks are outside
Vitest include glob; native `.js` files are explicitly excluded.
English-only locale regressions cover legacy fallback, Gitbook labels, HTML
language and removal of language controls/MITM startup.
Mock-adapter import checks preserve legacy rows without runtime reactivation;
public model DTO checks cover custom boolean capability overrides. Exact full-suite
classification lives in `../docs/BASIC-FAILURE-INVENTORY.md` and final remaining
failures in `../docs/BASIC-FAILURE-REMAINING.md`.

Never run live-provider tests or read real account storage during cleanup checks.
Use temporary `DATA_DIR`, disable external network and environment-file reads.
Production build validation can preload `scripts/basic-validation-preload.cjs`.
Historical upstream tests need scope-aware changes; do not suppress retained
security, streaming, refresh-race or concurrency failures to claim acceptance.
Actual results/blockers: `../docs/BASIC-CLEANUP-STATUS.md`.
