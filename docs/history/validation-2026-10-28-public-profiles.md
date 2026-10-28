# Validation — public profiles and focused views, 2026-10-28

This report covers the local multi-profile/source-selection implementation.
It extends the earlier [four-source review](validation-2026-10-28-four-sources.md).
No production deployment or Cron Trigger was created. The running Node preview
keeps `AUTO_REFRESH_SECONDS=0`; existing snapshots are retained across restart.

## Implemented behavior

- Builder Accounts accepts bare GitHub/WakaTime usernames and Codex IDs. Every
  token remains in server configuration. Credential-shaped IDs and secret query
  parameters are rejected; generated Markdown includes only public selectors.
- Any explicit account selector creates an anonymous public request, even when
  its ID equals the configured owner. Other owner accounts, credentials, local
  Codex reads and aggregate imports are excluded. Source masks and views do not
  create duplicate public account caches.
- Overview and the existing full-account layout are retained. GitHub, WakaTime,
  Codex and OpenRouter each have focused views; legacy languages/activity URLs
  still work. Partial selections display only their selected providers.
- GitHub supports bounded anonymous REST metadata and Search counts. Unsupported
  repository language bytes, calendar and review totals remain unknown. Full
  private/GraphQL collection still needs the owner's configured token.
- WakaTime prefers complete public data for the exact requested range. Same-range
  OAuth fallback verifies the owner; token-only setup resolves identity before
  reading WakaTime cache data. Its namespace does not move other provider caches
  or Codex imports. Pending/different ranges cannot substitute for all-time.
- Public Codex IDs produce canonical ChatGPT links and explain unavailable usage.
  OpenRouter usage requires a configured Management key. Neither exposes owner
  usage in public mode, including cached metadata or error details.
- Node can opt into an in-process configured-account interval; Worker exports
  a configured-account scheduled handler. Defaults remain off with no shipped
  trigger. Public names stay request-driven and are never enrolled automatically.

## Acceptance results

| Check | Result |
| --- | --- |
| Strict TypeScript | Passed |
| Unit/integration tests | 508 passed across 18 files |
| Node bundle | Passed |
| Wrangler dry-run bundle | Passed; actual generated bundle exercised below |
| Live Node/Chrome Beta regression | 69 passed, including full overview geometry |
| Generated Worker browser checks | 33 passed |
| Isolated workerd/SQLite persistence and failure checks | 13 passed |
| Multi-profile browser checks | 18 passed |
| Source selections | All 15 nonempty subsets in configured and public modes |
| Focused/partial geometry | 258 cases, 880/440/320 widths, header on/off |
| Credential-pattern scan | No findings in 84 source/documentation paths |
| Diff whitespace | Passed |

Browser acceptance used the installed Chrome Beta through Playwright with
isolated contexts, actual page/control/clipboard interaction and SVG text bounds.
The built-in browser inventory had no usable tab. Worker tests executed the
actual Wrangler bundle in local workerd with temporary SQLite and mocked
upstreams. No test keys grant real access, and no credentials were copied into
test fixtures or published records.

Coverage includes source masks, configured/public separation for identical IDs,
no unwanted provider requests, identity changes, retry waits, real zeros versus
unknown fields, import ordering/age, persistence across restart, capacity/close
behavior, generated URLs/Markdown, invalid input before API calls, narrow controls,
and focused-card/footer bounds. Synthetic geometry demonstrates rendering only;
it is not evidence of anonymous access to private provider data.

## Bounded live observations

At 17:59–18:00 UTC on 2026-10-28, the configured local preview reported GitHub
repositories/activity, WakaTime, Codex and OpenRouter as fresh. WakaTime's current
all-time refresh used public access. Fresh describes saved observation age and
does not mean the providers share a period or were all fetched at that moment.

One anonymous request through the Node service for `github=octocat&sources=github`
returned fresh public GitHub data, 8 owned public repositories and indexed
commit counts. It marked language coverage unavailable, disabled WakaTime and
contained no AI usage sources. No authenticated GitHub fallback was used.

The first warm GitHub request served an older successful snapshot while a due
refresh ran; a later read became fresh. The browser regression was rerun after
that refresh and passed. No saved data or retry state was cleared to obtain a pass.

Anonymous Codex profile research found a sign-in wall rather than numeric usage.
OpenRouter has no verified anonymous username analytics path; Management-key
collection remains the supported configured route. These limits are intentional
and are displayed rather than replaced with the server owner's statistics.
Anthropic has no live configuration in this review; it remains an optional extra.

Local builder: `http://127.0.0.1:8791/build`.
Ignored receipts/screenshots are in `artifacts/`: `browser-review.json`,
`worker-browser-review.json`, `cache-runtime-review.json`,
`multi-profile-browser-review.json`, `multi-profile-builder-public.png`, and
`multi-profile-focused-{github,wakatime,codex,openrouter}.png`.
Reproduce using [the validation guide](../VALIDATION.md).
