# Validation — independent scales and repository counts, 2026-10-28

The GitHub and WakaTime columns independently scale their largest displayed
unrounded share to a nearly full track. Each heading states the full-track
percentage. Row labels keep their original full-source percentages.

Repository counts use the existing headline inventory and existing language
pages. Languages are grouped before counting; each repository counts once per
group. Others uses a union of the remaining language memberships, so it also
deduplicates repositories. No additional upstream requests or commit traversal
are introduced. The internal language-set histogram is absent from public JSON.

## Checks

- Strict TypeScript and `git diff --check` passed.
- All 165 unit tests passed, including grouped unions, zero/unknown counts,
  independent scales and last-good cache migration from collection v6 to v7.
- Node and Wrangler dry-run Worker builds passed.
- All 13 actual workerd/SQLite cache checks passed with isolated storage and
  mocked upstreams.
- All 17 generated-Worker browser checks passed using isolated Chrome Beta,
  actual workerd and SQLite. No cloud deployment or real upstream tokens were
  used by this test.
- All 55 configured local-profile browser checks passed: SVG bar geometry,
  true percentage labels, repo counts, metadata placement, expanded tables,
  sorting, ranges, themes, header options, mobile overflow and SVG text bounds.
  No JavaScript errors or clipping were reported. Card screenshots were reviewed.
- The native Chrome Beta builder was also inspected through Computer Use after
  built-in/global browser controls were unavailable. Its expanded language table
  showed the counts below; changing order preserved the counts. GitHub code order
  was restored afterward.

Ignored receipts are `artifacts/unit-tests.json`, `browser-review.json`,
`worker-browser-review.json`, `cache-runtime-review.json` and `card-*.png`.

## Live local observation

Observed at 11:36 UTC on 2026-10-28, not a guarantee about later upstream state:

- GitHub repository collection v7 was fresh, last successful at 11:23:31 UTC.
  Headline and fully analyzed inventory both contained 558 repositories.
- WakaTime was fresh, last successful at 11:20:12 UTC.
- GitHub activity retained its last-good 2026-10-26 snapshot as stale. The local
  credential lacks the complete private-activity scopes `repo`, `read:user` and
  `read:org` expected by that collector. No permission or coverage downgrade was
  made. This limitation does not replace the fresh repository-language dataset.
- Current full-track scales were 39.7% for GitHub and 42.1% for WakaTime.

| Group | Distinct repositories |
| --- | ---: |
| C/C++ | 68 |
| HTML/CSS | 157 |
| PHP | 54 |
| JavaScript/TypeScript | 231 |
| Python | 102 |
| Go | 29 |
| Shell | 142 |
| JSON/YAML/TOML/INI | 3 |
| Markdown/Text | 2 |
| Others | 178 |

Groups can share repositories; these counts must not be summed into the headline.
Language-empty repositories remain in the headline inventory.

The local Node preview remains at `http://127.0.0.1:8791/build`, using its existing
private cache. Credentials were not written into source or configuration. This
review did not commit, push or deploy the changes.

## Optional AI usage extension

The preceding language-card milestone was subsequently committed and pushed as
`d1fffe5`. The AI usage extension below was reviewed locally afterward.

- 237 unit tests passed, including collector completeness, token accounting,
  Codex read failure/timeout, bounded authenticated imports, observation age,
  concurrent imports and source-independent last-good fallback.
- TypeScript, Node build, Wrangler dry-run build and diff checks passed.
- 58 real-profile Chrome Beta checks, 25 generated-Worker/workerd browser checks
  and 13 workerd/SQLite cache checks passed. The Worker check imported only mock
  aggregate observations and exercised both read-only provider analytics adapters.
- 18 additional isolated layout cases covered one, two and three usage services
  across all themes and header settings, with no text clipping. The native Chrome
  builder was also reloaded and visually inspected through Computer Use.
- The official local Codex `account/usage/read` returned 131,320,846,898 lifetime
  tokens. Its summary matched the supplied profile screenshot at 131.3B. The
  configured Node preview retained that successful observation across restart.
- The existing OpenRouter inference credential passed `/api/v1/key` with HTTP200
  but failed account activity with HTTP403. The new analytics collector also
  reported `Management key required`. No OpenRouter token total was fabricated.
  A Management credential is still required for live acceptance; the default
  reporting interval is explicitly 30 completed UTC days, not lifetime.
- Anthropic was not configured. Its organization API adapter and all three-service
  layouts were validated with isolated fixtures, not a live Anthropic account.
- Codex credentials were read only by Codex's normal login mechanism. No login
  token, cookie or conversation data was exported. The optional Worker import
  accepts only normalized statistics and retains the original observation age.
- A pattern scan over the changed source/config-sample/test files found no
  credential-like values. No real credentials were added to tracked files.

The local preview remains `http://127.0.0.1:8791/build`. Ignored receipts include
`artifacts/ai-all-unit-tests.json`, `browser-review.json`,
`worker-browser-review.json`, `cache-runtime-review.json` and
`usage-ui-mock-review.json`. This extension did not deploy to Cloudflare or install
a sync timer. See [AI usage setup](../AI-USAGE.md) for the Node/Worker distinction.
