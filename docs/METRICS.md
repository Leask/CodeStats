# Statistics and display rules

[Back to CodeStats](../README.md) · [Reference comparison](github-collection-plan.md)

## Five sources and their scopes

| Source | Main measurements | Reporting period |
| --- | --- | --- |
| GitHub | Profile, repository counts/bytes, contributions and social/activity counts | Current repository snapshot plus metric-specific recent/lifetime API aggregates |
| WakaTime | Coding seconds and time by language | Selected all-time, 7-day or 30-day range |
| Codex | Total/peak tokens, longest task, longest/current streak | Official account/workspace lifetime summary as of its observation time |
| OpenRouter | Total tokens, average tokens/day and tokens/week, request count and longest streak | Last 367 completed UTC days by default, or a shorter explicit interval |
| Anthropic API | Organization API total tokens, including input, output and cache use | Last 30 completed UTC days by default, or the configured UTC start date |

Public username/ID requests use isolated anonymous collection, even when an ID
matches the configured owner. `sources` selects a provider subset; the focused
`github`, `wakatime`, `codex`, `openrouter` and `anthropic` views retain those scopes and
periods. Missing fields are unknown (`—`); a verified zero remains zero.

These are five providers with different accounting rules. GitHub has two
independently cached datasets—repositories/profile and personal activity—within
one source. A fresh repository snapshot does not guarantee fresh activity data.
Check both dataset statuses in the builder when assessing GitHub coverage.

The eight overview values are coding hours, calendar contributions,
repositories, commits, PRs, issues, followers and owned-repository stars.
Coding hours comes from WakaTime; the other seven come from GitHub. The
**Commits** label represents GitHub search-indexed authored commits, not a scan
of every branch or an additions/deletions count.

Codex, OpenRouter and Anthropic API have separate rows below the language table when enabled.
Their totals are not combined with each other or with coding time. Selecting a
WakaTime range never changes GitHub or the usage providers' reporting windows.
[Usage definitions and setup](AI-USAGE.md).

Anthropic's **Total tokens** sums uncached input, cache-read input, both 5-minute
and 1-hour cache-creation input, and output tokens from the organization Usage
API. It is not a Claude Pro/Max subscription total or a count of requests. No
unsupported streak or lifetime total is inferred. This built-in source requires
an organization Admin key in server settings; public-ID requests never inherit
that key or the owner's saved organization usage.

## GitHub and WakaTime language data

**WakaTime:** tracked coding seconds for the selected range. Sorting uses exact
seconds; display rounding is balanced as described below. The denominator
includes `Other`, so the total shown is `total_seconds_including_other_language`.
`Other` has no direct GitHub language equivalent; its time is included in the final Others remainder.

**GitHub:** current language bytes from GitHub's paginated repository connection.
By default, include all token-visible OWNER, COLLABORATOR and ORGANIZATION_MEMBER
repositories, including forks and archived repositories. These are whole-repository
bytes, including other authors' code. No commit history, additions/deletions,
authorship attribution, SHA ledger or background backfill is collected.

That byte inventory requires **token mode**. Username-only public REST mode
collects the public profile, complete owned-public metadata within ten pages of
100 repositories, and authored Search totals. It includes selected owned forks
but does not enumerate organization/collaborator inventories, language endpoints
or commits. Repository `size` and primary-language labels are not language bytes.
Language bytes, language-repository unions, calendar/review totals and rank inputs
are therefore unavailable in public mode. Above the metadata cap, selected count,
stars and forks are unknown. Partial searches, changing inventories and transient
failures do not become successful smaller totals.

Repository counts use that selected scope. Stars count only selected repositories
owned by the configured user, including their own forks when enabled. Stars on
organization and other users' collaboration repositories are excluded; there is
no attempt to attribute a shared repository's popularity to a contributor.
Fork popularity sums only
original repositories because a fork's `forkCount` includes its upstream network.
The native filters can reproduce the reference project's narrower defaults:

```dotenv
GITHUB_REPOSITORY_AFFILIATIONS=OWNER
GITHUB_INCLUDE_FORKS=false
GITHUB_INCLUDE_OWN_CONTRIBUTIONS=false
```

The default third setting is `true`: include owned repositories in recent/lifetime
contributed-repository counts. It does not attribute the whole repository to you.
GitHub's activity counts also include organization and external open-source work
that its APIs make visible to your token.

## Language selection and grouping

The default card and expanded table show nine named groups plus **Others**.
After grouping, selection alternates descending GitHub bytes and WakaTime
seconds, starting with GitHub and skipping duplicates and the upstream Other category, until nine groups
are selected. Those nine are displayed by descending GitHub code bytes. Others is
always last and sums every remaining group plus WakaTime's unclassified Other.
Both columns therefore represent the complete collected data, not just a top-N
subset. Display sorting changes order, not which groups are selected.

GitHub byte shares appear on the left and WakaTime shares on the right. Each
language subtitle shows the number of distinct repositories using that language
group. It uses exactly the headline repository inventory, including configured
owned, organization and collaborator repositories, private visibility and forks.
Only positive language bytes count as usage. A repository using both JavaScript
and TypeScript counts once in JavaScript/TypeScript; the same rule applies to all
families. Others counts the union of repositories using any remaining language,
not the headline total minus the named counts. Counts overlap between groups,
so their sum need not equal the headline. Repositories without detected languages
remain in the headline but do not count toward a language group.

These counts reuse the existing repository/language pages, with no additional API
requests or commit traversal. The private cache stores only frequencies of sorted
language sets, never repository identities or ordering. `/api/stats` omits that
internal histogram and returns computed `languageRows`. Old last-good snapshots
remain visible during the upgrade; missing counts show `— repos` until a successful
refresh, rather than an invented zero.

Code size in decimal B/KB/MB/GB now appears below the GitHub bar; coding hours
and minutes appear below the WakaTime bar. Exact totals remain in the source JSON.

Related languages are grouped before selection:

- C/C++: C, C++, CPP and Makefile.
- JavaScript/TypeScript: JavaScript, TypeScript, JS/TS and JSX/TSX.
- Markdown/Text: Markdown, Text, plain text, MDX and reStructuredText.
- Python: Python, Cython, Jupyter Notebook and IPython.
- JSON/YAML/TOML/INI: JSON/JSONC, XML/XSLT, YAML, TOML, INI and explicit
  JSON-based configuration labels such as TSConfig.
- HTML/CSS: HTML, Vue, Svelte, Astro and web-template labels including
  Jade/Pug, Jinja, Mustache, Handlebars, EJS, Twig, Smarty and Go Template;
  styles including CSS, SCSS, Sass, Less, Stylus and PostCSS.
  JavaScript/TypeScript stays separate because it also covers server-side code.
- Shaders: GLSL, HLSL, Metal, ShaderLab, WGSL and Cg.
- Shell: Shell, Bash, Zsh, Sh, Fish, Ksh, Dash and Awk.
- Objective-C: Objective-C and Objective-C++.
- SQL: SQL, MySQL, PLpgSQL, PLSQL, TSQL/Transact-SQL and SQLPL.
- Other explicit aliases include VimL/Vim Script, Perl6/Raku,
  GDScript3/GDScript, ActionScript3/ActionScript and Nginx labels.

These are intentionally broad display categories, not claims that their syntax
or runtimes are identical; Notebook content is included in Python by this
profile's display policy. WakaTime shares use precise summed seconds divided by
the original full-source total, avoiding accumulated upstream percentage
rounding. GitHub shares use bytes divided by the original total bytes. Neither
percentage denominator is restricted to the selected groups. Raw source JSON/cache retains every
original language, value and upstream percentage. The synthetic Others has a
GitHub remainder share, unlike WakaTime's original unclassified Other alone.

## Percentages and bar scales

Displayed percentages are balanced using integer tenths (SVG) or hundredths
(preview table): Others is100% minus the displayed named shares, so each column
adds to exactly100% at its shown precision. In the rare case that rounding the
named rows alone exceeds100%, excess units are removed from the most rounded-up
rows before calculating Others. This only affects displayed percentages;
exact seconds, bytes, selection and source/cache values are unchanged.
Missing, empty or incomplete source shares are never filled to100%.

The two bar columns scale independently. Each full track represents that column's
largest displayed **unrounded** source share (including Others), rounded upward
to the next 10 percentage points. For example, a 39.7% maximum uses
`GITHUB · CODE BYTES · SCALE 40%`, while a 42.1% maximum uses scale 50%. At scale 40%, a 20% language
occupies half the track. WakaTime has its own scale and denominator. The displayed
row percentages are the true full-source shares, not the normalized bar lengths.
Empty sources have scale 0%; unavailable sources show a dash.

The right SVG column heading is `WAKATIME · CODE TIME · SCALE …`, paired with
`GITHUB · CODE BYTES · SCALE …` on the left. Its tooltip shows the saved WakaTime span as
`Recent 12 years`, `Recent 6 months` or `Recent 7 days`. Years
and months are rounded to the nearest whole unit. Precise source dates are
preferred; a published `since` date uses the saved source-success timestamp as
its cutoff, so a stale card does not keep aging. Fixed7/30-day ranges have
fallback labels; an unknown all-time span uses `Recent activity` in the tooltip.

## Refresh times and source state

The footer lists GitHub, WakaTime, Codex, OpenRouter and Anthropic API in that order, omitting
usage services that are not enabled. Each age refers to that source's last
successful observation. Codex imports retain their original observation time;
rendering a card does not refresh them. Source windows remain independent.

Ages omit zero hour/minute units and say `just now` below one minute. The footer
uses compact forms such as `2h 8m ago` when needed and wraps to additional lines
rather than shrinking the text. A configured source without an observation says
`not refreshed`. The right-hand GitHub mark and
`Power by github.com/Leask/CodeStats` link to this repository.

The builder keeps five built-in provider cards visible, including `Not enabled`
for unconfigured Codex/OpenRouter/Anthropic integrations. GitHub's repository and activity
statuses appear within the same provider card. `fresh` means a current-format
snapshot is within the configured freshness window, not that every possible
historical event was collected. `stale` means saved data is due for refresh or
requires a current collection format; `unavailable` means no usable snapshot.
The builder also shows errors, absolute times and detailed reporting scope.

## Bundled icons

Language logos use a bundled subset of [Simple Icons](https://simpleicons.org/)
16.36.0. The SVG card and HTML table embed the same local vector paths; no
icon CDN, webfont or extra runtime package is required. Grouped families use
a representative logo (JavaScript, C++, HTML5 or JSON); SQL, Shaders, Others
and unknown languages use neutral local symbols. Artwork provenance, original
licenses and source links are in [third-party notices](../third_party/simple-icons/NOTICE.md).
Long serialized path lines in icon-data.json preserve upstream vector data.

Provider logos use a bundled [Lobe Icons](../third_party/lobe-icons/NOTICE.md)
subset. UI symbols use bundled Octicons. These assets require no external icon
requests and retain their own notices and licenses.

## GitHub activity and rank

In full token mode, activity includes lifetime authored/merged PRs and issues, search-indexed
authored commits, distinct non-self-authored PRs reviewed/commented and issues
commented, discussions started and accepted answers. Annual contribution
calendar totals are collected for every reported contribution year, with
restricted contributions included once. Recent review contributions and recent
contributed repositories use GitHub's recent-year semantics; lifetime contributed
repositories are deduplicated across years for commits, issues, PRs, PR reviews
and repository creation, including review-only repositories and, by default,
currently owned repositories. Saturated repository lists are split into smaller
date intervals and unresolved truncation fails closed.

Commit search covers indexed default branches. Calendar contributions follow
GitHub eligibility rules and differ from commit counts. Search scope limits,
deleted records and lost access prevent claiming every historical action.
Counts and periods remain explicitly labeled. The upper-right trophy block
shows the reference project's weighted rank estimate, using lifetime indexed
commits, authored PRs/issues, recent review contributions, owned stars and
followers. It is a heuristic percentile rather than a measured global leaderboard.
Levels and thresholds match the reference: S (top1%), A+ (top12.5%), A, A-, B+,
B, B-, C+, C. Repository count and calendar contributions do not affect this rank.
The avatar has a thin border at its edge using the reference-style two-circle
ring: a full, dim track underneath
an arc showing `100 - percentile`, starting at the top and moving clockwise.
The arc animates once and respects reduced-motion preferences. Without rank data,
only the dim track is shown; `header=false` also hides the avatar and ring.
## Card layout and typography

The card uses 32px outer padding. The avatar's outer border aligns with the
upper-right trophy row; the trophy and project credit share the right edge.
When the profile header is hidden, its rank lane retains a 20px gap before the
overview numbers. Section content uses shared 20px padding.

Card typography uses three fixed sizes: 27px for the name and metric values,
13px for language/provider names, and 11px for labels, descriptions and footer text.
Long names are shortened and large metric values use compact notation, with
the full counts retained in tooltips. Long footers wrap instead of shrinking.
The public profile bio takes precedence over a public, unexpired status message;
organization-only status messages are never published. Small public GitHub avatars
are embedded in the cached SVG data, so README images need no nested remote fetch.
See [the collection implementation and permission notes](github-collection-plan.md).

## WakaTime ranges

WakaTime **all-time** is the default. Named profiles first request the exact range
anonymously. A complete public result wins, even if OAuth is configured. An
inaccessible, pending or invalid result can use a same-owner OAuth fallback for
the **same range**; no all-time/7-day/30-day substitution or payload mixing occurs.
Rate limiting and transient/redirect failures retain last-good data.

OAuth needs `read_stats.languages` (or `read_stats`) plus `email` for the
`/users/current` ownership check; its raw profile/email payload is discarded.
Only the resolved account identity is retained. Token-only
configuration resolves that identity before choosing the cache namespace.
Public URL profiles cannot borrow this token. Public and OAuth settings may
differ in timeout, tracked activity and visibility; the public result is not
inherently richer and CodeStats does not choose whichever total is larger.
Heartbeat API keys are not used for read access. The API's `rangeLabel`,
`includesToday` and supplied start/end values are preserved; missing dates are
not invented. [WakaTime API definitions](https://wakatime.com/developers).
