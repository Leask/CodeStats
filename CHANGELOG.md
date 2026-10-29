# Changelog

## Unreleased

- Default omitted WakaTime ranges to `all_time` on both runtimes. Auto-enable
  configured Codex integration from its ID or sync secret, while retaining
  `CODEX_USAGE_ENABLED=false` as an explicit override.
- Support public GitHub/WakaTime usernames and Codex IDs in the builder and
  URLs, isolated from configured credentials, imports and private caches.
  Add four source views and source-subset selection while retaining overview
  and legacy language/activity views. Public profiles refresh on demand only.
- Add bounded anonymous GitHub profile/repository/Search collection; unsupported
  bytes, calendar and extended activity remain unknown rather than zero.
  Prefer complete named public WakaTime statistics with owner-verified OAuth
  fallback for the same range, including token-only identity resolution.
- Add opt-in configured-profile refresh on Node and a Worker scheduled handler;
  no Cron Trigger is created automatically and Codex import age is preserved.
- Present CodeStats as a four-source profile: GitHub, WakaTime, Codex and
  OpenRouter. Upgrade builder guidance, source grouping, deployment documentation
  and credential-free samples. GitHub repository/activity remain separate
  datasets inside one service; optional usage integrations remain optional.
- Add independent Codex, OpenRouter and optional Anthropic last-good usage
  observations. Codex reads native local account summaries on Node and accepts
  authenticated aggregate-only Worker imports using a separate sync secret.
  Imported observation times are never refreshed merely by viewing the card.
- Show Codex before OpenRouter, with five metrics each. OpenRouter places total
  tokens, tokens/day and tokens/week before total prompts and longest streak;
  Codex uses Lifetime and Total tokens labels. Keep unknown fields distinct
  from zero, and retain prior totals while upgrading collection versions.
- Calculate OpenRouter totals, request counts, daily/weekly averages and longest
  streak from one unfiltered aggregate query over 367 completed UTC days by
  default. Include inactive days in averages and state the reporting window.
- Count merged-language and Others repositories using exact deduplicated unions
  from the headline inventory, with no extra upstream calls. Keep membership
  aggregates private, preserve older caches, and share computed language rows
  between the builder and SVG.
- Put repository counts below language names and bytes/time below their bars.
  Scale each column independently to the next 10 percentage points, showing its
  full-track scale while retaining true source-share labels.
- Align the avatar and upper-right rank, use consistent card edges and section
  spacing, and keep a 20px rank/overview gap without the profile header. Keep
  refresh times and right-aligned project credit together when space permits.
  Bundle provider brand icons locally with their artwork notices.
- Refine the builder's dropdown arrows and text spacing. Serve transparent SVG
  at `/` and `/card.svg`, with the builder at `/build`. Generate one linked
  README image by default; expandable sections are opt-in and Markdown remains
  available when statistics cannot load.
- Preserve dashboard Variables on deploy, document runtime versus build secrets,
  and keep Worker bundle helpers valid with `keep_names: false` / `minify: false`.
  Retry a formerly missing GitHub credential once configured. Group Makefile
  with C/C++ and Awk with Shell.

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
