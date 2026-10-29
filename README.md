# 📊 CodeStats

Your **GitHub, WakaTime, Codex, OpenRouter and Anthropic API** activity in one profile card.
Run it on **Node.js** or **Cloudflare Workers**, then paste one Markdown snippet
into your GitHub README.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FLeask%2FCodeStats)

[![CodeStats](https://codestats.leask.workers.dev/)](https://github.com/Leask/CodeStats)

CodeStats collects its own statistics and keeps the last successful snapshot
for each source. It does not depend on another statistics-card service.
One deployment can serve a configured profile and public profiles selected by
username. Tokens stay on the server; the builder accepts names and IDs only.

## Five sources, one card

| Source | What the card shows | Collection and reporting scope |
| --- | --- | --- |
| **GitHub** | Profile, repositories, commits, PRs, issues, followers and stars; full mode adds contributions and language bytes | Username-only public REST mode or owner-bound token mode; current repository bytes are not personally authored lines |
| **WakaTime** | Coding hours and language time | Named public statistics first; optional owner-verified OAuth fallback for the same range |
| **Codex** | Total tokens, peak tokens, longest task, longest streak and current streak | Configured local account/aggregate sync; a public ID alone provides a profile link, not anonymous usage |
| **OpenRouter** | Total tokens, tokens/day, tokens/week, total prompts and longest streak | One account-wide analytics query for the last 367 completed UTC days by default |
| **Anthropic API** | Total Claude API tokens across input, output and cache usage | Organization usage API; last 30 completed UTC days by default, not Claude Pro/Max subscription activity |

GitHub and WakaTime form the language comparison. Codex, OpenRouter and Anthropic API add
independent usage rows below it when configured. You can start with GitHub and
WakaTime, then add any usage source; unconfigured usage rows stay hidden.
Totals from different providers are never added together.

The card includes a GitHub avatar with a rank border, eight overview metrics,
nine grouped languages plus Others, per-language repository counts, and separate
GitHub/WakaTime percentage scales. Light, dark and transparent styles work with
GitHub README images. `/build` provides the preview, five provider status cards,
language/activity/usage details and Markdown generator. Disabled usage sources
remain visible there as **Not enabled**, with a setup link.

All five integrations are built in. No provider plugin or separate installation
is needed; configure only the sources you want to display.

## Deploy to Cloudflare

Use the **Deploy to Cloudflare** button above to deploy without installing a
local toolchain:

1. Sign in to Cloudflare and connect your GitHub account. Choose names for your
   new repository and Worker.
2. Replace the template's GitHub and WakaTime usernames with **your own IDs**.
   Fill only the provider Secrets you want to use; unused sources need no key.
   You can also add credentials later in the Worker's **Settings → Variables
   and Secrets**, choosing **Secret**.
3. Keep the detected **Deploy command** `npm run deploy`. Cloudflare provisions
   the SQLite Durable Object cache from the existing binding and migration.
4. Open the deployed Worker's `/build`, verify source status, and copy the
   generated Markdown into your GitHub README.

The same deployment command explicitly forwards supported Build environment
settings into Worker runtime bindings; saving a Build variable alone is not
enough. Do not keep different copies of the same setting in Build and runtime:
a nonempty Build value is reapplied on deployment. See
[deployment settings and precedence](docs/DEPLOYMENT.md#build-and-runtime-settings).
Codex still needs the [local aggregate sync](docs/AI-USAGE.md#cloudflare-worker)
after deployment; the button cannot read your local Codex login.

The local Node.js and Wrangler paths below remain available.

## 1. Get the project

Use Node.js **26 or newer**, npm and Git. A Cloudflare account is needed only
for the Worker deployment option.

```sh
git clone https://github.com/Leask/CodeStats.git
cd CodeStats
npm ci
```

You can also fork the repository first and clone your fork.

## 2. Configure your sources

Replace username placeholders with **your own GitHub and WakaTime IDs**. They
can be different. Credentials belong in ignored local files or platform secrets,
not in the builder, image URLs or README.

| Source | Required configuration | Setup |
| --- | --- | --- |
| GitHub | Username alone for public aggregates; add the account's `GITHUB_TOKEN` for full coverage | [Permissions](docs/DEPLOYMENT.md#credentials) |
| WakaTime | Published username/range; optional owner OAuth token for fallback or token-only setup | [Permissions](docs/DEPLOYMENT.md#credentials) |
| Codex | Local Codex CLI login; run the aggregate sync for a Worker. The sync key is managed automatically | [Codex setup](docs/AI-USAGE.md#codex) |
| OpenRouter | `OPENROUTER_API_KEY` containing a **Management key** | [OpenRouter setup](docs/AI-USAGE.md#openrouter) |
| Anthropic API | `ANTHROPIC_ADMIN_KEY` containing an **organization Admin key** | [Anthropic setup](docs/AI-USAGE.md#anthropic-api) |

For full GitHub visibility, use a classic personal access token for the displayed
account with `repo`, `read:user` and `read:org`, or an OAuth token declaring those
scopes. CodeStats performs read operations, but classic `repo` permission itself
is broader than read-only. The current full-mode collector checks the declared
scopes, so a fine-grained PAT is not a drop-in replacement. Organization SSO and
access policies still apply.

A published WakaTime range needs no token. For the best unattended setup, provide
the username and an OAuth token with `email` and `read_stats.languages` (or
`read_stats`): public data wins, with owner-verified same-range fallback.
Token-only setup resolves the token's owner before caching. Public and OAuth
statistics can use different account preferences; one is not inherently richer.
A heartbeat ingestion API key does not grant that read access.
An OpenRouter inference key likewise does not replace a Management key.
Codex uses the existing local login; do not copy its login tokens to the server.

## 3. Choose a runtime

### Node.js

```sh
cp .env.example .env
# Edit .env: set the names and optional credentials for your sources.
# Add a Codex ID, OpenRouter Management key or Anthropic Admin key when wanted.
chmod 600 .env
npm start
```

Open [the card builder](http://127.0.0.1:8791/build). The root URL serves the
transparent SVG directly. Node uses a local SQLite cache under `.data/`; no
external database is required. Preserve that directory when restarting or
redeploying, and use an HTTPS reverse proxy for a public service.
See [Node hosting](docs/DEPLOYMENT.md#nodejs).

For local Codex statistics, the service account running Node must already be
signed in to the Codex CLI. Set `CODEX_USERNAME` to enable the integration and
its public profile link, or `CODEX_USAGE_ENABLED=true` for local collection
without an ID. These settings do not provide account access.
`CODEX_USAGE_ENABLED=false` explicitly disables it.
[Codex setup](docs/AI-USAGE.md#codex).

### Cloudflare Workers

Edit `wrangler.jsonc`: choose your Worker `name`, and set `vars.GITHUB_USERNAME`
and `vars.WAKATIME_USERNAME`. Keep the existing Durable Object binding and
migration. To include Codex, follow the one-command aggregate sync below;
it automatically manages its dedicated sync key. Do not fill in a sync token
in the deployment form or Build settings. No separate enable flag is required.
`DEFAULT_RANGE` may be omitted; its default is `all_time` on both runtimes.

```sh
cp .dev.vars.example .dev.vars
# Edit .dev.vars: set GITHUB_TOKEN and any optional source secrets.
chmod 600 .dev.vars
npm run dev:worker
```

Open [http://127.0.0.1:8791/build](http://127.0.0.1:8791/build) to review it locally.
Stop that process before switching runtimes on the same port. To publish:

```sh
npx wrangler login
npm run deploy -- --secrets-file .dev.vars
```

This explicitly uploads the secrets-only file as Worker secrets. `npm run deploy`
also forwards supported nonempty process/Build settings, but does **not**
automatically upload a local `.dev.vars` file without `--secrets-file`.
Wrangler creates the configured SQLite Durable Object through its migration;
no separate KV, D1 database, cron or GitHub Actions workflow is needed.
See [Cloudflare deployment](docs/DEPLOYMENT.md#cloudflare-workers).

Workers cannot run your local Codex CLI. After deploying the current version,
run this from a machine already signed in to Codex and Wrangler. Its local
`wrangler.jsonc` must name the Worker serving the destination origin:

```sh
npm run sync:codex -- https://your-worker.example
```

On the first successful local read, the command generates a private sync key,
saves it in ignored `.data/codex-sync.json`, and installs it as the Worker's
`CODEX_SYNC_TOKEN` Secret through Wrangler. Later syncs reuse it without another
deployment. Deployment settings never overwrite this managed key. No token
entry or separate initialization command is needed; preserve the private file
between syncs.
This transfers only the numeric/null summary and observation time, not your
Codex credentials or conversations. It is a manual command and creates no timer.
See [the full Codex bridge setup](docs/AI-USAGE.md#cloudflare-worker).

For Workers Builds, use **Deploy command** `npm run deploy` (`deploy:ci` remains
a compatibility alias). It forwards only
CodeStats's supported build settings and provider secrets into runtime bindings,
without exposing secrets in command arguments. Alternatively, manage Secrets
directly under the deployed Worker's **Settings → Variables and Secrets**.
See [dashboard setup](docs/DEPLOYMENT.md#workers-builds-dashboard).

## 4. Review and embed

1. Open `/build` on your deployment and inspect **Source status**. GitHub has
   separate repository and activity datasets within the same provider.
2. Choose **Account mode**: configured accounts or public usernames/IDs. Enter
   bare IDs for public mode, select source checkboxes, then the range and
   appearance. Overview stays the default; five source views are also available.
3. Review the card and expandable data tables. A missing statistic is a dash,
   while saved data retains its original successful timestamp.
4. In **Add to your GitHub README**, enter your public HTTPS origin and click
   **Copy Markdown**.
5. Paste the snippet into a README. For your profile, use the root `README.md`
   in your public `YOUR_GITHUB_USERNAME/YOUR_GITHUB_USERNAME` repository.

The default snippet is one linked transparent image, with no URL parameters:

```markdown
[![CodeStats](https://stats.example.com/)](https://github.com/Leask/CodeStats)
```

Replace the example domain with your deployment. Localhost, private-network and
login-protected URLs cannot serve public README visitors. GitHub renders the SVG
as an image; expandable sections use native `<details>`, not embedded JavaScript.
The Markdown generator works even if the first statistics fetch fails.
[More examples and options](docs/EMBEDDING.md).

Public profiles need no preconfiguration:

```markdown
[![CodeStats](https://stats.example.com/?github=octocat&wakatime=your-wakatime-id)](https://github.com/Leask/CodeStats)
```

Any explicit account parameter selects **public mode**, even if it matches the
configured owner. Omitted accounts, private snapshots, local Codex usage and
provider credentials are never inherited. `sources=github,codex` selects a subset;
without account parameters it selects from the configured profile. Public Codex
usage remains unavailable behind its login requirement. OpenRouter and Anthropic
usage require server-configured credentials and remain unavailable in public-ID
mode. Use `sources=anthropic` or `view=anthropic` without an account parameter
to select the configured Anthropic organization. [Profiles and source views](docs/EMBEDDING.md).

## Cache, freshness and privacy

Every source keeps its own last successful snapshot. The default refresh interval
is six hours; a failed refresh preserves previous values and timestamps, with a
fifteen-minute retry cooldown. Public username profiles collect **on demand only**;
visiting one never enrolls it in a background schedule. Configured profiles can
optionally refresh on a Node process interval or a separately configured Worker
Cron Trigger. Both are opt-in; see [refresh options](docs/DEPLOYMENT.md#optional-background-refresh).
A first installation needs one successful fetch before it can
serve fallback data. Codex imports keep the **observation time**, rather than
becoming fresh when a visitor loads the image. GitHub's image proxy can add its
own cache delay.

`fresh` means a source's saved observation uses the current collection format
and is within the configured cache window.
It does not mean that all providers have the same period or that an upstream API
covers every historical action. `stale` means saved data remains usable but is due
for refresh; `unavailable` means there is no usable saved observation yet.

In token mode, GitHub repository totals and language bytes include visible owned,
collaborator and organization repositories, including forks. **Stars include
only owned repositories.** Public output contains aggregate statistics and your
public profile, not private repository names, source code or provider secrets.
Review the visible aggregate counts before embedding them publicly.
Username-only GitHub has a smaller public REST scope and no language-byte or
calendar totals; unavailable values remain dashes, not zeros. Anonymous API limits
are shared by the service's outgoing IP, so public profiles benefit from cache reuse.
See [metric definitions](docs/METRICS.md) and [usage scopes](docs/AI-USAGE.md).

## Documentation

- [Deployment, settings and troubleshooting](docs/DEPLOYMENT.md)
- [README snippets, themes and endpoint options](docs/EMBEDDING.md)
- [Statistics, language grouping and rank semantics](docs/METRICS.md)
- [Codex, OpenRouter and Anthropic API usage setup](docs/AI-USAGE.md)
- [Differences from GitHub Stats Extended](docs/github-collection-plan.md)
- [Development and validation](docs/VALIDATION.md)
- [Implementation contract](docs/CONTRACT.md)

## Acknowledgements

Thank you to the authors and contributors of
[GitHub Stats Extended](https://github.com/stats-organization/github-stats-extended)
and its predecessor,
[GitHub Readme Stats](https://github.com/anuraghazra/github-readme-stats).
Their work inspired the design and development of CodeStats.

CodeStats independently rebuilds the collection and aggregation engine,
persistent cache, Node.js/Cloudflare Workers runtimes and SVG rendering.
GitHub, WakaTime, OpenRouter and Anthropic use their own APIs; Codex statistics use the
official local account-usage method and optional aggregate bridge.

The reference ranking formula and bundled icon assets retain their original
attributions and licenses in [third_party](third_party/).
