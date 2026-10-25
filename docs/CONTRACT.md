# Implementation contract

Local-only project; no remote repository, push, Cloudflare provisioning, deployment,
production README edit, cron or daemon is authorized in this review stage.

Use `src/types.ts` as the shared contract. Collectors only return aggregate public
data; they never return token strings, raw upstream error bodies, repository names,
project names, file paths or private repository statistics. Reject malformed or
incomplete pagination rather than replace a complete last-good snapshot.

`src/github.ts`: export `fetchGitHub(env, fetcher = fetch): Promise<GitHubData>`.
Use GitHub GraphQL and a server-side token. Paginate ALL owned public non-fork
repositories and all of their language-byte fields, including archived repositories.
Public repository count may include forks; analyzed count and scope are explicit.
PR/issues counts use explicitly public search queries across GitHub, lifetime.
Do not silently cap repository or language pagination or claim all-time commits.

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
Preview has themes, range/view selection, expanded language table and copyable README
snippet with native `<details>`/`<picture>`; images cannot have JS interaction on GitHub.
All fresh/stale/unavailable source timestamps must be visible and clearly labelled.

Root owns `src/cache.ts`, `src/index.ts`, tests, local runtime and final README.
Persistent Durable Object storage retains each provider's last success without TTL
deletion. Fresh TTL defaults6h; failure cooldown15m. Background refresh returns existing
data quickly; on cold start wait for initial refresh. Single profile DO coalesces
concurrent refreshes. No scheduled trigger is added in this local-first iteration.
