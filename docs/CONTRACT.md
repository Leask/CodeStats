# Implementation contract

Independent CodeStats repository, authorized for GitHub publication on2026-10-26.
Support both a regular Node HTTP server and Cloudflare Worker. Publishing source
does not deploy to Cloudflare or edit the profile README. No cron/daemon needed.

Use `src/types.ts` as the shared contract. The user authorized aggregate public,
private, organization and external personal activity. Collectors never return
token strings, raw upstream errors, repository names/IDs, project names or file
paths. Reject malformed or incomplete pagination rather than replace last-good
data. Do not confuse repository content bytes with personal authorship.

`src/github.ts`: export `fetchGitHub(env, fetcher = fetch): Promise<GitHubData>`.
Use GitHub GraphQL and a server-side token. Paginate all owned non-fork
repositories and all language-byte fields, including archived repositories.
`public` filters and verifies public scope; `all` includes currently token-visible
private repositories. Owned repository counts include forks; analyzed count and
scope are explicit. PR/issues search spans all visible repositories in all mode.
Do not silently cap repository or language pagination.

`src/github-activity.ts`: independent activity collector. Authenticate as the
configured user and require classic repo/profile/org read scopes for all mode.
Reject SSO partial results. Collect indexed authored commits, distinct non-self
PR/issue participation, discussions/accepted answers, recent review/repository
contributions and all reported calendar years. Never add restricted contributions
to the already inclusive calendar total. Lifetime external repository counts
deduplicate transient IDs across contribution types/years; saturated intervals
split or fail closed. Private activity is unavailable in public-only mode rather
than silently publishing mixed-scope aggregates.

`src/wakatime.ts`: export `fetchWakaTime(env, range, fetcher = fetch): Promise<WakaData>`.
Read the official public API, optional OAuth Bearer token. Default all_time because
Leask's public profile publishes that range. Preserve upstream language percentages;
total includes Other. A different inaccessible range remains unavailable, not silently
replaced by all_time. Aggregate language/time fields only.

`src/render.ts`: export `renderCard(snapshot, options): string` (standalone SVG),
`renderPage(): string` (responsive HTML preview using `/api/stats` and `/card.svg`),
and `joinLanguages(snapshot, sort): LanguageRow[]`. SVG options must not inject raw
untrusted markup; XML escape dynamic text. Valid SVG without foreignObject, scripts
or remote fonts. Separate WakaTime time-share denominator from GitHub byte-share.
Time-first rows plus GitHub-only rows; preserve Other as time-only (code null).
Use intentional language aliases (e.g. Bash→Shell, Vue.js→Vue), not substring matching.
Preview has themes, range/view selection, expanded language/activity/year tables and copyable README
snippet with native `<details>`/`<picture>`; images cannot have JS interaction on GitHub.
All fresh/stale/unavailable source timestamps must be visible and clearly labelled.

`src/app.ts` owns shared HTTP routes. `src/snapshot.ts` creates the common provider
cache. `src/index.ts` adapts Durable Objects; `src/node.ts` and
`src/node-storage.ts` adapt Node HTTP and private SQLite storage. Tests and
documentation must cover both runtimes.
Persistent Durable Object storage retains separate core, activity and WakaTime
last-success records without TTL deletion. GitHub scope keys are isolated while
the original profile object/WakaTime range keys remain stable. Fresh TTL defaults6h;
failure cooldown15m, extended by upstream rate-limit/reset headers. Background refresh returns existing
data quickly; on cold start wait for initial refresh. Single profile DO coalesces
concurrent refreshes. No scheduled trigger is added in this local-first iteration.
