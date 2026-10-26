# Validation — simplified aggregate implementation,2026-10-26

CodeStats reads GitHub and WakaTime directly. The removed history implementation
is absent from source, tests, routes, UI and documentation. No extra packages
were installed, and real credentials remain in ignored .dev.vars mode0600.

## Current checks

-123 automated tests across6 files; strict TypeScript and diff checks passed.
- Node and Cloudflare Worker builds passed.
-10 real-workerd/SQLite checks passed with mocked upstreams, including503
  fallback, preserved last-success times, cooldown and persistence after restart.
-33 browser checks passed using isolated Chrome Beta via Playwright. The enabled
  tool catalog exposed no built-in browser, global Chrome or Computer Use
  controller. Actual checks covered expanded language/activity/year tables,
  engineering-family grouping, alternating selection of9 leaders, time ordering,
  Others-last/full100-percent totals/ten rows/card-table parity,
  sorting/themes/ranges,
  README clipboard, mobile overflow and6 SVG view/theme
  bounds. No JavaScript errors or clipping. Screenshots were inspected.
- The final Node preview was restarted on127.0.0.1:8791 over its existing cache.
  Aggregate values and original success timestamps survived the restart.
-36 Git-visible files were scanned in memory against configured secret values
  and token patterns; zero matches. Secret values/hashes were never printed.

## Live data observed

All three datasets from the two upstream services are fresh:

- GitHub:559 selected repositories,344 public/215 private,98 forks;128 languages,
  1,986,413,074 language bytes. Every repository/language page completed.
- Activity:47,439 indexed commits;47,248 calendar contributions;532 distinct
  contributed repositories with owned repos included;17 visible organizations.
- WakaTime all_time:104 languages,14,071.16 hours. The returned published range
  excludes today; no inaccessible shorter period is substituted.

A complete direct GitHub repository refresh used7 GraphQL requests: one profile
query plus six repository pages. The observed request durations totaled28.5s.
The first full-account attempt hit the inherited20s deadline; the finite collector
budget is now45s. Only the failed local Node cooldown was manually resumed after
this correction; no successful data or other cache keys were cleared. A warm
preview API request subsequently took19ms. This is one observation, not a benchmark.

Ignored receipts: artifacts/simple-core-verified.json, simple-preview-live.json,
simple-restart-review.json, browser-review.json and cache-runtime-review.json.
The preliminary failed live checks are retained separately from successful
post-correction evidence. Worker failure/restart testing uses isolated storage;
the current visible preview runs Node. Production Cloudflare deployment and
GitHub Camo timing are outside this local review.

## Complete grouped language breakdown,2026-10-26

The local Node preview at127.0.0.1:8791 was restarted with the existing cache.
Source datasets and their success timestamps were identical before/after.
139 display groups became9 selected groups plus Others; exact rows are retained
in ignored artifacts/grouping-verification.json.

- WakaTime seconds:50,656,159.730591 displayed versus50,656,159.730590 source
  (floating-point difference below0.000002s). Time shares total100 percent.
- GitHub bytes:1,986,413,074 displayed and source; shares total100 percent.
- Others includes14,448,172.489456seconds and218,234,484bytes.
- Node and Worker builds,111 tests and27 real Chrome Beta browser checks passed.
  Default SVG/table row order matched; Others remained last under manual sorts.
  Desktop/mobile screenshots were inspected; no JS errors, overflow or SVG clipping.
- No upstream collector, credential, raw cache or online deployment changed.

## Display percentage balancing,2026-10-26

Percentages use integer display units. At one decimal the live card shows
Others as28.5% WakaTime and10.9% GitHub; at two decimals the preview table
shows28.52% and10.98%. Each displayed column sums to exactly100% in integer
units. The precise Others seconds/bytes remain14,448,172.489456s/218,234,484B.

114 tests, strict TypeScript, both builds and28 Chrome Beta browser checks
passed, including exact sums from SVG labels and table cells. Tests cover
rounding overflow, missing/empty/incomplete sources and unchanged raw measures.
The preview was restarted with its existing cache; source datasets and success
timestamps were identical before/after. See ignored rounding-verification.json
and browser-review.json in artifacts. No deployment or credential change.

## Frontend grouping and slash labels,2026-10-26

HTML, web templates, Vue/Svelte/Astro and CSS/preprocessors now share the
HTML/CSS display group. Markdown/Text and CODESTATS/01 also use unspaced
slashes. JavaScript/TypeScript remains its existing independent family.

The actual frontend group totals468650.183971seconds and295602363bytes.
The complete10-row breakdown still conserves all original seconds/bytes and
sums to100% at both display precisions. Source datasets/timestamps were
identical across the local preview restart.114 tests, strict TypeScript,
Node/Worker builds and28 real Chrome Beta checks passed. The SVG was visually
inspected with no clipping. Evidence:ignored artifacts/frontend-grouping-
verification.json and artifacts/browser-review.json. No deployment.

## Language logos,2026-10-26

Reference show_icons uses Primer Octicons for activity metrics. Its language
and WakaTime lists retain colored circles. CodeStats instead embeds20 selected
Simple Icons16.36.0 paths, pinned revision2f67e5d1a7e5cba43c79a0ebc00abcd95fb0ea30.
Brand metadata, licenses and notices are retained in third_party/simple-icons.
No runtime package, webfont or icon CDN was added. Generic local paths cover
SQL, Shaders, Others and unknown languages.

115 tests and30 real Chrome Beta browser checks passed, including10 local logo
paths matching between SVG and HTML, zero external asset requests, no JS error,
mobile overflow or SVG text clipping. Dark/light screenshots were inspected.
Node/Worker builds passed. Data and last-success timestamps were unchanged
across the preview restart. Evidence:artifacts/icons-verification.json,
artifacts/language-icon-reference-review.json and artifacts/browser-review.json.

## Relative time column heading,2026-10-26

The left SVG column now shows RECENT12YEARS for the current published
since-Dec11-2014 range (spaces retained in the rendered heading). Other
accounts/ranges use rounded whole years/months or days. Exact source dates
take precedence; absent end dates use the saved source-success cutoff, not
the current clock. Unknown all-time spans show RECENT ACTIVITY. Right header
remains GITHUB · CODE BYTES.

122 tests, strict TypeScript, Node/Worker builds and31 real Chrome Beta checks
passed, including date-only inclusive ranges, short/month/year spans, published
since-date fallback and stale-cutoff behavior. Raw datasets/success timestamps
were identical across the preview restart. Evidence:ignored
artifacts/time-heading-verification.json and artifacts/browser-review.json.

## Compact card footer,2026-10-26

Removed the groups summary and multi-line visible SVG footer. A local Primer
clock precedes the two relative last-success ages on the left, separated by|.
The right GitHub mark and exact Power by github.com/Leask/CodeStats text link
to the repository. Original source dates/semantics remain in accessible SVG
metadata. Missing refreshes show not refreshed; future clock skew clamps0.

The normal10-row card is731px tall.123 tests, strict TypeScript, both builds
and33 Chrome Beta browser checks passed. An initial credit-icon overlap was
found and corrected before acceptance; all6 theme/view layouts now have no
footer overlap or clipping. Final dark SVG was visually inspected. The source
datasets/success timestamps were unchanged across both finite preview restarts.
Icons are embedded locally; Primer MIT notice is retained in third_party/octicons.
Evidence:ignored artifacts/footer-verification.json and browser-review.json.

## Two-line language icon alignment,2026-10-26

Card language icons are24px and centered across the name/time lines; the
single-line HTML detail table retains16px icons. Text moves8px right to keep
an8px icon gap. Native Chrome geometry verified all10 rows, maximum vertical
center difference0.501px, with no label/bar overlap. Focused screenshot inspected.
123 existing tests, both builds and33 browser checks passed. Evidence:
artifacts/icon-two-line-alignment.json and icon-two-line-alignment.png.

## v0.1.0 milestone acceptance, 2026-10-26

The final card uses a circular avatar, two rows of four summary metrics and
36px metric icons centered across each value/label block. Coding hours show
the numeric value without an `h` suffix, with `CODING HOURS` underneath.

Strict TypeScript, all 139 tests in eight files, Node and Worker dry-run builds,
11 isolated workerd/SQLite checks and 36 Chrome Beta browser checks passed.
The browser covered all six overview/activity theme layouts, README copying,
percentage totals, controls, mobile overflow and the current profile header.
No JavaScript errors, clipping or external browser assets were observed.
The final dark card was visually inspected.

Two old test expectations were updated to the already-reviewed UI: cache
fallback checks now verify the saved-data status and original success date
in SVG metadata instead of the removed snapshot badge; the metric spacing
check allows an 8px minimum between visible groups, accommodating the approved
36px icons. The observed narrowest gap was more than 10px.

Current ignored receipts are artifacts/browser-review.json,
artifacts/cache-runtime-review.json and artifacts/milestone-secret-scan.json.
Private settings, cache stores and generated artifacts remain excluded from Git.
This validation does not publish a Worker or replace a profile README embed.
