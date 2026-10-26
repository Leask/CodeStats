# Changelog

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
