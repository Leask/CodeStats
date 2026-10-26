# Deploy your own CodeStats

[Back to CodeStats](../README.md) · [Add the card to GitHub](EMBEDDING.md)

One deployment serves one configured GitHub/WakaTime profile. Visitors cannot
switch accounts with a `username` query parameter. Deploy a separate instance
for another profile. Both runtimes use the same collectors, SVG and cache policy.

## Credentials

### GitHub

Create a [classic PAT](https://github.com/settings/tokens/new) for the account
named by `GITHUB_USERNAME`. For full public/private statistics, select:

- `repo`: repositories and activity visible to the token, including private work.
- `read:user`: account and activity access; the broader `user` scope also covers it.
- `read:org`: organization membership; inherited broader organization scopes work.

Use the same account for the token and `GITHUB_USERNAME`. An existing OAuth
access token with these scopes also works; CodeStats does not implement an OAuth
login flow. Fine-grained PATs are not supported as a substitute for the current
full-mode scope checks. Authorize the token for applicable organization SSO and
respect organization token policies. A token cannot access more than its owner.

The collector performs read operations, although a classic PAT's `repo` scope
also grants write capabilities. Store it only on your server or as a Worker
secret. `GITHUB_VISIBILITY=all` intentionally publishes aggregate counts that
include private work; private repository names, IDs and code are not returned.
`public` restricts repository/language data and leaves extended activity/rank
unavailable; it is not the recommended full-profile mode.

### WakaTime

Set `WAKATIME_USERNAME` to your WakaTime ID. For the default `all_time` range,
make that statistics range public in your WakaTime profile's sharing settings.
Public statistics need no token. For a private or different authorized range,
provide a WakaTime **OAuth access token** with appropriate read-stats access
(`read_stats.languages` for language statistics).

`WAKATIME_TOKEN` is optional and is sent as a Bearer token. The API key used by
editor heartbeat plugins is not interchangeable with this OAuth access token.
For your own account, [WakaTime's personal OAuth page](https://wakatime.com/oauth)
provides a token after login; no published OAuth application is needed. Copy that
token into your private configuration, not a README or image URL. CodeStats does
not create or exchange OAuth tokens for you. If a range is not
available, publish/authorize it or choose an available range; the service does
not silently replace it with a different period. All-time can remain pending
while WakaTime recalculates it. [WakaTime API reference](https://wakatime.com/developers).

## Node.js

Requires Node.js26+ and npm. `.nvmrc` records the build baseline; ordinary local
Node installations can follow their package manager.

```sh
git clone https://github.com/Leask/CodeStats.git
cd CodeStats
npm ci
cp .env.example .env
# Edit .env: usernames, GitHub token, optional WakaTime OAuth token.
chmod 600 .env
npm start
```

Visit `http://127.0.0.1:8791/build` for the HTML card builder. The root URL and
`/card.svg` serve the transparent SVG directly. The first statistics request can
take tens of seconds; subsequent fresh-cache requests reuse the saved datasets.

For public hosting:

1. Run the service from the project directory using your host's process manager.
2. Put a public HTTPS reverse proxy in front of the default `127.0.0.1:8791`
   listener, forwarding the service at the site's root path.
3. Preserve the `.data/` directory through restarts and releases. In a container,
   use a persistent volume and `HOST=0.0.0.0` if the listener must cross its network.
4. Use the public HTTPS origin in the README generator. GitHub must be able to
   fetch `/` or `/card.svg` without a login, VPN or private-network connection.

`npm start` builds and starts Node. If your release process builds separately:

```sh
npm run build:node
node --env-file-if-exists=.env dist/node.mjs
```

Environment variables already set by the process override file values. `npm start`
loads local `.dev.vars` first and `.env` second; `.env` wins between those files.
Using only `.env` is sufficient for a fresh Node installation. Node uses its own
private SQLite store; it does not require Cloudflare or a database server.

## Cloudflare Workers

Requires Node.js26+ for local tooling, npm, a Cloudflare account and Wrangler
(the locked project dependency). SQLite-backed Durable Objects are available
on Workers Free, subject to the platform's CPU, request, subrequest and storage
limits; large profiles can require a higher plan. No production plan was tested
as part of the local validation; choose capacity for your refresh workload.
[Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

### Configure and preview

Clone/install as above. In `wrangler.jsonc`, change:

- `name`: your Worker name, for example `my-codestats`.
- `vars.GITHUB_USERNAME`: your GitHub ID.
- `vars.WAKATIME_USERNAME`: your WakaTime ID.
- Other nonsecret options only if you want different scope, range or cache timing.

Keep `durable_objects.bindings` and the existing `v1/new_sqlite_classes`
migration. Do not remove or retag an already deployed migration.
Keep `keep_names: false` and `minify: false`: the builder serializes shared helper
functions, and name-preservation instrumentation must not inject an undefined
`__name` into browser code.

```sh
cp .dev.vars.example .dev.vars
# Fill GITHUB_TOKEN. Uncomment WAKATIME_TOKEN only if needed.
chmod 600 .dev.vars
npm run dev:worker
```

Local Worker state is stored under `.wrangler/state`. It is separate from Node's
`.data/` cache and is not uploaded to production. Choose one local runtime for
port8791 at a time. Open `/build` for the interactive preview.

### First deployment

Keep `.dev.vars` **secrets-only**: `GITHUB_TOKEN` and, optionally, `WAKATIME_TOKEN`.
Put usernames and other public settings in `wrangler.jsonc` instead.

```sh
npx wrangler login
npm run deploy -- --secrets-file .dev.vars
```

Wrangler's `--secrets-file` accepts this dotenv file and creates secret bindings
without putting token values in command arguments. Its deployment applies the
configured migration and binding automatically; no manual namespace, KV or D1
creation is needed. Use the public `https://<worker>.<subdomain>.workers.dev` URL
printed by Wrangler, or configure a custom domain in Cloudflare.

Local `.dev.vars` does not become production configuration unless explicitly
provided with `--secrets-file`. Once production secrets exist, ordinary
`npm run deploy` can update the code while preserving existing secrets. To rotate
a single secret later, use a prompt or the Cloudflare dashboard:

```sh
npx wrangler secret put GITHUB_TOKEN
# Only when using private/authorized WakaTime statistics:
npx wrangler secret put WAKATIME_TOKEN
```

These commands change the deployed Worker; they are not local-only settings.
Keep the Worker name, Durable Object class/binding and migration history stable
to preserve the cache. No cron trigger or GitHub Actions workflow is required.
[Cloudflare secrets](https://developers.cloudflare.com/workers/configuration/secrets/),
[Durable Object migrations](https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/).

### Workers Builds dashboard

Connecting this GitHub repository to Workers Builds is optional. Use the
repository root, leave the optional **Build command** blank, and set the
**Deploy command** to `npx wrangler deploy`. Wrangler bundles the TypeScript
entry point itself. Use the Node version recorded in `.nvmrc` for build tooling;
do not add a separate runtime or CI workflow for this setup.

In the deployed Worker's **Settings → Variables and Secrets**, add
`GITHUB_TOKEN` with type **Secret**. Add `WAKATIME_TOKEN` there only when needed.
These must be runtime bindings: a similarly named secret in **Build settings**
is available to the build process and does not by itself configure the running
Worker. A successful build/deployment can therefore still show GitHub as
unavailable when the runtime `GITHUB_TOKEN` is missing. Save/deploy the runtime
secret change, then check `/build` and `/api/stats`.

Keep usernames and public options in `wrangler.jsonc`; never put real tokens in
that file or the deploy command. Leave the repository's bundle settings intact;
do not add `--minify` to the dashboard command.

## Settings

Examples deliberately use username/token placeholders. Set both account IDs
before starting or deploying. All options below apply to both runtimes unless noted.

| Setting | Default / required value | Purpose |
| --- | --- | --- |
| `GITHUB_USERNAME` | Your GitHub ID | Token owner and displayed account |
| `WAKATIME_USERNAME` | Your WakaTime ID | Published/authorized time statistics |
| `GITHUB_TOKEN` | Required for GitHub | Server-side classic PAT or OAuth token |
| `WAKATIME_TOKEN` | Optional | Read-stats OAuth token for private/other ranges |
| `GITHUB_VISIBILITY` | `all` | Token-visible public/private data; `public` is a reduced mode |
| `GITHUB_REPOSITORY_AFFILIATIONS` | `OWNER,COLLABORATOR,ORGANIZATION_MEMBER` | Native repository inventory filter |
| `GITHUB_INCLUDE_FORKS` | `true` | Include fork bytes and owned forks' stars |
| `GITHUB_INCLUDE_OWN_CONTRIBUTIONS` | `true` | Include owned repos in contributed-repository counts |
| `DEFAULT_RANGE` | `all_time` | Initial WakaTime range |
| `FRESH_SECONDS` | `21600` | Six-hour freshness interval |
| `RETRY_SECONDS` | `900` | Fifteen-minute minimum retry cooldown |
| `HOST` | `127.0.0.1` | Node listener only |
| `PORT` | `8791` | Node port only |
| `CODESTATS_DATA_DIR` | `.data` | Persistent Node cache directory only |

## Cache and verification

Two upstream services produce three independent datasets: GitHub repositories,
GitHub personal activity, and WakaTime statistics for the requested range.

- Cold cache: wait for the first bounded fetch. Unavailable data is shown as a dash.
- Fresh cache: saved statistics are reused for six hours by default.
- Due cache: return the saved snapshot while refreshing in the background.
- Failed refresh: retain old data and its original success time; wait at least
  fifteen minutes before retrying, or longer when GitHub requests a rate-limit delay.
- Successful snapshots have no deletion TTL. Preserve storage and profile identity
  when updating. Cache-schema/scope changes can require a new initial fetch.

Refreshes are request-driven. An idle deployment does no scheduled API polling.
SVG responses also have five-minute HTTP caching; GitHub's image proxy can delay
what you see in a README. The footer shows saved GitHub/WakaTime refresh ages;
source status and exact times remain in `/api/stats`, accessible SVG metadata and
the `/build` page. Saved data still needs the host and persistent storage to work.

After deployment, open `/build`, check both services' dataset statuses, and
inspect `/api/stats`. Check that `/` and `/card.svg` render the transparent card,
then copy the builder's default linked Markdown. The snippet is available even
when statistics fail to load. `/health` checks HTTP runtime readiness only; a200
response there does not verify upstream access.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Another person's profile appears | Replace both sample usernames; Worker account IDs belong in `wrangler.jsonc` |
| GitHub says to configure `GITHUB_TOKEN` after a successful deploy | Add it as a Secret under the deployed Worker's Settings → Variables and Secrets; build-only secrets are insufficient |
| GitHub scope/identity error | Token belongs to `GITHUB_USERNAME` and declares the required classic/OAuth scopes |
| Organization data is missing | Token visibility, SSO authorization and organization policy; repo access alone may be insufficient |
| WakaTime unavailable or calculating | Range is public/authorized and computation is complete; use OAuth rather than a heartbeat key |
| README image is broken | Public HTTPS `/` or `/card.svg`, no access login, correct domain and no token in URL |
| Builder reports `__name is not defined` | Use the repository's `keep_names: false` and `minify: false` bundle settings, redeploy, and check the actual `/build` page |
| Old numbers remain | Check original success times and source errors; last-good fallback and GitHub image caching are intentional |
| Node cannot listen | Port in use, invalid `HOST`/`PORT`, or cache directory ownership/mode |
| Node cache permissions fail | Directory is owned by the service user and private0700; do not recursively change unrelated directories |
| Free Worker hits a limit | Inspect platform error/logs and account limits; retain cached data and select suitable capacity |
