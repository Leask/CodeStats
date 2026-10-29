# Implementation contract

CodeStats supports a configured profile and username-selected public profiles for
**GitHub, WakaTime, Codex and OpenRouter**, with Node.js and Cloudflare Worker adapters sharing collectors,
cache, routes and SVG rendering. Services retain their own metric definitions
and reporting periods; their counts are not combined into a cross-provider total.

## Four primary sources

- **GitHub:** `github.ts` reads native GraphQL repository counts, PR/issue
  aggregates, owned stars, forks and current language bytes. Repository and
  language connections use bounded cursor pagination. Stars count repositories
  owned by the configured user, including owned forks when enabled; organization
  and collaborator stars are excluded without narrowing repo counts or bytes.
  `github-activity.ts` uses REST Search `total_count` with `per_page=1` and GraphQL
  discussion, review and calendar summaries. Annual contributed-repository
  summaries are deduplicated; saturated date ranges may be split, individual
  commits are never traversed. These two datasets are one external service.
  `github-public.ts` implements separate anonymous REST collection: public
  profile, bounded complete owned-public metadata and authored Search counts.
  It sends no Authorization header, requests no language/commit histories and
  leaves unsupported bytes/calendar/review/organization metrics undefined.
  Ten metadata pages are the explicit cap; transient/schema/pagination failures
  throw rather than replace good data with partial totals.
- **WakaTime:** `wakatime.ts` reads the official statistics API, `all_time` by
  default. Named public data takes precedence; inaccessible/pending/invalid data
  can use same-range OAuth only after `/users/current` verifies the token owner.
  Rate/network/5xx/redirect failures do not trigger OAuth fallback. Token-only
  identity is resolved before persistent cache selection. It preserves the returned period,
  today's-inclusion flag and Other-inclusive denominator. Range selection
  affects WakaTime, not the token-usage providers.
- **Codex:** `codex-node.ts` starts its own bounded local app-server child and
  reads `account/usage/read` through the existing supported CLI login. It accepts
  only the five account-summary fields and observation time, not transcripts or
  credentials. Node reads locally when enabled; the Worker receives validated
  aggregate imports through `POST /api/usage/codex`. A configured Codex ID or
  sync secret auto-enables the integration; `CODEX_USAGE_ENABLED=false`
  explicitly disables it. Imports require a separate sync secret of at least
  32 characters, regardless of how the integration was enabled.
  Imports are serialized and older/equal observations are rejected. Visiting
  the card never gives an old imported observation a new success timestamp.
  `CODEX_USERNAME` is a bare public ID that enables the configured integration
  and supplies its fixed-host profile link; it never switches the local account.
  Public ID requests have unavailable usage and cannot read owner CLI/imports.
- **OpenRouter:** `ai-usage.ts` issues one unfiltered Management-key analytics
  query for daily `tokens_total` and `request_count`. It sums every returned day,
  inserts inactive days for averages/streaks, excludes today's partial UTC day,
  and rejects truncated, warned, invalid, duplicate or out-of-range responses.
  The collector defaults to 367 completed UTC days and accepts shorter explicit
  intervals. Its five outputs are total tokens, average tokens/day,
  average tokens/week, total prompts (API requests), and longest streak.

Anthropic organization API usage remains an optional advanced extra. It is
configured separately and is not advertised as a fifth default source or as
personal Claude subscription usage. Codex and OpenRouter usage rows are omitted
from public SVG/JSON when not enabled; the builder still explains their setup.

## Data and cache boundaries

`github-api.ts` sends PAT/OAuth credentials only to the official API, with safe
errors, request/time bounds, GraphQL and SSO checks. `github-profile.ts` reads
public bio/status and a bounded avatar from GitHub's avatar origin, caching an
embedded raster. Organization-only status text is excluded.

Collection v7 stores a language-set frequency histogram for exact per-group
repository unions, including empty-language repositories. It never stores repo
identities. `app.ts` strips that internal histogram from public JSON; only the
computed language rows and aggregate counts leave the service.

`cache.ts` and `snapshot.ts` preserve independent durable last-good observations:
GitHub repository/activity datasets, each WakaTime range and each enabled usage
provider. Defaults are six-hour freshness and fifteen-minute retry cooldown,
with longer GitHub rate-limit waits respected. Warm requests return saved data
while a due refresh runs. A failed refresh does not replace good data with zero
or change its last-success time. No successful-snapshot deletion TTL is applied.
Public profiles collect on demand and never join a background schedule.
Configured-profile refresh is opt-in through Node `AUTO_REFRESH_SECONDS` or a
Worker Cron Trigger invoking its scheduled handler for `DEFAULT_RANGE`.
No cron is installed automatically, and refresh cannot redate Codex imports.
Opt-in interval/scheduled refresh bypasses freshness while honoring retry waits;
normal visitor reads continue using the configured freshness policy.
Collector upgrades retain supported old cache lineages
while marking old payloads stale until replacement succeeds.

Four source names do not imply four HTTP requests, one shared timestamp or full
lifetime coverage. Freshness describes observation age. Codex may describe
account lifetime activity; OpenRouter describes its bounded analytics interval;
GitHub byte inventories and WakaTime time shares have separate denominators.
Provider credentials, private repo identities, raw upstream errors, project/file
names and chat content are absent from published snapshots.

## Builder and README card

`render.ts` and `app.ts` serve transparent SVG at `/` and `/card.svg`, the HTML
builder at `/build` and `/build/`, and aggregate JSON at `/api/stats`. The builder
has four primary provider cards with setup, scope and freshness guidance. GitHub
repository/activity states appear inside one GitHub provider. Unconfigured usage
services say **Not enabled** in the builder; they do not become invented SVG
rows. Anthropic appears only when configured. Credentials remain server-side;
builder controls accept public names/IDs and source masks, never keys.

`profile.ts` parses `github`, `wakatime`, `codex` and `sources`. Any account
selector creates strict public mode, including an ID matching the owner.
Only explicitly supplied public accounts remain. `publicSettings` is a whitelist
that strips all owner credentials, Codex imports and OpenRouter/Anthropic access.
No account selector means the configured account subset. `sources` accepts every
nonempty subset of the four primary providers; selection cannot authorize data.
Malformed/duplicate IDs, masks and secret-bearing query parameters are rejected.
Public profile cache namespaces are distinct from configured/private lineages;
changing a view or source mask reuses only the correct account observations.
Token-only WakaTime preparation namespaces only `wakatime:` entries, preserving
existing GitHub/AI cache and Codex import lineages in the configured store.
An unresolved identity uses no resolved owner's WakaTime namespace.

The default Markdown is one root-URL image linking to the CodeStats repository,
with only nondefault URL options. Expandable language/activity cards are opt-in.
Snippet generation remains available when statistics fetches fail. The builder
and SVG use the same server-computed `languageRows` for the requested sort/limit.

Language families merge first. Alternating GitHub/WakaTime ranks select nine
named groups, starting with GitHub and excluding upstream Other. Display defaults
to GitHub byte order. Others stays last and contains every unselected byte and
second. Displayed percentages use integer units at each surface's precision,
with Others equal to 100 minus displayed named shares. Original quantities and
missing-data semantics are preserved. Each bar column independently rounds its
largest displayed unrounded share up to a 10-percentage-point scale, stated in
its heading. Bars use that common column scale; labels retain true source shares.
Repo union counts appear under names, bytes/time under their respective bars.

The card uses three text sizes, a GitHub avatar with a rank-progress rim, and
shared outer edges. Rank remains top-right with or without the profile header;
the no-header rank/overview gap is 20px. Codex precedes OpenRouter in usage rows
and refresh labels. Each has five native metrics. Refresh labels can wrap to fit
the configured services; linked project credit is right-aligned.

## Runtimes and validation

`index.ts` adapts a SQLite Durable Object; `node.ts` and `node-storage.ts` provide
Node HTTP and private SQLite storage. Preserve Node `.data/` and local Worker
`.wrangler/state` independently. Keep production Worker identity, binding and
migration history stable. Local stores are not production imports.

`/health` indicates runtime readiness and nonsecret configuration presence/intent,
not upstream authentication or successful collection. `/api/stats` supplies actual
per-dataset freshness, last success, errors and reporting scope. Worker runtime
secrets are separate from build secrets. Configuration samples contain placeholders
only. Codex login material is never a Worker secret or import payload.

Wrangler retains `keep_names: false` and `minify: false`: shared helpers are
serialized into the browser builder, so name instrumentation must not introduce
an undefined `__name`. Validate the generated Worker in a browser after build
changes; bundle success alone is insufficient.

`rank.ts` keeps the reference weighted-percentile estimate and MIT attribution.
Language logos, provider brand paths and UI glyphs are bundled locally with their
notices in `third_party`; no external fonts or nested SVG image fetches are needed.

The four focused views are `github`, `wakatime`, `codex` and `openrouter`.
`overview` stays the default; legacy `languages` and `activity` remain supported.
Source-specific cards preserve unknown/zero distinctions and do not manufacture
language bytes or account usage when an anonymous API cannot supply them.

No per-commit history walker, authored additions/deletions counter, SHA ledger,
backfill queue, login UI or arbitrary-URL/profile scraper is implemented.
Collector bounds limit individual fetches, not total public-profile traffic;
operators remain responsible for host request limits and storage growth.

See [deployment](DEPLOYMENT.md), [usage definitions](AI-USAGE.md) and
[reference comparison](github-collection-plan.md).
