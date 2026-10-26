# CodeStats

One service for Node.js and Cloudflare Workers that combines WakaTime coding time, GitHub language bytes,
and personal GitHub activity into a README-ready SVG. GitHub statistics come
directly from official GitHub APIs. The preview includes expandable language,
activity and annual-contribution tables and generates GitHub `<details>` sections.

## Run with Node.js

```sh
npm ci
cp .env.example .env
# Set GITHUB_TOKEN in .env; WAKATIME_TOKEN is optional.
npm start
```

Open **http://127.0.0.1:8791**. This runs a regular Node HTTP server with a
private SQLite cache under `.data/`; no Cloudflare account, Wrangler process,
external database or local database service is needed. Node.js26 or newer is
supported. The production build baseline in `.nvmrc` is26.12.1; local Node
installations can follow their package manager.

`HOST`, `PORT` and `CODESTATS_DATA_DIR` customize the Node listener and cache.
Existing process environment variables take priority over files. For convenience,
Node also reads the existing local `.dev.vars` before `.env`; `.env` wins over
`.dev.vars`. Stop one runtime before using the same port with the other runtime.
Keep the cache directory across restarts and mount it persistently in a container.

## Run as a Cloudflare Worker

```sh
npm ci
cp .dev.vars.example .dev.vars
# Set GITHUB_TOKEN in .dev.vars. Keep this file private.
npm run dev:worker
```

Open the same **http://127.0.0.1:8791**. This mode runs in local workerd and uses
SQLite-backed Durable Objects under `.wrangler/state`. The Node and Worker
stores are independent; switching modes does not migrate or erase either cache.
Both adapters share the same HTTP routes, collectors, rendering and cache policy.

The first request fetches real upstream data. There are no demo numbers on the
preview page. The configured `all` visibility includes public/private repository
aggregates and personal activity in organizations and external projects. Use a
classic PAT with `repo`, `read:user` and `read:org` (broader inherited scopes are
recognized). Authorize SSO for applicable organizations. The collector uses read
operations only. Permissions and partial SSO responses are checked before data
is accepted; inaccessible organizations remain outside token-visible coverage.

Only key-free `.env.example` and `.dev.vars.example` are versioned. Never put a
real key in a README, query string, frontend bundle or deployment argument.

Nonsecret settings go in `wrangler.jsonc` for Workers, or `.env`/environment
variables for Node:

| Setting | Default | Meaning |
| --- | --- | --- |
| `GITHUB_USERNAME` | `Leask` | Fixed GitHub profile; activity token must belong to it |
| `GITHUB_VISIBILITY` | `all` | Token-visible aggregates; `public` restricts core data and disables extended private activity |
| `WAKATIME_USERNAME` | `leask` | Fixed WakaTime profile |
| `DEFAULT_RANGE` | `all_time` | Initial coding-time range |
| `FRESH_SECONDS` | `21600` | Refresh after six hours |
| `RETRY_SECONDS` | `900` | Fifteen-minute cooldown after failure |

The deployment is intentionally tied to configured accounts. Visitors cannot use
query parameters to make the server access arbitrary accounts or upstream URLs.

## What the percentages mean

**WakaTime:** tracked coding seconds for the selected range. Sorting uses exact
seconds; the displayed percentages retain WakaTime's rounding. The denominator
includes `Other`, so the total shown is `total_seconds_including_other_language`.
`Other` has no comparable GitHub language and displays a dash, not a false zero.

**GitHub:** language bytes across every token-visible owned non-fork repository,
including public, private and archived repositories. Each language page is read
in full. Percentages use the sum of all those bytes, before selecting display
rows. This is a current repository snapshot, not lines of code, authorship, or a
measurement of time spent working. Owned public/private repository counts
include forks; analyzed repository count and stars/forks exclude them. Activity
in organization/external repositories is counted as personal activity; their
whole codebases are not assigned to your owned-repository language shares.

The two denominators and periods are different. They remain separate columns;
there is no blended score. Explicit aliases, such as Bash→Shell and Vue.js→Vue,
allow a language to appear on one row. GitHub-only languages stay in the full
table with zero WakaTime time when WakaTime data is available.

Activity includes lifetime authored/merged PRs and issues, search-indexed
authored commits, distinct non-self-authored PRs reviewed/commented and issues
commented, discussions started and accepted answers. Annual contribution
calendar totals are collected for every reported contribution year, with
restricted contributions included once. Recent review contributions and recent
contributed repositories use GitHub's recent-year semantics; lifetime contributed
repositories are deduplicated across years for commits, issues, PRs, PR reviews
and repository creation, including review-only external repositories and excluding
currently owned repositories. Saturated repository lists are split into smaller
date intervals and unresolved truncation fails closed.

Commit search covers indexed default branches. Calendar contributions follow
GitHub eligibility rules and differ from commit counts. Search scope limits,
deleted records and lost access prevent claiming every historical action.
Counts and periods remain explicitly labeled, rather than combined into a rank.
See [the collection implementation and permission notes](docs/github-collection-plan.md).

WakaTime **all-time** is the default. If a different range is not published
or authorized, it remains unavailable without substituting all-time data. For other/private ranges, configure an optional
server-side `WAKATIME_TOKEN` OAuth token with `read_stats.languages`. Heartbeat
API keys are not used for read access. The API's `rangeLabel`, `includesToday`
and any supplied start/end values are preserved; missing dates are not invented.

## Persistent cache and failure behavior

On Cloudflare, one SQLite-backed Durable Object coordinates the configured
profile globally. Node uses its own private SQLite file and a shared in-process
cache. Both stores hold independent last-good records for GitHub core, GitHub
activity and each WakaTime range. GitHub visibility modes use separate storage keys;
switching scope preserves WakaTime and never relabels public data as all data.

1. First visit without saved data waits for an initial bounded fetch.
2. Within six hours, all views reuse the saved data without upstream requests.
3. After that interval, the existing card is returned immediately while the
   corresponding provider refreshes in the background.
4. A timeout, rate limit, 3xx, HTTP error, GraphQL error, incomplete pagination,
   pending WakaTime computation, or malformed statistics retain the old record
   and its original success timestamp. Failed requests never become zero stats.
5. A persisted cooldown respects GitHub rate-limit/reset delays and prevents
   repeated refresh attempts during an outage.
   Concurrent refreshes for one source are coalesced.
6. Saved successful data has **no deletion TTL**. Its refresh deadline does not
   expire the underlying snapshot. It survives object eviction, Worker restart
   and code deployment when the corresponding storage and profile identity are preserved. Keep the
   Worker binding/class and Node cache directory stable. A stale card remains visibly labelled with each source's timestamp.

No success has ever been saved? The SVG still renders an honest unavailable
state; it cannot recover data it has never fetched. The selected storage and runtime must themselves remain available. This is upstream-failure tolerance,
not a promise of uninterrupted Cloudflare availability.

Refreshes are demand driven. This version creates no scheduled trigger. Local state lives in ignored `.wrangler/state` (Worker) or `.data` (Node);
keep the appropriate directory to retain the local cache.
SVG responses also have five-minute HTTP caching. GitHub's Camo image proxy adds
its own caching, so README updates are not guaranteed to appear immediately.

## Endpoints

| Endpoint | Result |
| --- | --- |
| `/` | Interactive preview, full language/activity/year tables and README generator |
| `/card.svg` | Combined profile card, top eight rows by default |
| `/api/stats` | Aggregate JSON and per-source freshness/error metadata |
| `/health` | HTTP runtime readiness only; not upstream health |

Card options:

```text
?range=all_time&theme=dark&view=overview&limit=8&sort=time
```

- `range`: `all_time`, `last_7_days`, `last_30_days`
- `theme`: `dark`, `light`, `transparent` (adapts to preferred color scheme)
- `view`: `overview`, `languages`, `activity`
- `limit`: 1–100 rows; the remaining-row count stays visible
- `sort`: `time`, `code`, `name`

The preview generates a full light/dark `<picture>` snippet. A minimal example
for a future public Worker URL is:

```markdown
![Coding time and GitHub languages](https://YOUR-WORKER.workers.dev/card.svg?theme=transparent)

<details>
<summary>Language detail</summary>

![Language detail](https://YOUR-WORKER.workers.dev/card.svg?view=languages&limit=20&theme=transparent)

</details>

<details>
<summary>GitHub activity</summary>

![Public GitHub activity](https://YOUR-WORKER.workers.dev/card.svg?view=activity&theme=transparent)

</details>
```

Expand/collapse belongs to GitHub's native Markdown HTML; SVG images do not run
the preview's JavaScript. Localhost URLs cannot be embedded for other GitHub
visitors. The local preview does not edit your profile README.

## Validation

```sh
npm run check
npm test
npm run test:runtime
npm run build:node
npm run build
# With either preview already running:
npm run test:preview
```

- Unit tests cover pagination, private-data rejection, malformed/partial data,
  percentage denominators, aliases, XML escaping, concurrency and cache recovery.
- The runtime test bundles the real application into Cloudflare workerd, uses
  isolated temporary SQLite storage and mocked upstreams, injects HTTP503 after
  warming the cache, verifies a usable stale SVG, then recreates the runtime and
  verifies the data and cooldown survive. Its test-only storage-aging class is
  not exported by the production entry point.
- The browser test uses an isolated local Chrome Beta when installed, or
  Playwright's Chromium. Override its executable with
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. It verifies the real preview's controls,
  full language table, Markdown copying, unavailable-range handling, SVG bounds
  and mobile overflow. Screenshots and receipts are ignored under `artifacts/`.
- Build validation uses `wrangler deploy --dry-run`; it does not publish.

The dependency lock is committed. The `undici` override selects the patched
7.30.1 release for local development tooling; `npm audit` is clean at preparation.
SVG/HTML template fragments may exceed120 columns so complete markup and its
escaping stay on one logical line; ordinary TypeScript uses four-space indent.

## Deploy to Cloudflare

Publishing this source repository does not deploy the service. To deploy:

1. Choose a Worker name/account and keep the existing Durable Object class and
   `v1` SQLite migration. `wrangler.jsonc` contains the binding configuration.
2. Configure `GITHUB_TOKEN` as a Cloudflare runtime secret using the dashboard
   Settings → Variables and Secrets, or `npx wrangler secret put GITHUB_TOKEN`.
   Add `WAKATIME_TOKEN` only if needed. Never put credentials in `vars`. Local
   `.dev.vars` does not upload those secrets.
3. Deploy with `npm run deploy`, or connect this repository in Cloudflare Workers
   Builds: root `/`, build command left blank, deploy command `npm run deploy`,
   production branch `main`. The checked-in `.nvmrc` selects the Node build
   version. Use runtime secrets, separately from build variables. The native
   Git integration handles pushes; a deployment GitHub Action is not required.
4. Open `/api/stats` to warm and verify both sources, then use the preview's
   generated Markdown with the real public URL.

## Primary references

- [WakaTime API and OAuth](https://wakatime.com/developers)
- [GitHub repository GraphQL fields](https://docs.github.com/en/graphql/reference/repos)
- [Cloudflare Durable Objects storage](https://developers.cloudflare.com/durable-objects/api/storage-api/)
- [Cloudflare request redirect behavior](https://developers.cloudflare.com/workers/runtime-apis/request/)
- [GitHub collapsed sections](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections)
