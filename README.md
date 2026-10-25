# CodeStats

One Cloudflare Worker that combines WakaTime coding time, GitHub language bytes,
and public GitHub activity into a README-ready SVG. The browser preview includes
an expandable language table and generates native GitHub `<details>` sections.

## Local preview

```sh
npm ci
cp .env.example .dev.vars
# Set GITHUB_TOKEN in .dev.vars. Keep this file private.
npm run dev
```

Open **http://127.0.0.1:8791**. Node.js 22 or later is required.
The first request fetches real upstream data. There are no demo numbers on the
preview page. A GitHub token with access to public GraphQL data is required.
Private repository permissions are not needed. Even if a token can see private
repositories, the collector explicitly requests and checks public repositories.

For this local review, `.dev.vars` has already been configured from the existing
GitHub CLI login with file mode0600. Its value is neither printed nor committed.
Only `.env.example` is provided in Git. Do not copy `.dev.vars` into a repository,
README, query string, frontend bundle, or deployment command argument.

Configuration in `wrangler.jsonc`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `GITHUB_USERNAME` | `Leask` | Fixed public GitHub profile |
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

**GitHub:** language bytes across every owned, public, non-fork repository,
including archived repositories. Each repository's language pagination is read
in full. Percentages use the sum of all those bytes, before selecting display
rows. This is a current repository snapshot, not lines of code, authorship, or a
measurement of time spent working. Public repository count includes forks;
analyzed repository count and stars/forks exclude them.

The two denominators and periods are different. They remain separate columns;
there is no blended score. Explicit aliases, such as Bash→Shell and Vue.js→Vue,
allow a language to appear on one row. GitHub-only languages stay in the full
table with zero WakaTime time when WakaTime data is available.

Activity includes public lifetime authored PRs, merged PRs and issues, plus
followers, stars and repository forks. This version does not claim complete
all-time commits, contribution history, review counts or private activity.

Leask currently publishes WakaTime **all-time** statistics. Seven-/thirty-day
queries are not publicly available and are shown as unavailable, without
substituting all-time data. For other/private ranges, configure an optional
server-side `WAKATIME_TOKEN` OAuth token with `read_stats.languages`. Heartbeat
API keys are not used for read access. The API's `rangeLabel`, `includesToday`
and any supplied start/end values are preserved; missing dates are not invented.

## Persistent cache and failure behavior

One SQLite-backed Durable Object coordinates the configured profile globally.
Its storage holds separate last-good records for GitHub and each WakaTime range.

1. First visit without saved data waits for an initial bounded fetch.
2. Within six hours, all views reuse the saved data without upstream requests.
3. After that interval, the existing card is returned immediately while the
   corresponding provider refreshes in the background.
4. A timeout, rate limit, 3xx, HTTP error, GraphQL error, incomplete pagination,
   pending WakaTime computation, or malformed statistics retain the old record
   and its original success timestamp. Failed requests never become zero stats.
5. A persisted cooldown prevents repeated refresh attempts during an outage.
   Concurrent refreshes for one source are coalesced.
6. Saved successful data has **no deletion TTL**. Its refresh deadline does not
   expire the underlying snapshot. It survives object eviction, Worker restart
   and code deployment as long as the binding, class and profile identity stay
   the same. A stale card remains visibly labelled with each source's timestamp.

No success has ever been saved? The SVG still renders an honest unavailable
state; it cannot recover data it has never fetched. Durable storage and the
Worker must themselves remain available. This is upstream-failure tolerance,
not a promise of uninterrupted Cloudflare availability.

Refreshes are demand driven. This version creates no scheduled trigger. Local
state lives in ignored `.wrangler/state`; keep it to retain the local cache.
SVG responses also have five-minute HTTP caching. GitHub's Camo image proxy adds
its own caching, so README updates are not guaranteed to appear immediately.

## Endpoints

| Endpoint | Result |
| --- | --- |
| `/` | Interactive preview, all language rows and README generator |
| `/card.svg` | Combined profile card, top eight rows by default |
| `/api/stats` | Aggregate JSON and per-source freshness/error metadata |
| `/health` | Worker runtime readiness only; not upstream health |

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
npm run build
# With npm run dev already running:
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

## Deployment after review

Nothing has been published or provisioned in this review stage. When approved:

1. Choose a Worker name/account and keep the existing Durable Object class and
   `v1` SQLite migration. `wrangler.jsonc` contains the binding configuration.
2. Configure `GITHUB_TOKEN` as a Cloudflare secret. Add `WAKATIME_TOKEN` only if
   needed. Local `.dev.vars` does not upload those secrets.
3. Deploy with Wrangler or Cloudflare's Git integration. No GitHub Actions
   credential or extra backend is required for the latter path.
4. Open `/api/stats` to warm and verify both sources, then use the preview's
   generated Markdown with the real public URL.

## Primary references

- [WakaTime API and OAuth](https://wakatime.com/developers)
- [GitHub repository GraphQL fields](https://docs.github.com/en/graphql/reference/repos)
- [Cloudflare Durable Objects storage](https://developers.cloudflare.com/durable-objects/api/storage-api/)
- [Cloudflare request redirect behavior](https://developers.cloudflare.com/workers/runtime-apis/request/)
- [GitHub collapsed sections](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections)
