import { describe, expect, it } from 'vitest';
import { fetchGitHub } from '../src/github';
import { fetchWakaTime } from '../src/wakatime';
import { UpstreamError } from '../src/errors';
import type { Fetcher } from '../src/types';

const pageInfo = (hasNextPage = false, endCursor: string | null = null) => ({
    hasNextPage, endCursor,
});
const edges = (name = 'TypeScript', size = 120) => [{
    size, node: { name, color: '#3178c6' },
}];
const repository = (id = 'repo-1') => ({
    id,
    isPrivate: false,
    isFork: false,
    owner: { login: 'Leask' },
    stargazerCount: 3,
    forkCount: 2,
    languages: { totalSize: 120, pageInfo: pageInfo(), edges: edges() },
});
const profile = {
    user: {
        login: 'Leask', name: 'Leask', followers: { totalCount: 50 },
        publicRepositories: { totalCount: 2 },
    },
    prs: { issueCount: 40 },
    merged: { issueCount: 30 },
    issues: { issueCount: 12 },
};
const repositories = (
    nodes: unknown[] = [repository()], totalCount = 1,
    hasNextPage = false, endCursor: string | null = null,
) => ({
    user: { repositories: {
        totalCount, pageInfo: pageInfo(hasNextPage, endCursor), nodes,
    } },
});
const json = (data: unknown) => Response.json({ data });
const privateJson = (data: unknown, scopes = 'repo') => Response.json({ data }, {
    headers: { 'x-oauth-scopes': scopes },
});
const allProfile = {
    ...profile,
    user: {
        ...profile.user,
        publicRepositories: { totalCount: 1 },
        privateRepositories: { totalCount: 1 },
        repositories: { totalCount: 2 },
    },
};
const allRepositories = (
    nodes: unknown[] = [repository()], totalCount = 1,
    hasNextPage = false, endCursor: string | null = null,
) => ({
    user: {
        login: 'Leask',
        ...repositories(nodes, totalCount, hasNextPage, endCursor).user,
    },
});

function sequence(responses: Response[]) {
    const requests: Array<{
        url: string;
        body: Record<string, unknown>;
        redirect: RequestInit['redirect'];
    }> = [];
    const fetcher = (async (input, init) => {
        requests.push({
            url: String(input),
            body: JSON.parse(String(init?.body ?? '{}')),
            redirect: init?.redirect,
        });
        const next = responses.shift();
        if (!next) {
            throw new Error('Unexpected extra upstream call.');
        }
        return next;
    }) as Fetcher;
    return { fetcher, requests };
}

const githubEnv = { GITHUB_USERNAME: 'Leask', GITHUB_TOKEN: 'fixture-only' };
const allGithubEnv = { ...githubEnv, GITHUB_VISIBILITY: 'all' as const };

describe('GitHub collector', () => {
    it('collects public profile fields with metrics and embeds the public avatar', async () => {
        const { fetcher, requests } = sequence([
            json({ ...profile, user: { ...profile.user, bio: 'Builds tools',
                avatarUrl: 'https://avatars.githubusercontent.com/u/123?s=128',
                status: { message: 'Working', organization: null, expiresAt: null } } }),
            new Response(new Uint8Array([137, 80, 78, 71]), {
                headers: { 'content-type': 'image/png' },
            }),
            json(repositories([repository(), repository('r-2')], 2)),
        ]);
        const data = await fetchGitHub(githubEnv, fetcher);
        expect(data).toMatchObject({ bio: 'Builds tools', profileStatus: 'Working',
            avatarDataUri: 'data:image/png;base64,iVBORw==', stars: 6 });
        expect(requests).toHaveLength(3);
        expect(requests[0].body.query).toContain('avatarUrl(size: 128)');
        expect(requests[0].body.query).toContain('organization { id }');
    });
    it('reads 201 repositories in three pages without traversing commits', async () => {
        const repos = Array.from({ length: 201 }, (_, i) => repository(`r-${i}`));
        const { fetcher, requests } = sequence([
            json({ ...profile, user: { ...profile.user,
                publicRepositories: { totalCount: 201 } } }),
            json(repositories(repos.slice(0, 100), 201, true, 'p2')),
            json(repositories(repos.slice(100, 200), 201, true, 'p3')),
            json(repositories(repos.slice(200), 201)),
        ]);
        const data = await fetchGitHub(githubEnv, fetcher);
        expect(data.analyzedRepositories).toBe(201);
        expect(data.totalBytes).toBe(201 * 120);
        expect(requests).toHaveLength(4);
        expect(JSON.stringify(requests)).not.toMatch(
            /defaultBranchRef|history\(|additions|deletions/,
        );
        expect(requests[1].body.query).toContain('repositories(first: 100');
        expect(requests[1].body.variables).toMatchObject({
            affiliations: ['COLLABORATOR', 'ORGANIZATION_MEMBER', 'OWNER'],
            isFork: null,
        });
    });

    it('includes fork bytes but avoids counting the upstream fork network', async () => {
        const { fetcher } = sequence([
            json(profile), json(repositories([
                repository(), { ...repository('fork'), isFork: true, forkCount: 999 },
            ], 2)),
        ]);
        const data = await fetchGitHub(githubEnv, fetcher);
        expect(data).toMatchObject({ analyzedForks: 1, totalBytes: 240,
            stars: 6, forks: 2 });
    });

    it('counts only owned stars without narrowing repository or language scope', async () => {
        const nodes = [
            { ...repository('owned'), owner: { login: 'leask' },
                stargazerCount: 10 },
            { ...repository('owned-fork'), isFork: true, isPrivate: true,
                stargazerCount: 2, forkCount: 999 },
            { ...repository('organization'), owner: { login: 'private-org' },
                isPrivate: true, stargazerCount: 10_000 },
            { ...repository('collaboration'), owner: { login: 'other-user' },
                stargazerCount: 5_000 },
        ];
        const { fetcher, requests } = sequence([
            privateJson({ ...allProfile, user: { ...allProfile.user,
                repositories: { totalCount: 4 },
                publicRepositories: { totalCount: 2 },
                privateRepositories: { totalCount: 2 } } }),
            privateJson(allRepositories(nodes, 4)),
        ]);
        const data = await fetchGitHub(allGithubEnv, fetcher);
        expect(data).toMatchObject({
            collectionVersion: 7, stars: 12, repositories: 4,
            analyzedRepositories: 4, analyzedForks: 1, totalBytes: 480, forks: 6,
        });
        expect(requests).toHaveLength(2);
        expect(requests[1].body.query).toContain('owner { login }');
        expect(JSON.stringify(requests)).not.toMatch(/history\(|contributionsCollection/);
        expect(data.scope).toContain('organization/collaborator stars excluded');
        expect(JSON.stringify(data)).not.toMatch(/private-org|other-user|owned-fork/);
    });

    it.each([undefined, { login: null }, { login: '' }])(
        'rejects unknown repository ownership instead of caching ambiguous stars %j',
        async owner => {
            const { fetcher } = sequence([
                json(profile),
                json(repositories([{ ...repository(), owner }], 2)),
            ]);
            await expect(fetchGitHub(githubEnv, fetcher)).rejects.toThrow();
        },
    );

    it('supports the reference OWNER/non-fork filters directly', async () => {
        const { fetcher, requests } = sequence([
            json({ ...profile, user: { ...profile.user,
                publicRepositories: { totalCount: 1 } } }),
            json(repositories()),
        ]);
        await fetchGitHub({ ...githubEnv,
            GITHUB_REPOSITORY_AFFILIATIONS: 'OWNER',
            GITHUB_INCLUDE_FORKS: 'false' }, fetcher);
        expect(requests[1].body.variables).toMatchObject({
            affiliations: ['OWNER'], isFork: false,
        });
    });

    it('counts the same complete scope without identities or extra requests', async () => {
        const withLanguages = (id: string, values: Array<[string, number]>) => ({
            ...repository(id),
            languages: {
                totalSize: values.reduce((sum, [, size]) => sum + size, 0),
                pageInfo: pageInfo(),
                edges: values.map(([name, size]) => ({
                    size, node: { name, color: '#3178c6' },
                })),
            },
        });
        const nodes = [
            withLanguages('own-private-identity', [
                ['TypeScript', 70], ['JavaScript', 30], ['Python', 10],
            ]),
            { ...withLanguages('fork-private-identity', [
                ['Python', 10], ['JavaScript', 20], ['TypeScript', 60],
            ]), isPrivate: true, isFork: true },
            { ...withLanguages('org-private-identity', [
                ['Makefile', 5], ['C++', 20], ['C', 10],
            ]), owner: { login: 'private-organization' }, isPrivate: true },
            { ...withLanguages('collab-private-identity', [
                ['JavaScript', 0], ['Rust', 120],
            ]), owner: { login: 'private-collaborator' } },
            withLanguages('empty-private-identity', []),
        ];
        const { fetcher, requests } = sequence([
            privateJson({ ...allProfile, user: { ...allProfile.user,
                repositories: { totalCount: 5 },
                publicRepositories: { totalCount: 3 },
                privateRepositories: { totalCount: 2 } } }),
            privateJson(allRepositories(nodes, 5)),
        ]);
        const data = await fetchGitHub(allGithubEnv, fetcher);
        expect(data).toMatchObject({
            collectionVersion: 7, repositories: 5, analyzedRepositories: 5,
            analyzedForks: 1,
        });
        expect(data.repositoryLanguageCounts).toEqual([
            { languages: ['C', 'C++', 'Makefile'], repositories: 1 },
            { languages: ['JavaScript', 'Python', 'TypeScript'], repositories: 2 },
            { languages: ['Rust'], repositories: 1 },
            { languages: [], repositories: 1 },
        ]);
        expect(data.repositoryLanguageCounts?.reduce(
            (sum, group) => sum + group.repositories, 0,
        )).toBe(data.repositories);
        expect(requests).toHaveLength(2);
        expect(requests[1].body.variables).toMatchObject({
            affiliations: ['COLLABORATOR', 'ORGANIZATION_MEMBER', 'OWNER'],
            privacy: null, isFork: null,
        });
        expect(JSON.stringify(requests)).not.toMatch(/history\(|additions|deletions/);
        expect(JSON.stringify(data)).not.toMatch(
            /private-identity|private-organization|private-collaborator|fixture-only/,
        );
    });

    it('rejects invalid filters before contacting GitHub', async () => {
        const { fetcher, requests } = sequence([]);
        for (const filters of [{ GITHUB_REPOSITORY_AFFILIATIONS: 'ADMIN' },
            { GITHUB_INCLUDE_FORKS: 'maybe' }]) {
            await expect(fetchGitHub({ ...githubEnv, ...filters }, fetcher))
                .rejects.toThrow();
        }
        expect(requests).toHaveLength(0);
    });

    it('joins every repository and nested language page with explicit scope', async () => {
        const first = repository();
        first.languages.totalSize = 150;
        first.languages.pageInfo = pageInfo(true, 'lang-next');
        const second = repository('repo-2');
        second.languages.edges = edges('Python', 120);
        const { fetcher, requests } = sequence([
            json(profile),
            json(repositories([first], 2, true, 'repo-next')),
            json({ node: {
                isPrivate: false, isFork: false,
                languages: {
                    totalSize: 150, pageInfo: pageInfo(),
                    edges: edges('JavaScript', 30),
                },
            } }),
            json(repositories([second], 2)),
        ]);
        const data = await fetchGitHub(githubEnv, fetcher);
        expect(data.totalBytes).toBe(270);
        expect(data.analyzedRepositories).toBe(2);
        expect(data.publicRepositories).toBe(2);
        expect(data.visibility).toBe('public');
        expect(data.stars).toBe(6);
        expect(data.languages.map((x) => [x.name, x.bytes])).toEqual([
            ['Python', 120], ['TypeScript', 120], ['JavaScript', 30],
        ]);
        expect(data.repositoryLanguageCounts).toEqual([
            { languages: ['JavaScript', 'TypeScript'], repositories: 1 },
            { languages: ['Python'], repositories: 1 },
        ]);
        expect(requests).toHaveLength(4);
        expect(data.pullRequests).toBe(40);
        expect(data.mergedPullRequests).toBe(30);
        expect(requests[0]?.body.variables).toMatchObject({
            prs: 'author:Leask is:public is:pr',
            merged: 'author:Leask is:public is:pr is:merged',
            issues: 'author:Leask is:public is:issue',
        });
        expect(requests[2]?.body.variables).toEqual({
            id: 'repo-1', after: 'lang-next',
        });
        expect(requests[3]?.body.variables).toMatchObject({
            login: 'Leask', after: 'repo-next', privacy: 'PUBLIC',
        });
        expect(JSON.stringify(data)).not.toContain('repo-1');
        expect(JSON.stringify(data)).not.toContain('fixture-only');
        expect(requests.every((request) => request.redirect === 'manual')).toBe(true);
    });

    it('includes private owned bytes and token-visible authored activity in all mode', async () => {
        const privateRepo = {
            ...repository('private-repository-id'),
            name: 'private-repository-name',
            isPrivate: true,
            languages: {
                totalSize: 150, pageInfo: pageInfo(true, 'private-language-next'),
                edges: edges('Rust'),
            },
        };
        const { fetcher, requests } = sequence([
            privateJson(allProfile),
            privateJson(allRepositories([privateRepo], 2, true, 'next')),
            privateJson({ node: {
                isPrivate: true, isFork: false,
                languages: {
                    totalSize: 150, pageInfo: pageInfo(),
                    edges: edges('JavaScript', 30),
                },
            } }),
            privateJson(allRepositories([repository()], 2)),
        ]);
        const data = await fetchGitHub(allGithubEnv, fetcher);
        expect(data).toMatchObject({
            visibility: 'all', repositories: 2, publicRepositories: 1,
            privateRepositories: 1, analyzedRepositories: 2,
            totalBytes: 270, stars: 6, forks: 4,
            pullRequests: 40, mergedPullRequests: 30, issues: 12,
        });
        expect(data.languages.map(x => [x.name, x.bytes])).toEqual([
            ['Rust', 120], ['TypeScript', 120], ['JavaScript', 30],
        ]);
        expect(requests[0]?.body.variables).toMatchObject({
            login: 'Leask', all: true,
            prs: 'author:Leask is:pr',
            merged: 'author:Leask is:pr is:merged',
            issues: 'author:Leask is:issue',
        });
        expect(String(requests[0]?.body.query)).toContain('privateRepositories:');
        expect(String(requests[1]?.body.query)).toContain('privacy: $privacy');
        expect(String(requests[1]?.body.query)).toContain('ownerAffiliations: $affiliations');
        expect(requests[1]?.body.variables).toMatchObject({
            login: 'Leask', after: null, privacy: null,
        });
        expect(requests[3]?.body.variables).toMatchObject({
            login: 'Leask', after: 'next', privacy: null,
        });
        expect(data.scope).toContain('organizations and external open source');
        expect(JSON.stringify(data)).not.toContain('private-repository');
        expect(JSON.stringify(data)).not.toContain('fixture-only');
    });

    it('requires declared private repository access in all mode', async () => {
        for (const response of [json(allProfile), privateJson(allProfile, 'read:user')]) {
            const { fetcher, requests } = sequence([response]);
            await expect(fetchGitHub(allGithubEnv, fetcher))
                .rejects.toThrow('scope');
            expect(requests).toHaveLength(1);
        }
    });

    it.each(['privateRepositories', 'repositories'] as const)(
        'rejects missing all-mode %s totals', async field => {
            const user: Record<string, unknown> = { ...allProfile.user };
            delete user[field];
            const { fetcher } = sequence([privateJson({ ...allProfile, user })]);
            await expect(fetchGitHub(allGithubEnv, fetcher))
                .rejects.toThrow('incomplete data');
        },
    );

    it('rejects inconsistent all-mode totals and repository scope counts', async () => {
        const wrongTotal = sequence([privateJson({
            ...allProfile,
            user: { ...allProfile.user, repositories: { totalCount: 6 } },
        })]);
        await expect(fetchGitHub(allGithubEnv, wrongTotal.fetcher))
            .rejects.toThrow('totals are inconsistent');
        const missingPrivate = sequence([
            privateJson({
                ...allProfile,
                user: {
                    ...allProfile.user,
                    privateRepositories: { totalCount: 0 },
                    repositories: { totalCount: 1 },
                },
            }),
            privateJson(allRepositories([{ ...repository(), isPrivate: true }])),
        ]);
        await expect(fetchGitHub(allGithubEnv, missingPrivate.fetcher))
            .rejects.toThrow('totals changed');
    });

    it('rejects a different profile or paged owner identity', async () => {
        const wrongProfile = sequence([json({
            ...profile, user: { ...profile.user, login: 'AnotherUser' },
        })]);
        await expect(fetchGitHub(githubEnv, wrongProfile.fetcher))
            .rejects.toThrow('profile identity changed');
        for (const login of ['AnotherUser', undefined]) {
            const { fetcher } = sequence([
                privateJson(allProfile),
                privateJson({ user: { ...allRepositories().user, login } }),
            ]);
            await expect(fetchGitHub(allGithubEnv, fetcher)).rejects.toThrow();
        }
    });

    it.each([
        { isPrivate: undefined },
        { isPrivate: null },
        { isPrivate: 'true' },
        { isFork: undefined },
    ])('rejects malformed or out-of-scope all-mode repository flags %j', async flags => {
        const { fetcher } = sequence([
            privateJson(allProfile),
            privateJson(allRepositories([{ ...repository(), ...flags }])),
        ]);
        await expect(fetchGitHub(allGithubEnv, fetcher))
            .rejects.toThrow('scope or pagination changed');
    });

    it('rejects private visibility changes on nested language pages', async () => {
        const repo = {
            ...repository(), isPrivate: true,
            languages: {
                totalSize: 150, pageInfo: pageInfo(true, 'next'), edges: edges(),
            },
        };
        const { fetcher } = sequence([
            privateJson(allProfile), privateJson(allRepositories([repo])),
            privateJson({ node: {
                isPrivate: false, isFork: false,
                languages: {
                    totalSize: 150, pageInfo: pageInfo(), edges: edges('Rust', 30),
                },
            } }),
        ]);
        await expect(fetchGitHub(allGithubEnv, fetcher))
            .rejects.toThrow('visibility changed');
    });

    it('rejects incomplete and repeated all-mode repository pagination', async () => {
        const truncated = sequence([
            privateJson(allProfile), privateJson(allRepositories([repository()], 2)),
        ]);
        await expect(fetchGitHub(allGithubEnv, truncated.fetcher))
            .rejects.toThrow('pagination is incomplete');
        const repeated = sequence([
            privateJson(allProfile),
            privateJson(allRepositories([repository()], 2, true, 'next')),
            privateJson(allRepositories([repository()], 2)),
        ]);
        await expect(fetchGitHub(allGithubEnv, repeated.fetcher))
            .rejects.toThrow('scope or pagination changed');
    });

    it('rejects invalid visibility before making an upstream call', async () => {
        const { fetcher, requests } = sequence([]);
        await expect(fetchGitHub({
            ...githubEnv, GITHUB_VISIBILITY: 'private' as 'all',
        }, fetcher)).rejects.toThrow('visibility is invalid');
        expect(requests).toHaveLength(0);
    });

    it('fails closed when a later page fails instead of returning a partial total', async () => {
        const { fetcher } = sequence([
            json(profile), json(repositories([repository()], 2, true, 'next')),
            new Response('secret-looking upstream error body', { status: 502 }),
        ]);
        await expect(fetchGitHub(githubEnv, fetcher))
            .rejects.toThrow('GitHub API returned HTTP 502.');
    });

    it('rejects GraphQL partial errors without leaking their message', async () => {
        const { fetcher } = sequence([Response.json({
            data: profile, errors: [{ message: 'do-not-expose-private-data' }],
        })]);
        await expect(fetchGitHub(githubEnv, fetcher))
            .rejects.toThrow('GitHub GraphQL returned partial or failed data.');
    });

    it('rejects private repositories even when a token can see them', async () => {
        const { fetcher } = sequence([
            json(profile), json(repositories([{ ...repository(), isPrivate: true }])),
        ]);
        await expect(fetchGitHub(githubEnv, fetcher))
            .rejects.toThrow('scope or pagination changed');
    });

    it('rejects truncated nested language data and changing repository inventory', async () => {
        const bad = repository();
        bad.languages.totalSize = 999;
        const short = sequence([json(profile), json(repositories([bad]))]);
        await expect(fetchGitHub(githubEnv, short.fetcher))
            .rejects.toThrow('language bytes are incomplete');
        const changed = sequence([
            json(profile), json(repositories([repository()], 2, true, 'next')),
            json(repositories([repository('repo-2')], 3)),
        ]);
        await expect(fetchGitHub(githubEnv, changed.fetcher))
            .rejects.toThrow('inventory changed');
    });

    it('rejects missing authentication before making an upstream call', async () => {
        const { fetcher, requests } = sequence([]);
        await expect(fetchGitHub({ GITHUB_USERNAME: 'Leask' }, fetcher))
            .rejects.toThrow('server-side GITHUB_TOKEN');
        expect(requests).toHaveLength(0);
    });

    it('rejects redirects before parsing or forwarding the credential', async () => {
        const { fetcher, requests } = sequence([new Response('not-safe-to-show', {
            status: 302,
            headers: { Location: 'https://untrusted.invalid/token-collector' },
        })]);
        const failure = fetchGitHub(githubEnv, fetcher);
        await expect(failure).rejects.toBeInstanceOf(UpstreamError);
        await expect(failure).rejects.toThrow('GitHub API returned HTTP 302.');
        expect(requests).toHaveLength(1);
        expect(requests[0]?.redirect).toBe('manual');
    });

    it('supports a valid empty public language inventory and unset display name', async () => {
        const noName = { ...profile, user: { ...profile.user, name: '',
            publicRepositories: { totalCount: 0 } } };
        const { fetcher } = sequence([json(noName), json(repositories([], 0))]);
        const data = await fetchGitHub(githubEnv, fetcher);
        expect(data.name).toBe('Leask');
        expect(data.analyzedRepositories).toBe(0);
        expect(data.languages).toEqual([]);
        expect(data.repositoryLanguageCounts).toEqual([]);
        expect(data.totalBytes).toBe(0);
    });
});

const wakaEnv = { WAKATIME_USERNAME: 'leask' };
const waka = {
    total_seconds: 60,
    total_seconds_including_other_language: 100,
    daily_average: 6,
    daily_average_including_other_language: 10,
    is_up_to_date: true,
    is_including_today: false,
    start: '2026-10-01T00:00:00Z',
    end: '2026-10-10T23:59:59Z',
    languages: [
        { name: 'TypeScript', total_seconds: 60, percent: 60 },
        { name: 'Other', total_seconds: 40, percent: 40 },
    ],
};

describe('WakaTime collector', () => {
    it('preserves Other, its denominator, and the cutoff excluding today', async () => {
        const { fetcher } = sequence([json(waka)]);
        const data = await fetchWakaTime(wakaEnv, 'all_time', fetcher);
        expect(data.totalSeconds).toBe(100);
        expect(data.dailyAverageSeconds).toBe(10);
        expect(data.languages.map((x) => x.percent)).toEqual([60, 40]);
        expect(data.includesToday).toBe(false);
    });

    it('accepts the actual public all-time shape without inventing date bounds', async () => {
        const { start, end, ...publicShape } = waka;
        const { fetcher } = sequence([json({
            ...publicShape, human_readable_range: 'since Dec 11 2014',
        })]);
        const data = await fetchWakaTime(wakaEnv, 'all_time', fetcher);
        expect(data.start).toBeNull();
        expect(data.end).toBeNull();
        expect(data.rangeLabel).toBe('since Dec 11 2014');
        expect(data.includesToday).toBe(false);
    });

    it('never substitutes all-time for an inaccessible requested range', async () => {
        const { fetcher, requests } = sequence([
            new Response('Time range not matching public range', { status: 400 }),
        ]);
        await expect(fetchWakaTime(wakaEnv, 'last_7_days', fetcher))
            .rejects.toThrow('not public or authorized');
        expect(requests).toHaveLength(1);
        expect(requests[0]?.url).toMatch(/\/last_7_days$/);
    });

    it('does not cache a 202 calculation or a 200 pending payload as success', async () => {
        const pending = sequence([new Response('{}', { status: 202 })]);
        await expect(fetchWakaTime(wakaEnv, 'all_time', pending.fetcher))
            .rejects.toThrow('still calculating');
        const incomplete = sequence([json({ ...waka, is_up_to_date: false })]);
        await expect(fetchWakaTime(wakaEnv, 'all_time', incomplete.fetcher))
            .rejects.toThrow('incomplete or pending');
    });

    it('rejects partial calculation even when the source claims freshness', async () => {
        const { fetcher } = sequence([
            json({ ...waka, is_up_to_date: true, percent_calculated: 99 }),
        ]);
        await expect(fetchWakaTime(wakaEnv, 'all_time', fetcher))
            .rejects.toThrow('incomplete or pending');
    });

    it('rejects missing or non-boolean freshness in a 200 response', async () => {
        const { is_up_to_date, ...withoutFreshness } = waka;
        const missing = sequence([json(withoutFreshness)]);
        await expect(fetchWakaTime(wakaEnv, 'all_time', missing.fetcher))
            .rejects.toThrow('incomplete or pending');
        const wrongType = sequence([json({ ...waka, is_up_to_date: 'false' })]);
        await expect(fetchWakaTime(wakaEnv, 'all_time', wrongType.fetcher))
            .rejects.toThrow('incomplete or pending');
    });

    it('rejects an upstream range that differs from the requested range', async () => {
        const { fetcher } = sequence([json({ ...waka, range: 'all_time' })]);
        await expect(fetchWakaTime(wakaEnv, 'last_7_days', fetcher))
            .rejects.toThrow('different range');
    });

    it('rejects unsuccessful status even if other fields look complete', async () => {
        const { fetcher } = sequence([json({ ...waka, status: 'pending' })]);
        await expect(fetchWakaTime(wakaEnv, 'all_time', fetcher))
            .rejects.toThrow('unsuccessful statistics status');
        const success = sequence([json({
            ...waka, range: 'all_time', status: 'ok',
        })]);
        await expect(fetchWakaTime(wakaEnv, 'all_time', success.fetcher))
            .resolves.toMatchObject({ range: 'all_time', totalSeconds: 100 });
    });

    it('rejects missing language rows and changed percentage denominators', async () => {
        const truncated = sequence([json({
            ...waka, languages: [waka.languages[0]],
        })]);
        await expect(fetchWakaTime(wakaEnv, 'all_time', truncated.fetcher))
            .rejects.toThrow('totals are incomplete');
        const wrong = sequence([json({
            ...waka,
            languages: waka.languages.map((x) => ({ ...x, percent: 90 })),
        })]);
        await expect(fetchWakaTime(wakaEnv, 'all_time', wrong.fetcher))
            .rejects.toThrow('denominator changed');
    });

    it('uses OAuth in headers, never the URL', async () => {
        let captured: RequestInit | undefined;
        let url = '';
        const fetcher = (async (input, init) => {
            captured = init;
            url = String(input);
            return json(waka);
        }) as Fetcher;
        await fetchWakaTime({ ...wakaEnv, WAKATIME_TOKEN: 'fixture-only' },
            'all_time', fetcher);
        expect(new Headers(captured?.headers).get('Authorization'))
            .toBe('Bearer fixture-only');
        expect(captured?.redirect).toBe('manual');
        expect(new URL(url).origin).toBe('https://api.wakatime.com');
        expect(url).not.toContain('fixture-only');
    });

    it('rejects redirects without exposing upstream bodies or following them', async () => {
        const { fetcher, requests } = sequence([new Response('not-safe-to-show', {
            status: 302,
            headers: { Location: 'https://untrusted.invalid/token-collector' },
        })]);
        const failure = fetchWakaTime({
            ...wakaEnv, WAKATIME_TOKEN: 'fixture-only',
        }, 'all_time', fetcher);
        await expect(failure).rejects.toBeInstanceOf(UpstreamError);
        await expect(failure).rejects.toThrow('WakaTime API returned HTTP 302.');
        expect(requests).toHaveLength(1);
        expect(requests[0]?.redirect).toBe('manual');
    });
});
