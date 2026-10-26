# Validation — 2026-10-26

The same shared application runs in a regular Node HTTP server and in
Cloudflare workerd. The current implementation has no runtime dependency on
GitHub Stats Extended or its deployment. Historical links in the collection
notes are research references only.

## Automated checks

- Strict TypeScript check passes.
- All98 tests in six files pass: official API collectors, pagination and scope
  checks, rendering, independent source caches and eight Node integration tests.
- Ten isolated real-workerd/SQLite checks pass. Warm successful snapshots survive
  injected upstream503 failures and runtime restart with their original success
  timestamps, failure cooldown and usable SVG. Cold failures never invent data.
- Node integration covers shared HTTP/JSON/SVG/HEAD/ETag/method handling,
  SQLite persistence, account isolation, private file/sidecar permissions,
  failure fallback and cooldown, and graceful background-refresh shutdown.
- Both build targets pass: `npm run build:node` and the Worker
  `npm run build` dry-run. A dry-run does not publish to Cloudflare.
- Production dependency audit reports zero vulnerabilities.

## Actual local acceptance

Both local runtimes fetched real data from the fixed official GitHub and
WakaTime origins. GitHub core, personal activity and WakaTime all-time snapshots
all returned fresh, nonempty data. WakaTime currently returns104 language rows,
joined into129 language mappings with GitHub. These are observed values, not
fixtures or permanent expectations.

The subsequent completeness audit corrected the omission of review-only external
repositories from both recent and lifetime repository aggregates. Version2
activity refreshed successfully in the original Node and Worker caches, keeping
GitHub-core and WakaTime success timestamps unchanged. Unit tests verify that a
version1 record is served as stale during migration and remains stale, readable
and protected by the upstream cooldown after a failed refresh and restart.

The live audit returned383 owned repositories (197 public/186 private),301
non-fork analyzed repositories,63 code languages,17 matching REST/GraphQL
organization memberships and17 contribution years. The configured WakaTime
collector and a separate public all-time request match:104 languages,
50,656,159.73059 seconds including
Other, beginning Dec11,2014, with today excluded by the source. Language seconds,
repository counts, language bytes and annual contribution totals reconcile.
These observations were checked on2026-10-26; they are not fixed expectations.
The ignored `artifacts/collection-coverage.json` records the14 live checks.
This configured all-time range is public and does not require a WakaTime token.

Both processes were gracefully stopped and recreated over their original cache
directories. The three provider payloads and all original success timestamps
were independently compared and were unchanged. No local cache was reset or
migrated between modes.

Seventeen real-browser checks passed against each runtime, using isolated Chrome
Beta via Playwright because the enabled tool catalog exposed no built-in browser,
global Chrome or Computer Use controller. Checks cover live sources, full language
rows, expansion, sorting/themes, range isolation, GitHub activity and annual
history, README generation/clipboard, mobile overflow, six SVG view/theme bounds,
and JavaScript errors. Screenshots were inspected; no clipping was found.

## Secret and publication boundary

Only `.env.example`, `.dev.vars.example` and nonsecret `wrangler.jsonc` are
publishable configuration. Real `.env`/`.dev.vars`, SQLite files, `.data`,
`.wrangler`, screenshots, aggregate receipts and build output are ignored.
Before publication, Git-visible files and all historical blobs were scanned
in memory for configured key values and common token patterns. Values are never
printed or copied into reports. The server credential file remains0600.

Runtime secrets belong in the Node environment/private `.env`, or Cloudflare
Settings → Variables and Secrets / `wrangler secret put`, never Wrangler `vars`.
The Node process may also reuse the existing private `.dev.vars` for local review.

## Limits

GitHub results cover token-visible, API/search-indexed data. Deleted history,
revoked access and organization SSO policies limit coverage. WakaTime may be
recalculating or may not expose a requested private range; last-successful data
is retained and timestamps remain visible. GitHub code bytes measure repository
content, not personal authorship or coding time.

These checks validate local operation, failure fallback, restart persistence and
publishable source. Cloudflare production deployment, account quotas, global
storage availability and GitHub Camo refresh timing have not been accepted here.
The profile README has not been changed.

Ignored local receipts include `artifacts/dual-runtime-restart-review.json`,
`artifacts/cache-runtime-review.json`, `artifacts/browser-review.json` and preview
screenshots. They are deliberately excluded from the public source repository.
