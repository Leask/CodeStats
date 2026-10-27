# Statistics and display rules

[Back to CodeStats](../README.md) · [Reference comparison](github-collection-plan.md)

**WakaTime:** tracked coding seconds for the selected range. Sorting uses exact
seconds; display rounding is balanced as described below. The denominator
includes `Other`, so the total shown is `total_seconds_including_other_language`.
`Other` has no direct GitHub language equivalent; its time is included in the final Others remainder.

**GitHub:** current language bytes from GitHub's paginated repository connection.
By default, include all token-visible OWNER, COLLABORATOR and ORGANIZATION_MEMBER
repositories, including forks and archived repositories. These are whole-repository
bytes, including other authors' code. No commit history, additions/deletions,
authorship attribution, SHA ledger or background backfill is collected.

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

The default card and expanded table show nine named groups plus **Others**.
After grouping, selection alternates descending GitHub bytes and WakaTime
seconds, starting with GitHub and skipping duplicates and the upstream Other category, until nine groups
are selected. Those nine are displayed by descending WakaTime time. Others is
always last and sums every remaining group plus WakaTime's unclassified Other.
Both columns therefore represent the complete collected data, not just a top-N
subset. Display sorting changes order, not which groups are selected.

GitHub byte shares appear on the left and WakaTime shares on the right. Each
language subtitle shows its code size in decimal B/KB/MB/GB followed by coding
hours and minutes. Exact byte and second totals remain in the source JSON.

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
column is rescaled to the selected groups. Raw source JSON/cache retains every
original language, value and upstream percentage. The synthetic Others has a
GitHub remainder share, unlike WakaTime's original unclassified Other alone.

Displayed percentages are balanced using integer tenths (SVG) or hundredths
(preview table): Others is100% minus the displayed named shares, so each column
adds to exactly100% at its shown precision. In the rare case that rounding the
named rows alone exceeds100%, excess units are removed from the most rounded-up
rows before calculating Others. This only affects percentage display and bar
widths; exact seconds, bytes, selection and source/cache values are unchanged.
Missing, empty or incomplete source shares are never filled to100%.

The right SVG column heading shows the saved WakaTime span as
`WAKATIME · RECENT 12 YEARS`, `WAKATIME · RECENT 6 MONTHS` or
`WAKATIME · RECENT 7 DAYS`. Years
and months are rounded to the nearest whole unit. Precise source dates are
preferred; a published `since` date uses the saved source-success timestamp as
its cutoff, so a stale card does not keep aging. Fixed7/30-day ranges have
fallback labels; an unknown all-time span displays `WAKATIME · RECENT ACTIVITY`. The
GitHub column remains `GITHUB · CODE BYTES`.

The compact SVG footer shows a clock followed by `GitHub: 2 hr, 8 mins ago |
WakaTime: 4 hr, 58 mins ago`, based on each
last successful refresh at card-generation time. Missing refreshes say
`not refreshed`. The right-hand GitHub mark and `Power by
github.com/Leask/CodeStats` link to this repository. Absolute timestamps and
source semantics remain in accessible SVG metadata and preview details.

Language logos use a bundled subset of [Simple Icons](https://simpleicons.org/)
16.36.0. The SVG card and HTML table embed the same local vector paths; no
icon CDN, webfont or extra runtime package is required. Grouped families use
a representative logo (JavaScript, C++, HTML5 or JSON); SQL, Shaders, Others
and unknown languages use neutral local symbols. Artwork provenance, original
licenses and source links are in [third-party notices](../third_party/simple-icons/NOTICE.md).
Long serialized path lines in icon-data.json preserve upstream vector data.

Activity includes lifetime authored/merged PRs and issues, search-indexed
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
Counts and periods remain explicitly labeled. The profile header additionally
shows the reference project's weighted rank estimate, using lifetime indexed
commits, authored PRs/issues, recent review contributions, owned stars and
followers. It is a heuristic percentile rather than a measured global leaderboard.
Levels and thresholds match the reference: S (top1%), A+ (top12.5%), A, A-, B+,
B, B-, C+, C. Repository count and calendar contributions do not affect this rank.
The public profile bio takes precedence over a public, unexpired status message;
organization-only status messages are never published. Small public GitHub avatars
are embedded in the cached SVG data, so README images need no nested remote fetch.
See [the collection implementation and permission notes](github-collection-plan.md).

WakaTime **all-time** is the default. If a different range is not published
or authorized, it remains unavailable without substituting all-time data. For other/private ranges, configure an optional
server-side `WAKATIME_TOKEN` OAuth token with `read_stats.languages`. Heartbeat
API keys are not used for read access. The API's `rangeLabel`, `includesToday`
and any supplied start/end values are preserved; missing dates are not invented.
