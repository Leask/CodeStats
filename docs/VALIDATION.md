# Development and validation

[Back to CodeStats](../README.md) · [Implementation contract](CONTRACT.md)

Current local acceptance: [public profiles and source views, 2026-10-28](history/validation-2026-10-28-public-profiles.md).
The earlier [four-source builder review](history/validation-2026-10-28-four-sources.md)
remains historical; it predates public multi-profile selection.

Run from the repository root with Node.js 26+ and `npm ci` already completed:

```sh
npm run check
npm test
npm run build:node
npm run build
npm run test:runtime
npm run test:profiles:browser
```

| Command | What it establishes |
| --- | --- |
| `check` | Strict TypeScript checks |
| `test` | Collectors, bounded usage windows, private-data boundaries, cache fallback/concurrency, Codex import validation, language grouping, percentage totals and safe rendering |
| `build:node` | Bundled Node entry point at `dist/node.mjs` |
| `build` | Wrangler dry-run bundle; no production deployment |
| `test:runtime` | Real workerd and SQLite Durable Objects in isolated storage, using mocked upstreams |
| `test:profiles:browser` | Generated Worker, configured/public account isolation, 15 masks per mode, builder inputs/Markdown and focused-card geometry in an actual browser |

Runtime tests cover persistence across restart, bounded retries, partial source
failure and retained successful values/timestamps. They use no live tokens and
create no deployed cloud resources. A passing build does not prove an upstream
connection or working browser interface.

## Four-source acceptance

GitHub, WakaTime, Codex and OpenRouter are separate services. GitHub's repository
and activity snapshots are separate datasets inside one service. Do not count
them as a fifth source, or infer that all GitHub data is fresh from one dataset.

| Source | Verify with real configuration |
| --- | --- |
| GitHub | Correct public identity, expected token-visible scope, repository and activity statuses checked independently; no private repo identities in public JSON |
| WakaTime | Requested range, returned period/denominator, correct OAuth or public access; unavailable all-time is not silently replaced with another range |
| Codex on Node | Enabled only when intended; local supported CLI login returns five native account-summary metrics; no chat or login material published |
| Codex on Worker | One successful authenticated numeric-only sync, original observation time preserved, newer observation required for a subsequent import |
| OpenRouter | Management-key access, stated completed-UTC interval, every returned aggregate included, five metrics and rejected partial responses |

Run the card with Codex/OpenRouter disabled as well. Their four-source builder
cards must explain **Not enabled**, while their SVG rows and footer refresh times
remain absent. Missing native fields must show a dash, real zeros must stay zero,
and a failed refresh must retain last-good values and their original timestamp.
Anthropic is an optional additional organization API source, not a fifth default
provider or a substitute for personal Claude subscription statistics.

`/health` confirms runtime readiness and configuration presence/intent only.
Verify real collection through each snapshot in `/api/stats` and the builder's
scope, status and last-success details. A boolean enable flag does not establish
a supported local Codex login or a completed Worker sync.

## Browser review

Start the chosen local Node or Worker runtime, open `/build`, then run:

```sh
npm run test:preview
```

The test uses an isolated installed Chrome Beta when available, otherwise
Playwright Chromium. If neither is installed:

```sh
npx playwright install chromium
```

`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` selects another browser executable;
`PREVIEW_URL` selects the local service URL. The live-profile browser check
expects a populated default ten-row card and available datasets. Repository and
WakaTime snapshots must be fresh; activity's actual stale/error state must agree
with its displayed details. Optional usage providers are checked according to
the configured services, not required unconditionally. This is not an offline
test for every profile or an attestation about production freshness.

Review these visible behaviors:

- Four primary source cards, one grouped GitHub service, useful disabled/error
  guidance, and no credential-entry fields or exposed keys in the browser.
- Working presentation controls, readable inset dropdown arrows, mobile layout,
  generated Markdown and clipboard interaction.
- Nine merged language groups plus Others, conserved full-source shares, exact
  per-group repository unions, and source-specific scales rounded upward in
  10-percentage-point steps. Raw values remain under their own bars.
- Three card font sizes, aligned outer edges, rank at top-right with/without the
  profile header, and a 20px rank/overview gap in the no-header card.
- Codex before OpenRouter, five metrics each, periods retained, and per-source
  refresh labels that wrap without colliding with right-aligned project credit.
- Default transparent root SVG, optional explicit themes, native expandable
  README sections, and a usable Markdown generator even when statistics fail.

Ignored screenshots and machine-readable review receipts go in `artifacts/`.
Check actual bounds and clipping, not just template attributes or a screenshot
of a still-loading image. Inspect the rendered README separately: GitHub's image
proxy can cache a previous successful response after the origin changes.

## Public profiles and source combinations

Validate all 15 nonempty subsets of `github,wakatime,codex,openrouter`, including
`github,codex`, `wakatime,openrouter` and `github,codex,openrouter`. Exercise
`overview` and each focused `github`, `wakatime`, `codex`, `openrouter` view;
retain legacy `languages`/`activity`. A mask selects sources; it cannot grant
credentials or manufacture unavailable statistics.

Use isolated fixtures for these acceptance cases, then separately record any
bounded live public observations. Do not clear the existing preview store or
copy credentials to tests:

- No account selectors uses only configured accounts; `sources` can narrow them.
- Any explicit ID creates public mode, including the same ID as the owner.
  Omitted accounts and all provider tokens/owner usage imports remain excluded.
- Public GitHub uses anonymous official REST only; profile and complete metadata
  totals stay accurate, unsupported bytes/calendar/review fields remain unknown,
  zero stays zero, and inventory/Search partial failures preserve last-good data.
- Named WakaTime public data wins even when OAuth is configured. Unavailable or
  invalid public data can use only the same range after a matching owner check.
  Different owners, wrong ranges, pending results and rate limits cannot replace
  a good observation. Token-only setup resolves its identity before cache access.
  Switching to a resolved/unresolved WakaTime namespace must leave saved GitHub
  and AI observations, including Codex imports, in their existing lineages.
- Public Codex IDs produce canonical fixed-host links with unavailable usage;
  owner CLI/imports are never read. Public OpenRouter does not expose owner totals.
- Public cache identities are isolated from configured/private ones. Changing
  presentation/masks must not copy observations across accounts or modes.
- Malformed IDs, duplicate/unknown masks, secret query parameters, untrusted
  redirects and raw upstream errors are rejected without leaking credentials.
- Optional Node intervals/Worker scheduled calls touch only configured accounts
  and `DEFAULT_RANGE`. No trigger is installed by tests, public IDs are never
  scheduled, and an old Codex import retains its observation age.

Check the builder's actual selected profile, generated SVG and copied Markdown
for each combination. Verify standalone source cards with both missing and valid
data, plus desktop/mobile layout. A unit-test pass, fixture screenshot or previous
four-source report is not proof of a live provider connection or new browser acceptance.

## Generated Worker review

```sh
npm run test:worker:browser
```

This command builds with the actual Wrangler configuration and runs its generated
Worker in workerd with isolated SQLite and mocked upstreams. It exercises the
builder, source failure, SVG/Markdown, clipboard and HTTP/JSON errors without
live credentials. It is separate from the Node preview and does not deploy.

Serialized browser helpers must not reference an undefined `__name`. Keep
`keep_names: false` and `minify: false`. After bundle changes, test the generated
Worker's actual `/build` page; a successful Wrangler bundle is insufficient.

## Storage, secrets and reports

Node caches live in `.data/`; local Worker caches in `.wrangler/state`. Keep
stores private and preserve the runtime's chosen store across restarts. Tests
use isolated stores and must not clear the live preview cache. Production
Worker data is separate from both local directories.

The first automatic Codex Worker sync privately saves its bridge key in
`.data/codex-sync.json` (or `CODESTATS_DATA_DIR`). This ignored key file is local
execution state, not a fixture or public report. Preserve it for later syncs;
never print, upload as statistics, or commit its contents.

Samples contain placeholders only. Never read credentials back into reports,
URLs, logs or screenshots, and do not print or hash tokens to prove configuration.
Use `/health` booleans and native source statuses for that distinction. Codex sync
must send aggregates, not auth files or chat history.

The dependency lock is committed. SVG path data/template fragments may exceed
normal line limits to keep vectors and markup intact. Ordinary code uses the
project's four-space indentation and strict TypeScript settings.

Dated observations are retained under [history/](history/validation-2026-10-26.md),
including the later [scale/repository-count review](history/validation-2026-10-28.md).
Historical counts and passed checks are not claims about this revision, a new
account, current provider availability, cloud capacity or image-proxy timing.
