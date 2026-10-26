# Changelog

## Unreleased

- Preserve dashboard Variables on deploy, retry a formerly missing GitHub token
  immediately once configured, and group Makefile with C/C++ and Awk with Shell.
- Serve the transparent README SVG directly at `/` and `/card.svg`; move the
  interactive card builder to `/build` and `/build/`.
- Generate one compact linked Markdown image by default, omitting default URL
  parameters. Expandable language/activity cards are optional, and the snippet
  remains available when statistics cannot load.
- Preserve browser helper source in Worker bundles with `keep_names: false`
  and `minify: false`, avoiding an undefined `__name` in the builder.
- Clarify runtime Worker secrets and the optional Workers Builds dashboard
  setup, including the distinction from build-only secrets.

## v0.1.0 — 2026-10-26

First milestone of the independently implemented CodeStats engine and card.

- Collect GitHub and WakaTime statistics directly from their official APIs.
  GitHub uses aggregate queries and complete repository/language pagination,
  with token-visible private data and configurable repository scope.
- Keep last successful data per dataset when upstream refreshes fail, with
  persistent SQLite storage on Node.js and Cloudflare Durable Objects.
- Show eight profile metrics, owned-repository stars, a public GitHub avatar,
  bio/status and the reference-inspired rank estimate.
- Combine related languages before selecting nine groups plus Others; show
  WakaTime hours and GitHub byte shares with balanced percentage totals.
- Provide light, dark and transparent SVG cards, a local preview and copyable
  Markdown with expandable language/activity sections for GitHub READMEs.
- Include Node.js/Cloudflare deployment guides, credential-free configuration
  samples, data-scope documentation and third-party artwork/rank notices.

Validation: strict TypeScript, 139 unit tests, Node/Worker builds, 11 isolated
workerd/SQLite checks and 36 Chrome Beta browser checks of the local profile.
This milestone does not represent a production Cloudflare deployment.
