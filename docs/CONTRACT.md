# Implementation contract

CodeStats is one single-profile application with Node and Cloudflare Worker
adapters, sharing collectors, cache, routes and rendering.

- github.ts: native GraphQL repository counts, PR/issue aggregates, stars, forks
  and language bytes.100 repositories and100 languages/page; follow cursors.
  Stars count only repositories owned by the configured user, including own
  forks when enabled. Organization/collaborator stars are excluded without
  narrowing repository counts, fork counts or language bytes. Ownership comes
  from the existing repository pages, with no extra API calls or history joins.
  Collection v7 also records a sorted language-set frequency histogram for
  exact per-group repository unions, including the empty set. It never stores
  repository identities; app.ts strips this internal histogram from public JSON.
- github-activity.ts: REST Search total_count with per_page=1; GraphQL discussion,
  review and calendar aggregates. Lifetime contributed repositories deduplicate
  the API's annual repository summaries, including review-only repositories.
  Split saturated date ranges as the reference does, never individual commits.
- github-api.ts: official GitHub origin, server-side PAT/OAuth bearer token,
  bounded requests/timeouts, safe errors, GraphQL and SSO checks.
- github-profile.ts: public bio/status and a bounded unauthenticated avatar
  request to GitHub's avatar origin; cached embedded raster, no nested image fetch.
  Organization-only status messages are excluded from public output.
- rank.ts: reference-project weighted percentile estimate using saved aggregates;
  preserve the MIT attribution in third_party/github-stats-extended.
- wakatime.ts: official all_time statistics by default, optional OAuth read token.
  Preserve the returned period, today flag and Other-inclusive denominator.
- cache.ts/snapshot.ts: independent durable last-good datasets for GitHub
  repositories, GitHub activity and WakaTime. Two services, three datasets.
  Scope changes use separate keys. Fresh6h, retry15m, rate-limit-aware.
  Warm requests return saved data while refreshing; failure retains values/times.
  Optional AI usage services have separate keys and reporting windows. Codex
  imports preserve the actual observation time and never acquire freshness from
  a visitor request. No provider credentials enter a public snapshot.
  Collection upgrades retain the v6 repository-key lineage and classify the old
  payload as stale, so adding language counts never erases last-good snapshots.
- render.ts/app.ts: transparent SVG at `/` and `/card.svg`; HTML card builder at
  `/build` and `/build/`; aggregate JSON at `/api/stats`. The builder's default
  Markdown is one linked image of the root URL, with nondefault query parameters
  only. Expandable language/activity cards are opt-in. Snippet generation does
  not depend on a successful statistics fetch. GitHub bytes and WakaTime hours
  retain separate denominators. Language
  families are summed first. Alternating time/byte ranks select9 named groups,
  excluding upstream Other. Display defaults to GitHub byte order; Others remains last
  and sums the entire unselected remainder. Both columns conserve all collected
  seconds/bytes using their original full-source denominators. The preview and
  SVG share selection/remainder logic. Displayed percentages use integer units
  at each surface's precision, with Others equal to100 minus displayed named
  shares; original seconds/bytes and missing-data semantics remain unchanged.
  Bar geometry is separately max-normalized per source with an explicit scale
  percentage in each heading; labels retain their original source percentages.
  Repo counts appear under language names, with bytes and time under their bars.
  `/api/stats` returns server-computed `languageRows` for the requested sort/limit;
  the builder uses those same rows instead of reimplementing grouping in JS.
- language-icons.ts/icon-data.json: local SVG logo paths shared by README and
  HTML preview; no external images/fonts, safe neutral fallback for unknowns.
- index.ts: SQLite Durable Object adapter. node.ts/node-storage.ts: Node HTTP
  and private SQLite adapter. Preserve both cache directories independently.

Wrangler keeps `keep_names: false` and `minify: false`. The builder embeds shared
helper functions as source; name-preservation instrumentation can otherwise add
an undefined `__name` helper to browser code. Preserve these bundle settings and
validate the generated Worker builder in a browser after changing the build.
Runtime credentials are Worker secret bindings, separate from build secrets.

No commit-history walker, additions/deletions counter, author attribution, SHA
ledger, backfill queue, progress poller, login UI or scheduler is implemented.
No private repository names/IDs, project/file names, secrets or raw upstream errors
leave collectors. Only key-free configuration samples are tracked.

See [reference comparison](github-collection-plan.md) for semantics and defaults.
