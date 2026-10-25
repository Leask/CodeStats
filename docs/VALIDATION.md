# Local review — 2026-10-25

The prototype runs at `http://127.0.0.1:8791` on Flora. No Cloudflare resources
have been provisioned, no remote repository created, and no profile README edited.

## Accepted evidence

- TypeScript strict check passes.
- 36 unit tests pass:18 collector,12 renderer,6 cache.
- Nine isolated Cloudflare workerd/SQLite checks pass. After successful mock
  fetches, both upstreams return503: the card remains HTTP200 SVG, data and old
  success timestamps remain, repeated requests respect cooldown, and a new
  runtime over the same SQLite directory recovers both records and cooldown.
  A separate empty profile during outage stays `unavailable` with null data.
- The real local Wrangler preview was stopped and restarted over its existing
  cache. Both real source payloads and original success timestamps were unchanged.
- Eleven real-browser checks pass in isolated Chrome Beta via Playwright:
  live sources,106 joined rows, expansion, sorting, theme switching, README
  hierarchy, clipboard copying, unavailable-range handling, mobile overflow,
  SVG text bounds and absence of JavaScript errors.
- The latest dry build succeeds:76.08KiB total /17.47KiB gzip. This is
  `wrangler deploy --dry-run`, not deployment.
- `npm audit` reports zero vulnerabilities at preparation.

Actual retained aggregate snapshot:197 owned public repositories including
forks;116 non-forks analyzed;25 GitHub languages totaling18,925,758 bytes.
WakaTime returns103 language records totaling49,986,830.01259 seconds including
Other, from its public all-time range. Today is excluded by the source. These
figures identify the observed snapshot, not permanent expected test values.

Machine-readable receipts and screenshots are under ignored `artifacts/`:

- `live-snapshot-validated.json`
- `cache-runtime-review.json`
- `live-restart-review.json`
- `browser-review.json`
- `preview-desktop.png`, `preview-mobile.png`
- `card-dark.png`, `card-light.png`, `card-transparent.png`

## Corrections verified during development

- Workers supports `redirect: 'manual'`, rather than Fetch's `error` mode.
  Both collectors reject3xx without forwarding credentials to another origin.
  The failed initial local cache contained no successful records and was
  retained separately under `.wrangler/first-start-without-success`.
- WakaTime freshness must be boolean true; present range/status fields must
  match the request and `ok`. Malformed or wrong-range200 responses cannot
  replace last-good data. Independent review reproduced the earlier boundary
  before verifying rejection after the fix.
- Precise coding seconds determine time ordering. Rounded0.00% rows cannot
  put a GitHub-only language ahead of positive tracked time.
- The isolated runtime harness uses the installed Miniflare5 compatibility
  converter, a bounded module root and its actual resource persistence option.
  Its temporary test-only class is not exported by production `src/index.ts`.

## Review limits

This validates a local implementation, real read-only upstream collection,
and simulated outages in the real Worker runtime. Production deployment,
Cloudflare account quotas and GitHub Camo behavior are not accepted here.
The initial activity view covers public repository/PR/issue/follower/star/fork
aggregates; it does not reproduce every optional metric from the old service.

The built-in Browser, Chrome integration and configured Computer Use did not
expose a usable browser controller in this session. UI validation therefore
used an isolated local Chrome Beta process, without changing an existing
browser profile or session. The preview remains running for user review.
