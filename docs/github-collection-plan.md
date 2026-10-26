# Direct GitHub statistics: coverage and authorization

The target, confirmed on 2026-10-25, is the configured user's own contributions
across public, private, internal, organization and external open-source
repositories. Publish aggregate statistics, without private repository names,
paths, issues, discussion content, or credentials. Continue using WakaTime
all-time data and persistent last-successful snapshots.

The direct collectors are implemented in `src/github.ts` and
`src/github-activity.ts`, with a shared official-API client in `src/github-api.ts`.
The local configuration now uses `GITHUB_VISIBILITY=all`. Only aggregate counts,
language names/bytes and calendar totals leave the collectors. Repository
identities used for lifetime deduplication are transient and never cached or
returned. The historical permission audit below is retained as the earlier
baseline; it does not describe the replacement token.

The replacement token was verified as `Leask`, with inherited repository,
profile and organization read capabilities. The new probe returned all 17
organization memberships and 21 private commit-contribution repositories;
recent-year restricted contributions changed from 6,801 to zero. The supplied
token is configured only in ignored local `.dev.vars` mode0600, and does not
appear in frontend code, Git or diagnostic output.

Direct live collection succeeded: 383 owned repositories (197 public/186
private), 301 non-fork repositories, 63 languages; personal activity returned
47,250 indexed authored commits, 46,965 calendar contributions over 17 years,
65 distinct non-self-authored PRs reviewed, and 148 lifetime external contributed
repositories. These are observed 2026-10-25 values, not fixed sample data. The
Worker persists its own independent last-good snapshots; there is no upstream
GitHub Stats Extended service dependency. Online deployment remains deferred
until local review.

## Historical audit of the earlier token

Observed at approximately 2026-10-25 20:17 UTC, with the token supplied for this
task. Values are time-bound observations, not permanent inventory.

| Check | Observed result |
| --- | --- |
| `GET /user` | HTTP 200, authenticated as `Leask` |
| Granted scopes header | `repo` |
| Owned public repository count | 197 |
| Owned private repository count | 186 |
| Repository connection with OWNER/COLLABORATOR/ORGANIZATION_MEMBER affiliations | 428 currently visible repositories |
| `GET /user/memberships/orgs?state=active&per_page=100` | HTTP 200, 17 memberships, no next page |
| GraphQL organization connection total | 5; this is not sufficient proof of complete membership discovery |
| GraphQL `Organization.viewerIsAMember` | `INSUFFICIENT_SCOPES`, explicitly requires `read:org` |
| Public and anonymous restricted contribution-calendar total, recent year | 9,541 |
| Anonymous restricted contributions within that total | 6,801 |
| Private commit search | HTTP 200, `incomplete_results: false`, 22,485 indexed commits |
| SSO header on membership and private-commit search requests | No challenge or partial-results header observed |

The calendar already includes its restricted count: never add 6,801 to 9,541.
Private repository readability does not establish that private contribution
breakdowns are available. No private commit messages or repository identities
were exported in the audit. These probes do not prove that every organization
or historically accessible repository is covered.

## Convenient single-token configuration

For this personal, multi-organization collector, use the existing classic PAT
with these scopes:

| Scope | Reason |
| --- | --- |
| `repo` | Read the public/private repository data the user can access. Classic PATs bundle write capabilities in this scope; the collector will use read operations only. |
| `read:user` | Include private/internal contributions in GraphQL `ContributionsCollection`. |
| `read:org` | Discover private organization/team membership and validate organization coverage. It does not itself grant repository access. |

The first two cover the contribution/repository data; `read:org` supports the
requested organization coverage checks. `admin:org`, `workflow`, `delete_repo`,
email and package permissions are unnecessary for this collector.

Open [classic token settings](https://github.com/settings/tokens), select the
existing token, preserve `repo`, enable `read:user` and `read:org`, then save.
Editing scopes normally retains the token value. If an organization uses SAML,
use **Configure SSO → Authorize** for that organization after saving: scope edits
can revoke a prior SSO authorization. Organization policy, membership and
enterprise IP allowlists still apply.

Do not assume HTTP 200 means complete coverage. An
`X-GitHub-SSO: partial-results` header means some organizations were omitted.
Verify the granted scopes, identity, organization access and private contribution
breakdowns again after the change, without printing the credential.

Fine-grained tokens offer narrower read permissions, but each has one resource
owner. Covering a personal account and multiple organizations needs multiple
tokens or an app installation design, with deduplication and coverage tracking.
For the requested single-token setup, classic PAT is simpler. No token can read
private repositories the user cannot access or recover deleted history.

References: [scope definitions](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps#available-scopes),
[private contribution requirement](https://docs.github.com/en/graphql/reference/users#contributionscollection),
[token owner limitations](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens-limitations),
[SSO authorization](https://docs.github.com/en/enterprise-cloud@latest/authentication/authenticating-with-single-sign-on/authorizing-a-personal-access-token-for-use-with-single-sign-on),
[successful but partial SSO responses](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api#personal-access-tokens-and-saml-sso).

## Independent collection design

The existing core collector already uses GitHub GraphQL directly. The additional
metrics can also come from official GitHub APIs, with no request to the GitHub
Stats Extended service and no dependency on its package.

| Metric | Direct collection and meaning |
| --- | --- |
| Stars, forks and language bytes | Fully paginate selected owned repositories and nested languages. Include private repositories for the new scope. These are current whole-repository bytes, not personal authored bytes. |
| Authored PRs/issues, merged PRs | Global user-author searches over currently token-visible repositories; no owner/org restriction. Merge percentage uses all authored PRs as denominator. |
| PRs/issues commented | Global `commenter:USER -author:USER` searches, separated by PR/issue. Count matching objects, not comment events. |
| PRs reviewed | Global `reviewed-by:USER -author:USER type:pr` search; distinct matching PRs. |
| Authored commits | Global REST commit search `author:USER`, reading `total_count` only when `incomplete_results` is false. This is indexed default-branch history, not every Git commit. |
| Discussions started | User `repositoryDiscussions.totalCount`. |
| Discussions answered | User `repositoryDiscussionComments(onlyAnswers:true).totalCount`; authored comments marked as accepted answers. |
| Recent review contributions | Explicit one-year `contributionsCollection` interval; not every submitted review event. |
| All-time contribution calendar | Read `contributionYears`, query each UTC calendar year with explicit, nonoverlapping bounds, and sum `contributionCalendar.totalContributions`. Preserve annual values; do not add restricted counts again. |
| Repositories contributed to | Recent-year repository connection includes commits, issues, PRs, PR reviews and repository creation. Lifetime deduplicates those five contribution types across years, including review-only external repositories. Saturated lists require smaller intervals or complete pagination; otherwise retain the last-good value with a coverage error. |

Organization and external contributions follow the user's identity, without an
`owner:Leask` restriction. A whole organization repository's code must not be
presented as the user's authored code. The initial language-byte definition can
remain owned repositories, with activities spanning all visible repositories.

Keep lifetime, recent-year, calendar and current-content metrics explicitly
labeled. GitHub's own contribution eligibility and search indexing limits still
apply. The scope should read **currently token-visible personal activity**, not
an unconditional promise of every historical action.

## Cache and acceptance boundaries

- Keep WakaTime all-time and its last-good cache unchanged.
- Give core GitHub data and extended activity separate last-good records so a
  failed history/review refresh cannot erase languages or WakaTime.
- Use different GitHub cache keys for public-only and token-visible scopes.
  Do not reuse public records as accepted private-inclusive totals, or display
  private-inclusive records after switching back to public scope.
- Apply bounded time/request budgets, complete pagination, schema/count checks,
  rate-limit/reset cooldowns, GraphQL partial-error rejection and SSO checks.
- Preserve successful values and their original timestamps through outages.
  Missing permissions, incomplete search results and truncated history are
  coverage gaps, not confirmed zeros.
- Store credentials only as ignored local server secrets or Cloudflare Worker
  secrets. Return aggregate data and safe status metadata to the browser.
- Verify real API results, independent cache failure/restart behavior, SVG
  rendering and local page interaction before online migration. No deployment
  or profile README replacement is included in this permission-review step.

## Upstream research and differences

Inspected GitHub Stats Extended at
[`d130fe21d880fef33060082dffbfaa1a15445b37`](https://github.com/stats-organization/github-stats-extended/tree/d130fe21d880fef33060082dffbfaa1a15445b37).
Its [stats queries](https://github.com/stats-organization/github-stats-extended/blob/d130fe21d880fef33060082dffbfaa1a15445b37/packages/core/src/graphql/queries/stats.graphql),
[fetcher](https://github.com/stats-organization/github-stats-extended/blob/d130fe21d880fef33060082dffbfaa1a15445b37/packages/core/src/fetchers/stats.ts)
and [language query](https://github.com/stats-organization/github-stats-extended/blob/d130fe21d880fef33060082dffbfaa1a15445b37/packages/core/src/graphql/queries/top-languages.graphql)
establish that the data is available directly from GitHub.

Avoid copying its first-100-repository/first-10-language limit, normalization
after top-N truncation, optional-zero placeholders, ignored REST
`incomplete_results`, and mixtures of recent/lifetime periods. Its HTTP cache
and warming mechanism do not replace persistent last-successful snapshots.
Its rank is a fixed weighted formula, not a measured GitHub-wide percentile.

The upstream is MIT licensed. This research copies no implementation source;
any later substantial source adaptation must retain its required copyright and
permission notice. See the
[pinned license](https://github.com/stats-organization/github-stats-extended/blob/d130fe21d880fef33060082dffbfaa1a15445b37/LICENSE).
