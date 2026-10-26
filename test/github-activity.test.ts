import { describe, expect, it } from 'vitest';
import { fetchGitHubActivity } from '../src/github-activity';
import type { Fetcher } from '../src/types';

const env = {
    GITHUB_USERNAME: 'Leask',
    GITHUB_TOKEN: 'fixture-only-token',
    GITHUB_VISIBILITY: 'all' as const,
    GITHUB_INCLUDE_OWN_CONTRIBUTIONS: 'false',
};
const NOW = Date.parse('2026-10-25T12:34:56Z');
const headers = { 'x-oauth-scopes': 'repo, user, admin:org' };
const response = (data: unknown) => Response.json({ data }, { headers });

const repository = (id: string, owner = 'external-owner') => ({
    repository: { id, owner: { id: owner } },
});
const creations = (
    nodes: unknown[] = [], totalCount = nodes.length,
    hasNextPage = false, endCursor: string | null = null,
) => ({ nodes, totalCount, pageInfo: { hasNextPage, endCursor } });
const collection = (
    commits: unknown[] = [], issues: unknown[] = [], prs: unknown[] = [],
    created = creations(), reviews: unknown[] = [],
) => ({
    commitContributionsByRepository: commits,
    issueContributionsByRepository: issues,
    pullRequestContributionsByRepository: prs,
    pullRequestReviewContributionsByRepository: reviews,
    repositoryContributions: created,
});

function profile(years = [2024, 2025]) {
    return {
        viewer: {
            id: 'account-id', login: 'Leask',
            organizations: { totalCount: 17 },
        },
        user: {
            id: 'account-id', login: 'Leask',
            createdAt: '2020-01-02T00:00:00Z',
            repositoryDiscussions: { totalCount: 6 },
            repositoryDiscussionComments: { totalCount: 2 },
            contributionsCollection: { contributionYears: years },
            recent: { totalPullRequestReviewContributions: 8 },
            repositoriesContributedTo: { totalCount: 11 },
        },
    };
}

interface Request {
    url: URL;
    query: string;
    variables: Record<string, unknown>;
}

function ranges(query: string) {
    return [...query.matchAll(/range_(\d+):\s*contributionsCollection\(from: "([^"]+)",\s*to: "([^"]+)"\)/g)]
        .map(match => ({ key: `range_${match[1]}`, from: match[2], to: match[3] }));
}

function fixture(
    handle?: (request: Request) => Response | undefined,
    initial = profile(),
) {
    const requests: Request[] = [];
    const fetcher = (async (input, init) => {
        const body = JSON.parse(String(init?.body ?? '{}'));
        const request = {
            url: new URL(String(input)),
            query: String(body.query ?? ''),
            variables: body.variables ?? {},
        };
        requests.push(request);
        const custom = handle?.(request);
        if (custom) return custom;
        if (request.query.includes('query ActivityProfile')) {
            return response(initial);
        }
        if (request.query.includes('query ActivityCalendar')) {
            return response({ user: Object.fromEntries(ranges(request.query)
                .map(range => [range.key, {
                    contributionCalendar: {
                        totalContributions: range.from.startsWith('2024') ? 10 : 20,
                    },
                    restrictedContributionsCount: 3,
                }])) });
        }
        if (request.query.includes('query ActivityRepositories')) {
            return response({ user: Object.fromEntries(ranges(request.query)
                .map(range => [range.key, collection()])) });
        }
        if (request.url.pathname.startsWith('/search/')) {
            const search = request.url.searchParams.get('q') ?? '';
            const total = request.url.pathname.endsWith('/commits') ? 500
                : search.startsWith('reviewed-by:') ? 5
                : search.endsWith('type:pr') ? 7 : 9;
            return Response.json({ total_count: total, incomplete_results: false }, {
                headers,
            });
        }
        throw new Error('Unexpected fixture request.');
    }) as Fetcher;
    return { fetcher, requests };
}

describe('GitHub personal activity collector', () => {
    it('can include owned repositories using the native aggregate option', async () => {
        const { fetcher, requests } = fixture(request => {
            if (!request.query.includes('query ActivityRepositories')) return;
            return response({ user: Object.fromEntries(ranges(request.query)
                .map(range => [range.key, collection([
                    repository('own', 'account-id'), repository('external'),
                ])])) });
        });
        const data = await fetchGitHubActivity({ ...env,
            GITHUB_INCLUDE_OWN_CONTRIBUTIONS: 'true' }, fetcher, NOW);
        expect(data.allTimeContributedRepositories).toBe(2);
        expect(data.includesOwnRepositories).toBe(true);
        expect(requests[0].variables.includeOwn).toBe(true);
        expect(data.scope).toContain('including currently owned');
        expect(JSON.stringify(requests)).not.toMatch(/history\(|additions|deletions/);
    });

    it('collects scoped aggregates without returning private identities', async () => {
        const { fetcher, requests } = fixture(request => {
            if (!request.query.includes('query ActivityRepositories')) return;
            const entries = ranges(request.query).map(range => [range.key,
                collection([
                    repository('private-repository-id'),
                    repository('owned-private-id', 'account-id'),
                ], [repository('private-repository-id')], [repository('other-id')])]);
            return response({ user: Object.fromEntries(entries) });
        });
        const data = await fetchGitHubActivity(env, fetcher, NOW);
        expect(data).toMatchObject({
            collectionVersion: 3,
            username: 'Leask', visibility: 'all', commits: 500,
            pullRequestsCommented: 7, pullRequestsReviewed: 5,
            issuesCommented: 9, discussionsStarted: 6,
            discussionsAnswered: 2, reviewContributions: 8,
            contributedRepositories: 11, allTimeContributedRepositories: 2,
            allTimeContributions: 30, organizationCount: 17,
            recentFrom: '2025-10-25T12:34:56Z',
            recentTo: '2026-10-25T12:34:56Z',
        });
        expect(data.contributionsByYear).toEqual([
            { year: 2024, contributions: 10 },
            { year: 2025, contributions: 20 },
        ]);
        const serialized = JSON.stringify(data);
        expect(serialized).not.toContain('private-repository-id');
        expect(serialized).not.toContain('account-id');
        expect(serialized).not.toContain(env.GITHUB_TOKEN);
        expect(data.scope).toContain('restricted counts are included once');
        const searches = requests.filter(request => request.url.pathname
            .startsWith('/search/')).map(request => request.url.searchParams.get('q'));
        expect(searches).toEqual([
            'author:Leask',
            'commenter:Leask -author:Leask type:pr',
            'reviewed-by:Leask -author:Leask type:pr',
            'commenter:Leask -author:Leask type:issue',
        ]);
        expect(data.allTimeContributions).toBe(30);
    });

    it('uses disjoint UTC calendar years including leap day and bounds this year', async () => {
        const { fetcher, requests } = fixture(undefined, profile([2024, 2026]));
        await fetchGitHubActivity(env, fetcher, NOW);
        const calendar = requests.find(request => request.query
            .includes('query ActivityCalendar'))!;
        expect(ranges(calendar.query)).toEqual([
            { key: 'range_0', from: '2024-01-01T00:00:00Z', to: '2024-12-31T23:59:59Z' },
            { key: 'range_1', from: '2026-01-01T00:00:00Z', to: '2026-10-25T12:34:56Z' },
        ]);
        const leap = ranges(calendar.query)[0];
        expect((Date.parse(leap.to) - Date.parse(leap.from) + 1000)
            / 86_400_000).toBe(366);
    });

    it('includes review-only repositories and deduplicates them across years and types', async () => {
        const { fetcher, requests } = fixture(request => {
            if (!request.query.includes('query ActivityRepositories')) return;
            return response({ user: Object.fromEntries(ranges(request.query)
                .map(range => [range.key, collection([
                    repository('also-committed'),
                ], [], [], creations(), [
                    repository('also-committed'),
                    repository('review-only'),
                    repository('own-review', 'account-id'),
                ])])) });
        });
        const data = await fetchGitHubActivity(env, fetcher, NOW);
        expect(data.allTimeContributedRepositories).toBe(2);
        expect(data.scope).toContain('PR, review and repository creation');
        expect(JSON.stringify(data)).not.toContain('review-only');
        const initial = requests.find(request => request.query
            .includes('query ActivityProfile'))!;
        expect(initial.query).toContain('PULL_REQUEST_REVIEW');
    });

    it.each(['commits', 'reviews'] as const)(
        'splits saturated %s repository lists and deduplicates child ranges',
        async kind => {
            const saturated = Array.from({ length: 100 }, (_, index) =>
                repository(`discard-parent-${index}`));
            const parentCollection = kind === 'commits'
                ? collection(saturated)
                : collection([], [], [], creations(), saturated);
            const { fetcher, requests } = fixture(request => {
                if (!request.query.includes('query ActivityRepositories')) return;
                const entries = ranges(request.query).map(range => [range.key,
                    range.from === '2024-01-01T00:00:00Z'
                        && range.to === '2024-12-31T23:59:59Z'
                        ? parentCollection
                        : collection([repository('same-id')], [repository('second-id')])]);
                return response({ user: Object.fromEntries(entries) });
            }, profile([2024]));
            const data = await fetchGitHubActivity(env, fetcher, NOW);
            expect(data.allTimeContributedRepositories).toBe(2);
            const calls = requests.filter(request => request.query
                .includes('query ActivityRepositories'));
            expect(calls).toHaveLength(2);
            const children = ranges(calls[1].query);
            expect(Date.parse(children[0].to) + 1000).toBe(Date.parse(children[1].from));
            expect(children[0].from).toBe('2024-01-01T00:00:00Z');
            expect(children[1].to).toBe('2024-12-31T23:59:59Z');
        },
    );

    it.each(['commits', 'reviews'] as const)(
        'refuses saturated single days for %s rather than accepting truncation',
        async kind => {
            const { fetcher } = fixture(request => {
                if (!request.query.includes('query ActivityRepositories')) return;
                const saturated = Array.from(
                    { length: 100 }, (_, index) => repository(`private-${index}`),
                );
                return response({ user: { range_0: kind === 'commits'
                    ? collection(saturated)
                    : collection([], [], [], creations(), saturated) } });
            }, profile([2026]));
            await expect(fetchGitHubActivity(env, fetcher,
                Date.parse('2026-01-01T23:59:59Z'))).rejects.toThrow('daily repository limit');
        },
    );
    it('paginates repository creations and excludes currently owned repositories', async () => {
        const { fetcher, requests } = fixture(request => {
            if (request.query.includes('query ActivityRepositories')) {
                return response({ user: { range_0: collection([], [], [], creations(
                    [repository('transferred-id')], 2, true, 'next-creation',
                )) } });
            }
            if (request.query.includes('query ActivityCreatedRepositories')) {
                expect(request.variables.after).toBe('next-creation');
                return response({ user: { contributionsCollection: {
                    repositoryContributions: creations([
                        repository('owned-id', 'account-id'),
                    ], 2),
                } } });
            }
        }, profile([2025]));
        const data = await fetchGitHubActivity(env, fetcher, NOW);
        expect(data.allTimeContributedRepositories).toBe(1);
        expect(requests.some(request => request.query
            .includes('query ActivityCreatedRepositories'))).toBe(true);
    });

    it('rejects incomplete repository creation pagination', async () => {
        const { fetcher } = fixture(request => {
            if (!request.query.includes('query ActivityRepositories')) return;
            return response({ user: { range_0: collection([], [], [],
                creations([repository('hidden-id')], 2)) } });
        }, profile([2025]));
        await expect(fetchGitHubActivity(env, fetcher, NOW))
            .rejects.toThrow('activity pagination is incomplete');
    });

    it('rejects repeated creation cursors without exposing repository IDs', async () => {
        const { fetcher } = fixture(request => {
            if (request.query.includes('query ActivityRepositories')) {
                return response({ user: { range_0: collection([], [], [],
                    creations([repository('private-first')], 3, true, 'repeat')) } });
            }
            if (request.query.includes('query ActivityCreatedRepositories')) {
                return response({ user: { contributionsCollection: {
                    repositoryContributions: creations([
                        repository('private-second'),
                    ], 3, true, 'repeat'),
                } } });
            }
        }, profile([2025]));
        await expect(fetchGitHubActivity(env, fetcher, NOW))
            .rejects.toThrow('GitHub repeated an activity cursor.');
    });

    it.each([true, undefined])('rejects incomplete search flag %s', async flag => {
        const { fetcher } = fixture(request => request.url.pathname
            .startsWith('/search/') ? Response.json({
                total_count: 200, incomplete_results: flag,
            }, { headers }) : undefined);
        await expect(fetchGitHubActivity(env, fetcher, NOW))
            .rejects.toThrow('incomplete activity');
    });

    it('rejects partial GraphQL data and never exports the error body', async () => {
        const { fetcher } = fixture(() => Response.json({
            data: profile(), errors: [{ message: 'private-project secret-detail' }],
        }, { headers }));
        await expect(fetchGitHubActivity(env, fetcher, NOW))
            .rejects.toThrow('GitHub GraphQL returned partial or failed data.');
    });

    it.each(['repo', 'repo,read:user', 'user,read:org', ''])
        ('requires all private activity capabilities for scopes %s', async scopes => {
            const { fetcher, requests } = fixture(() => Response.json({ data: profile() }, {
                headers: { 'x-oauth-scopes': scopes },
            }));
            await expect(fetchGitHubActivity(env, fetcher, NOW))
                .rejects.toThrow('PAT/OAuth scopes');
            expect(requests).toHaveLength(1);
        });

    it('rejects mismatched token identity before collecting activity', async () => {
        const initial = profile();
        initial.viewer.login = 'SomebodyElse';
        const { fetcher, requests } = fixture(undefined, initial);
        await expect(fetchGitHubActivity(env, fetcher, NOW))
            .rejects.toThrow('must belong to the configured account');
        expect(requests).toHaveLength(1);
    });

    it('rejects SSO partial results even when HTTP succeeds', async () => {
        const { fetcher } = fixture(() => Response.json({ data: profile() }, {
            headers: { ...headers, 'x-github-sso': 'partial-results; organizations=123' },
        }));
        await expect(fetchGitHubActivity(env, fetcher, NOW))
            .rejects.toThrow('SSO authorization is incomplete');
    });

    it('leaves default public-only activity unavailable without making a request', async () => {
        const { fetcher, requests } = fixture();
        await expect(fetchGitHubActivity({ ...env, GITHUB_VISIBILITY: undefined },
            fetcher, NOW)).rejects.toThrow('public-only activity is unavailable');
        expect(requests).toHaveLength(0);
    });

    it('accepts genuine zero activity without inventing a contribution year', async () => {
        const initial = profile([]);
        initial.viewer.organizations.totalCount = 0;
        initial.user.repositoryDiscussions.totalCount = 0;
        initial.user.repositoryDiscussionComments.totalCount = 0;
        initial.user.recent.totalPullRequestReviewContributions = 0;
        initial.user.repositoriesContributedTo.totalCount = 0;
        const { fetcher } = fixture(request => request.url.pathname
            .startsWith('/search/') ? Response.json({
                total_count: 0, incomplete_results: false,
            }, { headers }) : undefined, initial);
        const data = await fetchGitHubActivity(env, fetcher, () => NOW);
        expect(data).toMatchObject({
            allTimeContributions: 0, allTimeContributedRepositories: 0,
            contributionsByYear: [], commits: 0, organizationCount: 0,
            discussionsStarted: 0, discussionsAnswered: 0,
            reviewContributions: 0, contributedRepositories: 0,
            allTimeFrom: '2020-01-02T00:00:00Z',
        });
    });

    it('fails closed within the shared request budget for pathological saturation', async () => {
        const { fetcher, requests } = fixture(request => {
            if (!request.query.includes('query ActivityRepositories')) return;
            return response({ user: Object.fromEntries(ranges(request.query)
                .map(range => [range.key, collection(Array.from({ length: 100 },
                    (_, index) => repository(`opaque-${index}`)))])) });
        }, profile([2024, 2025]));
        await expect(fetchGitHubActivity(env, fetcher, NOW))
            .rejects.toThrow(/request budget|daily repository limit/);
        expect(requests.length).toBeLessThanOrEqual(128);
    });
});
