# GitHub Stats Extended comparison

Reviewed2026-10-26. GitHub Stats Extended is a design reference, not a runtime
dependency. CodeStats requests official GitHub and WakaTime APIs directly.

## Authentication and private data

The reference's [login constants](https://github.com/stats-organization/github-stats-extended/blob/master/apps/frontend/src/constants.ts)
request no additional scope for public login and `user,repo` for private login.
Its [authentication handler](https://github.com/stats-organization/github-stats-extended/blob/master/apps/backend/src/users.ts)
exchanges the OAuth code for an access token and stores it for that user.
The [retry layer](https://github.com/stats-organization/github-stats-extended/blob/master/packages/core/src/common/retryer.ts)
uses this token instead of the deployment's fallback PAT pool.
Private statistics use the same API calls authorized by this token.

CodeStats starts at that last step: an existing server-side PAT or OAuth access
token in GITHUB_TOKEN. No multi-user login/database/token-pool layer is needed.
Use repo, read:user and read:org; inherited user includes read:user. The extra
organization scope supports the organization-membership count. Organization SSO
and access policies still apply. A token cannot exceed its user's access, or
recover deleted/inaccessible repositories. Only aggregates reach public output.

## Metrics and parameters

| Metric | Reference | CodeStats default |
| --- | --- | --- |
| Commits | Current-year contributions, or include_all_commits=true for REST Search total_count, per_page=1 | Lifetime indexed Search count; rejects incomplete_results |
| PRs/merged PRs/issues | GraphQL totals; optional Search filters | Aggregate GraphQL Search totals across token-visible repositories |
| PRs reviewed/commented, issues commented | Search totals for distinct non-self-authored items | Same queries/definition |
| Discussions/answers | GraphQL totalCount/onlyAnswers | Same, always enabled |
| Reviews | Recent contributionsCollection | Explicit recent-year interval, distinct from lifetime reviewed PR count |
| Contributions | Calendar totals for all contributionYears when enabled | All reported years, annual table and sum; restricted count not added twice |
| all_time_contribs | Distinct repos from annual summaries,100/type; split saturated intervals | Same summary approach, plus review-only repos and complete creation pagination |
| Owned repos in contributed counts | contribs_include_own_repos=false default, supports true | GITHUB_INCLUDE_OWN_CONTRIBUTIONS=true; false matches reference default |
| Affiliations | role=OWNER default; supports OWNER,COLLABORATOR,ORGANIZATION_MEMBER | All three; GITHUB_REPOSITORY_AFFILIATIONS=OWNER narrows it |
| Languages | First100 repos, non-forks, first10 languages/repo |100 repos/page and100 languages/page, follow all remaining cursors |
| Fork content | Language query excludes forks | GITHUB_INCLUDE_FORKS=true; false reproduces exclusion; bytes include upstream authors |
| Stars | 100/page; FETCH_MULTI_PAGE_STARS accepts a page count or true for all starred pages | Sum owned repositories from all selected pages, including own forks when enabled; exclude organization/collaborator stars |
| Profile rank | Weighted CDF estimate from commits, PRs, issues, recent reviews, stars and followers | Same formula, thresholds and lifetime-commit normalization; uses existing saved aggregates |
| Language weighting | size_weight=1,count_weight=0 default; optional weighting | Raw bytes, matching those defaults |
| WakaTime | Official public stats API, profile's published range | Official all_time by default; optional read OAuth token |
| Cache | Card precomputation/caching and warming | Request-driven persistent last-good datasets, fresh6h/retry15m |

Repository pagination operates on whole API pages.201 repositories need one
profile/count query and three100-repository pages, not201 requests. Only a repo
with more than100 languages needs an extra language-page query.

Calendar years are batched30/request. Contributed-repository summaries use
10 date ranges/request and100 repositories/type. The reference allows up to400
ranges/request and adapts downward. Both split saturated date ranges; neither
needs to walk commits. CodeStats retains last-good data on timeout, rate limit,
incomplete pagination or other upstream failure.

No additions/deletions, per-author code attribution, pinned HEAD, SHA ledger,
history backfill queue or progress polling remains. Current language bytes include
other authors. Activity follows GitHub's indexing and contribution eligibility.

Primary sources: [stats fetcher](https://github.com/stats-organization/github-stats-extended/blob/master/packages/core/src/fetchers/stats.ts),
[stats queries](https://github.com/stats-organization/github-stats-extended/blob/master/packages/core/src/graphql/queries/stats.graphql),
[language query](https://github.com/stats-organization/github-stats-extended/blob/master/packages/core/src/graphql/queries/top-languages.graphql),
[private access and stars documentation](https://github.com/stats-organization/github-stats-extended/blob/master/apps/frontend/src/content/docs/docs/fork.md).
The rank formula adapts their calculateRank.ts at revision
d130fe21d880fef33060082dffbfaa1a15445b37; its MIT notice is preserved in
third_party/github-stats-extended. Collection is independently implemented.

## Acknowledgements

GitHub Stats Extended and its predecessor,
[GitHub Readme Stats](https://github.com/anuraghazra/github-readme-stats),
inspired CodeStats' design. Its collection/aggregation engine, persistent cache,
runtime adapters and SVG renderer were independently redeveloped. See the
[project acknowledgements](../README.md#acknowledgements) and retained third-party
notices for the reference rank formula and icon assets.
