# Add your CodeStats card to GitHub

[Back to CodeStats](../README.md) · [Deployment guide](DEPLOYMENT.md)

Deploy your own instance first. Replace every `https://stats.example.com` below
with its public HTTPS origin. Account IDs and tokens belong in server configuration,
not in the image URL. The same snippets work for Node hosting and Workers.

## Use the snippet generator

1. Open the local preview or your deployed homepage.
2. Select the WakaTime range and language order.
3. Expand **Add to your GitHub README**.
4. Fill **Public HTTPS URL** with your deployed origin, not the local preview URL.
5. Click **Copy Markdown** and paste it into your README.

The generated snippet includes a light/dark overview and two native `<details>`
sections, for language shares and GitHub activity. The snippet uses `<picture>`
so GitHub chooses the card color scheme. The language/activity details are SVG
images; interactive sorting and data tables remain on the service homepage.

For a profile README, create a public repository whose name is exactly your
GitHub username, then put the snippet in its root `README.md`. It also works in
ordinary repository READMEs. [GitHub profile README documentation](https://docs.github.com/en/account-and-profile/how-tos/profile-customization/managing-your-profile-readme).

## One card

```markdown
[![My coding statistics](https://stats.example.com/card.svg?theme=transparent&range=all_time)](https://stats.example.com/)
```

Use `theme=light` or `theme=dark` for a fixed background. Transparent SVGs use a
transparent background and adapt their palette where the image viewer supports it.

## Automatic light/dark mode

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://stats.example.com/card.svg?theme=dark&amp;range=all_time">
  <img alt="My coding statistics" src="https://stats.example.com/card.svg?theme=light&amp;range=all_time">
</picture>
```

## Expandable language and activity cards

```markdown
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://stats.example.com/card.svg?theme=dark&amp;range=all_time">
  <img alt="My coding statistics" src="https://stats.example.com/card.svg?theme=light&amp;range=all_time">
</picture>

<details>
<summary>Language detail</summary>

![Languages](https://stats.example.com/card.svg?view=languages&theme=transparent&range=all_time)

</details>

<details>
<summary>GitHub activity</summary>

![GitHub activity](https://stats.example.com/card.svg?view=activity&theme=transparent&range=all_time)

</details>
```

Keep the blank lines around Markdown images inside `<details>`. In HTML
attributes, use `&amp;` between query parameters; ordinary Markdown image URLs
can use `&`. Localhost, private-network and login-protected URLs cannot be fetched
by GitHub visitors. Publishing a README does not deploy the CodeStats server.

## Endpoints and card options

| Endpoint | Purpose |
| --- | --- |
| `/` | Preview, expanded data tables and snippet generator |
| `/card.svg` | README image |
| `/api/stats` | Aggregates and source status/timestamps |
| `/health` | HTTP runtime readiness only |

Example:

```text
/card.svg?range=all_time&theme=dark&view=overview&limit=10&sort=time
```

| Parameter | Supported values | Default |
| --- | --- | --- |
| `range` | `all_time`, `last_7_days`, `last_30_days` | Server's `DEFAULT_RANGE` |
| `theme` | `dark`, `light`, `transparent` | `dark` |
| `view` | `overview`, `languages`, `activity` | `overview` |
| `limit` | Integers1–100; the final row is the unselected remainder | `10` |
| `sort` | `time`, `code`, `name`, `alternating` | `time` |

Range changes affect WakaTime, not the periods of GitHub activity. The range must
be public or authorized on WakaTime. The default ten language rows are nine named
groups plus Others. Sorting changes their order, not which groups are selected.

## How this relates to the reference project

Like [GitHub Stats Extended](https://github.com/stats-organization/github-stats-extended),
CodeStats exposes SVG URLs that GitHub can embed as images. Here you configure
your accounts once on your own deployment, then use its `/card.svg` URL. No shared
statistics service, multi-user login or generated-file GitHub Action is required.
See [the implementation comparison](github-collection-plan.md) for collection,
private access and rank differences.
