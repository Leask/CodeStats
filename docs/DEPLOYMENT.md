# Deploy your own CodeStats

[Back to CodeStats](../README.md) · [README embedding](EMBEDDING.md) · [Usage details](AI-USAGE.md)

One deployment combines **GitHub, WakaTime, Codex and OpenRouter** for its
configured profile and optional username-selected public profiles.
Node.js and Cloudflare Workers share collectors, rendering,
routes and cache policy. Enable the services you use; Codex and OpenRouter are
optional, and missing usage data is never replaced with a fabricated zero.
Public IDs use `github`, `wakatime` and `codex` parameters, not a generic
`username`. Any explicit ID selects isolated anonymous mode; omitted owner
accounts and credentials are not inherited, even when the ID matches the owner.

## Choose your source connections

| Source | Connection | Node.js | Cloudflare Workers |
| --- | --- | --- | --- |
| GitHub | Username; optional owner classic PAT/OAuth token for full data | Public REST or token-bound GraphQL | Public REST or token-bound GraphQL |
| WakaTime | Public username/range; optional owner OAuth fallback or token-only identity | Direct API collection | Direct API collection |
| Codex | Optional bare public ID; account login/sync required for usage | Read enabled local account aggregates | Receive enabled aggregate-only imports |
| OpenRouter | Management key | Direct account analytics | Direct account analytics |

GitHub has separate repository and personal-activity caches. These are two
datasets from **one** service, not extra sources. Each WakaTime range has its
own cache; the selected range does not change Codex or OpenRouter's reporting
window. Anthropic organization API usage is an additional advanced integration,
not one of the four primary services. See [usage setup](AI-USAGE.md).

## Credentials

### GitHub

For a keyless public card, set only `GITHUB_USERNAME` or use `?github=ID`.
This uses anonymous REST for profile, owned public repository metadata, stars,
forks and Search totals for authored PRs, merged PRs, issues and commits. It does
not enumerate per-repository language endpoints or individual commits. Language
bytes, calendar/review totals, private repositories and organization/collaborator
inventories are unavailable. Missing values remain unknown, not zero.

Metadata collection is bounded to ten pages of 100 repositories. Above that
limit, selected repository count, stars and forks are omitted explicitly.
Incomplete Search responses and transient errors retain saved data instead of
publishing partial totals. Anonymous calls share the outgoing IP's
[60 requests/hour limit](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
and [10 Search requests/minute limit](https://docs.github.com/en/rest/search/search#rate-limit).
The cache is important when one instance serves many public names.

For the best full card, configure the account name and an owner-bound token.
Create a [classic PAT](https://github.com/settings/tokens/new) belonging to the
account in `GITHUB_USERNAME`. For full public/private statistics, select:

- `repo`: repositories and activity visible to the token, including private work.
- `read:user`: account and activity access; the broader `user` scope covers it.
- `read:org`: organization membership; broader inherited organization scopes work.

An existing OAuth token with these scopes also works. CodeStats does not provide
an OAuth login flow. Fine-grained PATs are not a substitute for the current full-mode
scope checks. Organization SSO and token policies still apply.

The collector makes read requests, although the classic `repo` permission also
grants write access. `GITHUB_VISIBILITY=all` publishes aggregate counts that can
include private work, but not private repository names, IDs or code. The reduced
`public` mode omits extended personal activity and rank data.

### WakaTime

Set `WAKATIME_USERNAME` to a username or account UUID, without a URL, and publish
the desired statistics range. Public data is requested first for the exact
`all_time`, `last_7_days` or `last_30_days` range. A complete public response wins
even when an OAuth token is configured.

For the best unattended setup, also supply a server-side **OAuth access token**
as `WAKATIME_TOKEN` with `read_stats.languages` (or `read_stats`) and `email`.
The latter permits the documented `/users/current` owner check; its raw profile
and email payload is discarded, retaining only the resolved account identity.
Only when public data is unavailable,
recalculating or invalid does CodeStats verify that owner and retry the **same
range** with OAuth. A mismatched owner is rejected. Rate limits, network/5xx
errors and redirects do not cause authenticated retry. An editor heartbeat API
key is not interchangeable with the OAuth token.

Token-only setup is supported: leave `WAKATIME_USERNAME` empty and provide OAuth.
The owner is resolved before choosing a persistent cache identity. Username-only
public URL profiles never receive the deployment's token or this fallback.

Public and OAuth data are not intrinsically more or less complete. Compare the
same range, cutoff, timeout/preferences and Other-inclusive total; public profile
settings can affect what is visible. CodeStats neither picks the larger result
nor mixes periods or payloads. See the official [Stats and Users API](https://wakatime.com/developers).

[WakaTime's personal OAuth page](https://wakatime.com/oauth) provides a token
after login. CodeStats does not issue or exchange OAuth tokens. It does not
silently substitute another period when a range is unavailable or recalculating.
[WakaTime API reference](https://wakatime.com/developers).

### Codex

Codex auto-enables when `CODEX_USERNAME` or `CODEX_SYNC_TOKEN` is configured.
Set `CODEX_USERNAME` to a bare ID such as `your-id`; CodeStats builds
`https://chatgpt.com/u/your-id` itself. A public ID/link is not an authorization
grant. Anonymous profile pages require sign-in for usage, so `?codex=ID` displays
its canonical link with unavailable metrics and never uses owner CLI/imports.
An explicit `CODEX_USAGE_ENABLED=false` disables the integration even with an
ID or sync secret. For local CLI collection without either setting, opt in with
`CODEX_USAGE_ENABLED=true`. Otherwise, omit this override. When upgrading an old
`.env` sample that sets the flag to `false`, remove that line to use auto-enabling.

- **Node:** run under a user with the Codex CLI installed on `PATH` and an
  existing supported Codex-service login. CodeStats starts a bounded child
  `codex app-server --stdio` and reads `account/usage/read`; it does not copy
  login credentials or inspect chat history. API-key-only or third-party-provider
  logins may not provide this account summary.
- **Worker:** the edge runtime cannot start your desktop CLI. Configure
  `CODEX_SYNC_TOKEN` as a runtime Secret; this also enables the integration. Generate a
  separate random secret of at least 32 characters, put the same secret in the
  local sync environment, and run the bridge from the signed-in computer:

  ```sh
  npm run sync:codex -- https://stats.example.com
  ```

  This builds the Node helper, reads the account summary locally and posts only
  validated numeric aggregates plus their observation time to
  `/api/usage/codex`. The destination must be an HTTPS origin; HTTP is accepted
  only for loopback development. No Codex login token is sent to the Worker.

The bridge is manual; CodeStats creates no timer or scheduler. Repeat the sync
when you want a new observation. Opening the card does not refresh an imported
Codex snapshot's age. The current implementation does not scrape a
`chatgpt.com/u/...` profile or use an OpenAI API billing key for these statistics.

### OpenRouter

Set `OPENROUTER_API_KEY` to an OpenRouter **Management key**. An ordinary inference
key can be valid for model calls while lacking access to account token analytics.
A Management key has administrative capabilities; CodeStats uses it only for a
read-only analytics query and never puts it in card output.

The collector makes one unfiltered daily aggregate query for tokens and request
counts across the account. Its default interval is the **last 367 completed UTC
days**, not lifetime. Today's partial UTC day is excluded. Optionally set the
nonsecret `OPENROUTER_USAGE_SINCE=YYYY-MM-DD` to a shorter interval; this collector
rejects intervals longer than 367 days rather than silently truncating them.
The card's Tokens/day and Tokens/week are interval averages, including inactive
days. Total prompts counts API requests. See [metric definitions](AI-USAGE.md).

## Node.js

Use Node.js **26 or newer**, npm and Git. Local Node installations can follow
the package manager; `.nvmrc` records the build baseline.

```sh
git clone https://github.com/Leask/CodeStats.git
cd CodeStats
npm ci
cp .env.example .env
# Edit usernames and credentials; enable Codex/OpenRouter only if needed.
chmod 600 .env
npm start
```

Open `http://127.0.0.1:8791/build`. The root URL and `/card.svg` serve the
transparent SVG. A cold statistics request can take tens of seconds; later
requests reuse saved data while each source follows its own freshness state.

For public hosting:

1. Use your host's process manager to run the service from the project directory.
2. Put a public HTTPS reverse proxy in front of `127.0.0.1:8791`, serving at the
   origin's root path. GitHub must fetch the image without a login or VPN.
3. Preserve `.data/` across restarts/releases. In containers, mount a persistent
   volume; set `HOST=0.0.0.0` only when the listener must cross that network.
4. If Codex is enabled, the service user must have the CLI and supported login.
   Keeping only a copied `.env` on an unrelated host does not supply that login.
5. Set the deployed public HTTPS origin in the builder, then copy its Markdown.

`npm start` builds and runs Node. To build separately:

```sh
npm run build:node
node --env-file-if-exists=.env dist/node.mjs
```

Existing process environment values take precedence. `npm start` loads
`.dev.vars` first, then `.env`; `.env` wins between those files. A new Node
installation needs only `.env`. Its persistent SQLite cache requires no external
database or Cloudflare account. This Node dotenv behavior differs from Wrangler:
when Wrangler finds `.dev.vars`, it does not also load `.env`.

## Cloudflare Workers

Use the locked Wrangler dependency, Node.js 26+ tooling and a Cloudflare account.
The included SQLite Durable Object keeps snapshots inside Cloudflare; no separate
KV or D1 database is needed. SQLite Durable Objects are available on Free and
Paid plans, with plan-specific limits. Choose capacity for the profile's refresh
workload; local validation is not a production-capacity test.
[Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

### Configure and preview

In `wrangler.jsonc`, replace the Worker `name`, `vars.GITHUB_USERNAME` and
`vars.WAKATIME_USERNAME`. For Codex imports, configure the `CODEX_SYNC_TOKEN`
Secret; the optional `CODEX_USERNAME` belongs in `vars`. No separate enable
flag is required. `DEFAULT_RANGE` may be omitted and defaults to `all_time`.
Set nonsecret options such as `OPENROUTER_USAGE_SINCE` in `vars` only when you
want to override the defaults.

Keep the `SNAPSHOTS` binding, class name and existing `v1/new_sqlite_classes`
migration. Do not remove or retag a deployed migration. Keep `keep_names: false`
and `minify: false`: the builder serializes shared helpers and must not acquire
an undefined browser-side `__name` helper.

```sh
cp .dev.vars.example .dev.vars
# Fill GITHUB_TOKEN and any enabled-service secrets.
chmod 600 .dev.vars
npm run dev:worker
```

Use `.dev.vars` for **secrets only**: GitHub token, optional WakaTime OAuth token,
OpenRouter Management key, and optional Codex sync secret. Usernames, enable
flags and reporting dates belong in Wrangler `vars`, not this upload file.
Neither sample contains real credentials.

Local Worker state is in `.wrangler/state`, separate from Node's `.data/`.
Neither cache is uploaded to production. Run only one local service on port
8791 at a time. Open `/build`; to see Worker Codex data, import an observation
with the local bridge and a matching sync secret.

### First deployment

```sh
npx wrangler login
npm run deploy -- --secrets-file .dev.vars
```

This explicitly uploads the secrets-only dotenv file as runtime secrets and
applies the configured Durable Object migration. Ordinary `npm run deploy` does
not upload local `.dev.vars` automatically. Secrets omitted from an upload are
preserved from the previous Worker version.
[Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

To update one credential through a secure prompt or the dashboard:

```sh
npx wrangler secret put GITHUB_TOKEN
# Only for the services you enabled:
npx wrangler secret put WAKATIME_TOKEN
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put CODEX_SYNC_TOKEN
```

These commands update the deployed Worker, not just local preview. Never put
credential values in command arguments. Use the public Workers URL printed at
deploy time or your custom domain in the README generator. Keep the Worker
identity, profile usernames, binding and migration history stable to retain the
cache. A configured sync secret automatically enables Codex imports unless
`CODEX_USAGE_ENABLED=false` overrides it. After deployment, run the local Codex
sync against the public origin.

### Workers Builds dashboard

Optional Git integration can use the repository root, an empty **Build command**
and **Deploy command** `npx wrangler deploy`. Wrangler bundles TypeScript itself.
Use the Node version in `.nvmrc`; leave the repository's bundle settings intact.

Add enabled-service credentials to the deployed Worker's **Settings → Variables
and Secrets**, choosing **Secret**. A secret under **Build settings** does not by
itself create the runtime binding. Save/deploy the runtime changes, then inspect
`/build` and `/api/stats`. Put public options in `wrangler.jsonc`.

`keep_vars: true` preserves dashboard Variables on later Wrangler deployments.
Variables and Secrets are both read through `env`, but Secrets hide credential
values. After a previously missing GitHub token is added, the next request
retries that configuration error; ordinary failures keep their normal cooldown.
No Cron Trigger or GitHub Actions sync workflow is created automatically.

## Optional background refresh

Requests collect public username profiles on demand. They are never added to a
background queue, and an optional configured-profile refresh cannot access their
cache namespaces. Existing last-good behavior applies to every refresh.

On **Node**, set `AUTO_REFRESH_SECONDS=21600` to refresh configured sources for
`DEFAULT_RANGE` while the service process runs. The default `0` disables it;
enabled intervals are at least 60 seconds. This creates no operating-system
daemon or external timer, and it stops when the process closes. Each interval
requests a refresh even if the previous observation is still fresh, while retry
cooldowns remain respected. Choose an interval that fits upstream limits;
`FRESH_SECONDS` continues to control normal visitor requests.
Codex imports retain their original observation time.

On **Workers**, the scheduled handler refreshes only the configured profile and
`DEFAULT_RANGE`. Opt in by adding this top-level block to `wrangler.jsonc` and
deploying it yourself:

```jsonc
{
    // Merge into the existing configuration; preserve its vars and bindings.
    "triggers": {
        "crons": ["0 */6 * * *"]
    }
}
```

That expression runs every six hours in UTC. Keep the existing binding and
migration. No trigger is shipped or deployed automatically. For an existing
trigger, set `"crons": []` and deploy to disable it; merely removing the key does
not disable a previously installed trigger.
[Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/),
[Wrangler trigger configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#triggers).

A scheduled refresh cannot start a desktop CLI on Workers or make an old Codex
import fresh. Import a newer observation through the separate authenticated bridge.
Scheduled calls request fresh collection but still honor retry/rate-limit waits.

## Settings

Replace sample account IDs before deployment. Options apply to both runtimes
unless a row says otherwise.

| Setting | Default / required value | Purpose |
| --- | --- | --- |
| `GITHUB_USERNAME` | Empty on Node unless configured | Public account name; token mode must match the owner |
| `GITHUB_TOKEN` | Optional | Owner-bound classic PAT/OAuth for full GraphQL/private coverage |
| `GITHUB_VISIBILITY` | `all` | Public/private aggregates; `public` is reduced mode |
| `GITHUB_REPOSITORY_AFFILIATIONS` | `OWNER,COLLABORATOR,ORGANIZATION_MEMBER` | Repository inventory filter |
| `GITHUB_INCLUDE_FORKS` | `true` | Include fork bytes and owned forks' stars |
| `GITHUB_INCLUDE_OWN_CONTRIBUTIONS` | `true` | Include owned repos in contributed-repository counts |
| `WAKATIME_USERNAME` | Empty unless configured | Public username/UUID; token-only resolves its owner |
| `WAKATIME_TOKEN` | Optional | Same-owner OAuth fallback; scopes `email` plus `read_stats.languages`/`read_stats` |
| `DEFAULT_RANGE` | Optional; `all_time` | Initial WakaTime range only; may be omitted on either runtime |
| `CODEX_USAGE_ENABLED` | Optional override | Omit to auto-enable with a Codex ID/sync secret; `false` disables it, `true` enables local CLI collection without an ID/secret |
| `CODEX_USERNAME` | Optional bare ID | Enables the configured integration and provides its canonical profile link; does not grant account access |
| `CODEX_SYNC_TOKEN` | Optional independent secret, at least 32 characters | Auto-enable and authorize `/api/usage/codex` imports; not a Codex login token |
| `OPENROUTER_API_KEY` | Optional Management key | Enable account analytics |
| `OPENROUTER_USAGE_SINCE` | Last 367 completed UTC days | Optional shorter `YYYY-MM-DD` start |
| `FRESH_SECONDS` | `21600` | Six-hour freshness interval; minimum 60 seconds |
| `RETRY_SECONDS` | `900` | Fifteen-minute retry cooldown; minimum 60 seconds |
| `AUTO_REFRESH_SECONDS` | `0` or `off` | Node-only configured-profile refresh; integer 60–2147483 seconds when enabled |
| `HOST` | `127.0.0.1` | Node listener only |
| `PORT` | `8791` | Node port only |
| `CODESTATS_DATA_DIR` | `.data` | Persistent Node cache directory only |
| `ANTHROPIC_ADMIN_KEY` | Optional advanced integration | Organization API usage; not a Claude Pro/Max subscription |
| `ANTHROPIC_USAGE_SINCE` | Last 30 completed UTC days | Optional organization-usage UTC start date |

## Cache and verification

Four services retain independent observations. GitHub repository and activity
data are cached separately, WakaTime has one entry per range, and each enabled
usage provider has its own reporting window and last-success time.

- **Cold:** wait for a first bounded fetch. Unavailable fields show a dash.
- **Fresh:** reuse the saved observation within the configured freshness interval.
- **Stale:** return the last good values while a request-triggered refresh runs.
- **Failed refresh:** keep old values and their original success time. Retry after
  the cooldown, or later if GitHub specifies a longer rate-limit wait.
- **Imported Codex:** only a newer authenticated sync updates its observation;
  viewing the card cannot make it fresh again.

Successful snapshots have no deletion TTL. Preserve storage on upgrades. Scope
changes may need a new cache entry; collector-version changes preserve supported
prior snapshots while new data is fetched. Configured-profile background refresh
is opt-in as described above; public URL names stay on demand.

Configured/private caches and public-query caches are isolated even for identical
names. Provider/range entries retain independent errors, cooldowns and last-good
values; changing `view` or `sources` is not permission to merge them. A public
service can receive many distinct names: use normal hosting rate/access controls
and persistent-storage monitoring to bound traffic and growth. The collector's
request/time/body limits do not impose a global limit on the number of visitors.

Token-only WakaTime resolution changes only its own WakaTime cache namespace.
It does not move GitHub/OpenRouter observations or Codex aggregate imports into a
different store. Unresolved OAuth identities cannot read another owner's WakaTime
cache, and failures leave the other configured sources intact. Node bounds its
in-memory public-profile cache; evicting an idle instance does not delete its
persisted snapshots. Durable public-profile storage has no automatic deletion TTL.

SVG responses also have five-minute HTTP caching; GitHub's image proxy can add
its own delay. The footer and builder show provider refresh ages. Use the builder's
GitHub details and `/api/stats` to inspect the separately cached repository and
activity observations. Fresh means a recent successful observation, not complete
lifetime coverage or synchronized reporting periods across all four providers.

After deployment:

1. Open `/build`, review each configured source and its scope/last-success time.
2. Inspect `/api/stats`; verify optional usage providers are present only when enabled.
3. Confirm `/` and `/card.svg` return the public transparent SVG.
4. On Workers with Codex enabled, run one authenticated sync and check its saved age.
5. Copy the builder's linked Markdown and verify the actual rendered README.

`/health` establishes HTTP runtime readiness, not successful authentication to all
four providers. Its configuration booleans are `githubTokenConfigured`,
`wakatimeTokenConfigured`, `codexUsageEnabled` and `openrouterTokenConfigured`.
They describe credential presence or enable intent, not a verified Codex login,
successful sync or upstream access. They contain no tokens or hashes; the source
snapshots are the collection evidence.
Last-good data still requires the application and its storage to be reachable.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Another profile appears | Replace sample usernames; Worker IDs belong in `wrangler.jsonc` |
| Codex/OpenRouter absent from the SVG | Their builder cards say Not enabled until configured; only enabled usage services become SVG rows |
| GitHub token missing after successful deploy | Add a runtime Secret under the Worker's Settings, not only Build settings |
| Public GitHub lacks bytes, rank or calendar totals | Expected anonymous REST scope; use owner name+token in configured mode for full data |
| GitHub scope/identity error | Token owner, classic/OAuth scopes, SSO authorization and organization policies |
| WakaTime unavailable or calculating | Exact published range, owner-match and OAuth `email` plus read-stats permissions; no period substitution |
| Public ID has no Codex/OpenRouter usage | Expected: Codex usage requires account access; OpenRouter has no anonymous username usage API |
| Codex unavailable on Node | CLI on the service user's `PATH`, supported account login and usage endpoint |
| Codex unavailable/stale on Worker | Enable flag, matching sync secret, one successful local sync, then original observation age |
| Codex import rejected | Newer observation, HTTPS origin, matching separate secret of at least 32 characters |
| OpenRouter inference works but usage fails | Use a Management key; ordinary inference credentials are insufficient |
| OpenRouter differs from website lifetime total | The card uses its labeled completed-day analytics interval, not the private profile page |
| README image broken | Public HTTPS endpoint, no authentication gate, correct domain, no key in URL |
| Builder says `__name is not defined` | Restore `keep_names: false` / `minify: false`, rebuild and test the generated Worker |
| Old values remain | Original success time, source errors, retry cooldown and image caching |
| Node listener/cache fails | Port, `HOST`/`PORT`, service-owned private cache directory and persistent volume |
| Worker limit/storage error | Runtime logs, binding/migration and current account limits; retain the cache |
