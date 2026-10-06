# Basic fork regression checks

Tests have separate declared Vitest dependency and generated versioned npm lockfile.
No commit was made during cleanup.

```sh
npm --prefix tests ci --ignore-scripts
npm --prefix tests run test:basic
npm --prefix tests test
```

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
