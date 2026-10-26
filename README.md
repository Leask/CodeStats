# CodeStats

Deploy your own GitHub + WakaTime profile card, then paste one Markdown snippet
into your GitHub README. Run the same application on **Node.js** or
**Cloudflare Workers**.

CodeStats reads the official GitHub and WakaTime APIs directly. Each deployment
serves one configured profile and keeps its last successful statistics when an
upstream API is unavailable. It does not depend on another statistics-card service.

- GitHub avatar, name, bio/status and reference-style rank estimate.
- Coding time, calendar contributions, repositories, indexed commits, PRs,
  issues, followers and owned-repository stars.
- Combined language table: WakaTime hours alongside GitHub byte percentages.
- Light, dark and transparent SVGs, plus expandable GitHub README sections.
- A preview page with **Copy Markdown** and persistent last-good caching.

## 1. Get the project and configure your accounts

Use Node.js **26 or newer**, npm and Git. A Cloudflare account is needed only
for the Worker deployment option.

```sh
git clone https://github.com/Leask/CodeStats.git
cd CodeStats
npm ci
```

You can also fork the repository first and clone your fork.

Create a GitHub **classic personal access token** belonging to the GitHub account
you want to display, with `repo`, `read:user` and `read:org` scopes. An existing
OAuth access token with these scopes also works. CodeStats makes read requests;
the classic `repo` scope itself is broader than read-only. The current full-mode
collector checks these declared scopes, so a fine-grained PAT is not a drop-in
replacement. Organization SSO and access policies still apply.

For WakaTime, publish the statistics range you want to display; **all-time** is
the default. A public range needs no WakaTime token. Private/unpublished ranges
need an optional read-stats OAuth token. A heartbeat ingestion API key is not a
replacement. See [credentials and permissions](docs/DEPLOYMENT.md#credentials).

Replace the username placeholders with **your own GitHub and WakaTime IDs**.
They can be different. Keep real tokens in ignored local files or platform secrets.

## 2. Choose a runtime

### Node.js

```sh
cp .env.example .env
# Edit .env: set both usernames and GITHUB_TOKEN.
chmod 600 .env
npm start
```

Open [http://127.0.0.1:8791](http://127.0.0.1:8791). Node uses a local SQLite
cache under `.data/`; no external database is required. For a public service,
keep that directory persistent and put the server behind an HTTPS reverse proxy.
See [Node hosting](docs/DEPLOYMENT.md#nodejs).

### Cloudflare Workers

Edit `wrangler.jsonc`: choose your Worker `name`, and set `vars.GITHUB_USERNAME`
and `vars.WAKATIME_USERNAME` to your own accounts. Keep the existing Durable
Object binding and migration.

```sh
cp .dev.vars.example .dev.vars
# Edit .dev.vars: set GITHUB_TOKEN; add WAKATIME_TOKEN only if needed.
chmod 600 .dev.vars
npm run dev:worker
```

Open [http://127.0.0.1:8791](http://127.0.0.1:8791) to review it locally. Stop
that process before switching runtimes on the same port. To publish:

```sh
npx wrangler login
npm run deploy -- --secrets-file .dev.vars
```

This explicitly uploads the secrets-only file as Worker secrets. Ordinary
`npm run deploy` does **not** automatically upload local `.dev.vars` values.
Wrangler creates the configured SQLite Durable Object through its migration;
no separate KV, D1 database, cron or GitHub Actions workflow is needed.
See [Cloudflare deployment](docs/DEPLOYMENT.md#cloudflare-workers).

## 3. Copy the snippet into your GitHub README

1. Open your deployed public HTTPS URL.
2. Expand **Add to your GitHub README** and check the **Public HTTPS URL** field.
3. Choose your range/order, then click **Copy Markdown**.
4. Paste it into a repository README. For your profile, use the root `README.md`
   in your public `YOUR_GITHUB_USERNAME/YOUR_GITHUB_USERNAME` repository.

The generated snippet includes automatic light/dark images and expandable
language/activity cards. For a single card, replace the example domain below
with your own deployment:

```markdown
[![My coding statistics](https://stats.example.com/card.svg?theme=transparent&range=all_time)](https://stats.example.com/)
```

Use your own public endpoint, not `localhost` or an authenticated preview URL.
Your token never belongs in the image URL or README. GitHub renders the SVG as
an image; expand/collapse uses native `<details>`, not embedded JavaScript.
[More Markdown examples and options](docs/EMBEDDING.md).

## Cache and data scope

The default cache refresh interval is six hours. Visitors receive saved data
while a due refresh runs. Failed refreshes keep the previous values and success
timestamps, with a default fifteen-minute retry cooldown. Refreshes are triggered
by requests; there is no background timer. A new installation needs one successful
fetch before it has fallback data. GitHub's image proxy can add its own delay.

By default, repository totals and language bytes include visible owned,
collaborator and organization repositories, including forks. **Stars include
only owned repositories.** Personal activity includes private work visible to
your token. Public output contains these aggregate counts plus your public
profile, not private repository names or source code. GitHub bytes measure current
repository content, including other authors, rather than your authored lines.

## Documentation

- [Deployment, settings and troubleshooting](docs/DEPLOYMENT.md)
- [README snippets, themes and endpoint options](docs/EMBEDDING.md)
- [Statistics, language grouping and rank semantics](docs/METRICS.md)
- [Differences from GitHub Stats Extended](docs/github-collection-plan.md)
- [Development and validation](docs/VALIDATION.md)
- [Implementation contract](docs/CONTRACT.md)

## Acknowledgements

Thank you to the authors and contributors of
[GitHub Stats Extended](https://github.com/stats-organization/github-stats-extended)
and its predecessor,
[GitHub Readme Stats](https://github.com/anuraghazra/github-readme-stats).
Their work inspired the design and development of CodeStats.

CodeStats independently rebuilds the statistics collection and aggregation
engine, persistent cache, Node.js/Cloudflare Workers runtimes and SVG rendering.
It reads the official GitHub and WakaTime APIs directly.

The reference ranking formula and bundled icon assets retain their original
attributions and licenses in [third_party](third_party/).
