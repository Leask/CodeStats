# Add your CodeStats card to GitHub

[Back to CodeStats](../README.md) · [Deployment guide](DEPLOYMENT.md)

Deploy your own instance first. Replace every `https://stats.example.com` below
with its public HTTPS origin. Account IDs and tokens belong in server configuration,
not in the image URL. The same snippets work for Node hosting and Workers.

## Use the snippet generator

1. Open `/build` or `/build/` on your local service or deployed origin.
2. Select the WakaTime range and language order.
3. Use the already-open **Add to your GitHub README** section.
4. Fill **Public HTTPS URL** with your deployed origin, not the local preview URL.
5. Click **Copy Markdown** and paste it into your README.

The default snippet is one linked transparent SVG. Only nondefault settings add
query parameters. Check **Include expandable language and activity cards** to
append two native `<details>` sections. Each image links to the CodeStats
repository. Interactive controls and data tables remain at `/build`.
The generator is visible and usable even when the statistics API is unavailable.

For a profile README, create a public repository whose name is exactly your
GitHub username, then put the snippet in its root `README.md`. It also works in
ordinary repository READMEs. [GitHub profile README documentation](https://docs.github.com/en/account-and-profile/how-tos/profile-customization/managing-your-profile-readme).

## One card

```markdown
[![CodeStats](https://stats.example.com/)](https://github.com/Leask/CodeStats)
```

Use `theme=light` or `theme=dark` for a fixed background. Transparent SVGs use a
transparent background and adapt their palette where the image viewer supports
it. Both `/` and `/card.svg` serve this transparent card without parameters.

## Optional explicit light/dark images

The default transparent SVG already contains light/dark palette rules. If you
prefer separate images selected by the README viewer, use:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://stats.example.com/?theme=dark">
  <img alt="CodeStats" src="https://stats.example.com/?theme=light">
</picture>
```

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
| `/health` | HTTP runtime readiness only |

Example:

```text
/?theme=dark&range=last_30_days
```

| Parameter | Supported values | Default |
| --- | --- | --- |
| `range` | `all_time`, `last_7_days`, `last_30_days` | Server's `DEFAULT_RANGE` |
| `theme` | `dark`, `light`, `transparent` | `transparent` |
| `view` | `overview`, `languages`, `activity` | `overview` |
| `limit` | Integers1–100; the final row is the unselected remainder | `10` |
| `sort` | `time`, `code`, `name`, `alternating` | `time` |

Range changes affect WakaTime, not the periods of GitHub activity. The range must
be public or authorized on WakaTime. The default ten language rows are nine named
groups plus Others. Sorting changes their order, not which groups are selected.

## How this relates to the reference project

Like [GitHub Stats Extended](https://github.com/stats-organization/github-stats-extended),
CodeStats exposes SVG URLs that GitHub can embed as images. Here you configure
your accounts once on your own deployment, then use its root URL or `/card.svg`. No shared
statistics service, multi-user login or generated-file GitHub Action is required.
See [the implementation comparison](github-collection-plan.md) for collection,
private access and rank differences.
