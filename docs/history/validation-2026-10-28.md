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
