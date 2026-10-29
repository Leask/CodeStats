# Add your CodeStats card to GitHub

[Back to CodeStats](../README.md) · [Deployment guide](DEPLOYMENT.md)

Deploy your own instance first. Replace every `https://stats.example.com` below
with its public HTTPS origin. Public usernames/IDs may go in image URLs; tokens
belong only in server configuration. The same snippets work on Node and Workers.

## Use the snippet generator

1. Open `/build` or `/build/` on your local service or deployed origin.
2. Review the four provider cards: GitHub, WakaTime, Codex and OpenRouter.
   `Not enabled` usage sources link to their server-side setup instructions.
3. Choose **Account mode**: configured accounts, or public usernames/IDs. In
   public mode enter bare GitHub/WakaTime usernames and/or a Codex ID. Use the
   four source checkboxes to choose the subset, then the range and appearance.
   **View** offers Overview, GitHub, WakaTime, Codex and OpenRouter, plus the
   legacy language/activity cards.
4. Review the preview and language, GitHub activity and AI usage details.
5. In the already-open **Add to your GitHub README** section, set
   **Public HTTPS URL** to your deployed origin, not the local preview URL.
6. Click **Copy Markdown** and paste it into your README.

The default snippet is one linked transparent SVG. Only nondefault settings add
query parameters. Check **Include expandable language and activity cards** to
append two native `<details>` sections. Each image links to the CodeStats
repository. Interactive controls and data tables remain at `/build`.
The generator is visible and usable even when the statistics API is unavailable.
The builder accepts names/IDs, never credentials. Its source selection follows
the same public/configured distinction as the generated URLs below. Full private
GitHub and usage integrations need [server configuration](DEPLOYMENT.md) and
the [Codex/OpenRouter setup](AI-USAGE.md).

For a profile README, create a public repository whose name is exactly your
GitHub username, then put the snippet in its root `README.md`. It also works in
ordinary repository READMEs. [GitHub profile README documentation](https://docs.github.com/en/account-and-profile/how-tos/profile-customization/managing-your-profile-readme).

## One card

```markdown
[![CodeStats](https://stats.example.com/)](https://github.com/Leask/CodeStats)
```

The same image includes your enabled sources. GitHub and WakaTime supply the
overview/language comparison; Codex and OpenRouter add their five-metric usage
rows when configured. You do not need four separate image URLs. Usage sources
that are not enabled stay out of the SVG and its refresh footer; the builder
still shows their setup cards.

Use `theme=light` or `theme=dark` for a fixed background. Transparent SVGs use a
transparent background and adapt their palette where the image viewer supports
it. Both `/` and `/card.svg` serve this transparent card without parameters.

To hide the avatar, name and bio in a profile README, choose
**Profile header → Hide** in `/build`, or add `header=false`:

```markdown
[![CodeStats](https://stats.example.com/?header=false)](https://github.com/Leask/CodeStats)
```

The remaining content moves up and the card becomes shorter. Omit the parameter
or use `header=true` to show the profile header.
When rank data is available, its trophy, username and percentile always appear
at the upper right, including when `header=false`. Hiding the profile header
keeps a compact rank lane above the main numbers. The footer contains refresh
times on the left and the CodeStats project link on the right. Enabled sources
appear in GitHub, WakaTime, Codex, OpenRouter order. Long refresh text wraps when
needed. These ages describe saved observations, not when GitHub last fetched
the image; GitHub's image proxy may add another cache delay.

## Optional explicit light/dark images

The default transparent SVG already contains light/dark palette rules. If you
prefer separate images selected by the README viewer, use:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://stats.example.com/?theme=dark">
  <img alt="CodeStats" src="https://stats.example.com/?theme=light">
</picture>
```

## Configured and public profiles

With no account parameters, the card uses the configured account subset. Select
only GitHub and Codex from that profile with:

```markdown
[![CodeStats](https://stats.example.com/?sources=github,codex)](https://github.com/Leask/CodeStats)
```

Public profiles need no account configuration on the server:

```markdown
[![CodeStats](https://stats.example.com/?github=octocat&wakatime=your-wakatime-id)](https://github.com/Leask/CodeStats)
```

The first explicit `github`, `wakatime` or `codex` ID selects **public mode** for
the entire request. Supply every account you want; omitted accounts do not fall
back to the deployment owner. This also applies when an explicit ID happens to
match the configured ID. Owner tokens, private data, Codex CLI/imports and
OpenRouter credentials are never reused for public profiles.

| Selection example | Meaning |
| --- | --- |
| `?github=octocat` | Anonymous GitHub REST aggregates; no repository bytes/calendar totals |
| `?wakatime=your-wakatime-id` | That user's complete published data for the requested range |
| `?codex=your-codex-id&view=codex` | Canonical Codex profile link; usage unavailable because the page requires sign-in |
| `?sources=github,codex` | Configured GitHub/Codex subset, if available |
| `?sources=wakatime,openrouter` | Configured WakaTime/OpenRouter subset, if available |
| `?sources=github,codex,openrouter` | Three configured providers, each with its own reporting period |
| `?github=octocat&codex=your-id&sources=github,codex,openrouter` | Public GitHub and Codex link; selected OpenRouter explicitly unavailable, never the owner's usage |

`sources` supports every nonempty subset of the four provider names (15
combinations). It is a mask, not authentication and not a claim that all selected
sources have data. Omitted `sources` infers providers from the selected public IDs
or configured connections. Public usernames collect/cache on demand only and are
not enrolled in scheduled refreshes.

Names are bare IDs rather than full profile URLs. Use lowercase parameter names
once each. Empty/invalid IDs, duplicate/unknown sources and credential-like query
parameters are rejected. Encode parameter values using normal URL encoding.

## Source-specific cards

Keep `view=overview` for the combined card. Four focused variants use the same
selected accounts, caches and source mask:

```text
/?view=github
/?view=wakatime
/?view=codex
/?view=openrouter
/?github=octocat&view=github
/?wakatime=your-wakatime-id&view=wakatime
```

The GitHub variant distinguishes public-only fields from full token coverage;
WakaTime shows its own period/languages without inventing GitHub bytes. Codex
and OpenRouter show their five native metrics when configured and available.
Unavailable or unselected data remains labelled with setup/scope guidance,
rather than copying another account's usage or substituting zeros.
The older `languages` and `activity` views remain supported.

## Expandable language and activity cards

```markdown
[![CodeStats](https://stats.example.com/)](https://github.com/Leask/CodeStats)

<details>
<summary>Language detail</summary>

[![CodeStats languages](https://stats.example.com/?view=languages)](https://github.com/Leask/CodeStats)

</details>

<details>
<summary>GitHub activity</summary>

[![CodeStats GitHub activity](https://stats.example.com/?view=activity)](https://github.com/Leask/CodeStats)

</details>
```

Keep the blank lines around Markdown images inside `<details>`. In HTML
attributes, use `&amp;` between query parameters; ordinary Markdown image URLs
can use `&`. Localhost, private-network and login-protected URLs cannot be fetched
by GitHub visitors. Publishing a README does not deploy the CodeStats server.

## Endpoints and card options

| Endpoint | Purpose |
| --- | --- |
| `/`, `/card.svg` | Transparent README SVG by default |
| `/build`, `/build/` | HTML card builder, data tables and snippet generator |
| `/api/stats` | Aggregates and source status/timestamps |
| `/health` | HTTP readiness and source configuration-presence flags; not successful source connectivity |
| `POST /api/usage/codex` | Optional authenticated aggregate import; never an image URL |

Example:

```text
/?theme=dark&range=last_30_days
```

| Parameter | Supported values | Default |
| --- | --- | --- |
| `range` | `all_time`, `last_7_days`, `last_30_days` | Server's `DEFAULT_RANGE`, or `all_time` when omitted |
| `theme` | `dark`, `light`, `transparent` | `transparent` |
| `header` | `true`, `false`; show or hide the avatar, name and bio | `true` |
| `view` | `overview`, `github`, `wakatime`, `codex`, `openrouter`; legacy `languages`, `activity` | `overview` |
| `limit` | Integers1–100; the final row is the unselected remainder | `10` |
| `sort` | `time`, `code`, `name`, `alternating` | `code` |
| `github` | Bare public GitHub username | Omitted: configured mode |
| `wakatime` | Bare public WakaTime username or UUID | Omitted: configured mode |
| `codex` | Bare Codex ID; the canonical page URL is constructed internally | Omitted: configured mode |
| `sources` | Comma-separated unique `github,wakatime,codex,openrouter` subset | Infer from public IDs or configured connections |

Range changes affect **WakaTime only**. GitHub activity keeps its API-defined
periods, Codex remains lifetime as of its observation, and OpenRouter keeps its
configured completed-day interval. The WakaTime range must be public or
authorized. The default ten language rows are nine named
groups plus Others. Sorting changes their order, not which groups are selected.
Each bar column rounds its largest source share upward to the next 10 percentage
points, while row labels retain their true full-source percentages.

The `overview` and `languages` images include selected enabled usage rows. The `activity`
view concentrates on GitHub activity and omits those usage rows while retaining
source refresh metadata. Public account selectors and source masks apply equally
to SVG, `/build` and `/api/stats`. There are no URL parameters for provider tokens
or Codex logins. OpenRouter has no anonymous username usage endpoint.

## How this relates to the reference project

Like [GitHub Stats Extended](https://github.com/stats-organization/github-stats-extended),
CodeStats exposes SVG URLs that GitHub can embed as images. Here you configure
your accounts once for full configured coverage, or pass public IDs to a deployed
instance. No third-party statistics-card service, user-login flow or generated-file
GitHub Action is required.
See [the implementation comparison](github-collection-plan.md) for collection,
private access and rank differences.
