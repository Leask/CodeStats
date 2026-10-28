import { describe, expect, it } from 'vitest';
import { fetchPublicGitHub, fetchPublicGitHubActivity } from '../src/github-public';
import type { Fetcher } from '../src/types';

const profile = {
    id: 10, login: 'Leask', name: 'Leask', bio: 'Builds tools',
    public_repos: 2, followers: 501,
};

function repository(id = 1) {
    return {
        id, name: `repo-${id}`, full_name: `Leask/repo-${id}`,
        owner: { id: 10, login: 'Leask' }, private: false, visibility: 'public',
        fork: false, stargazers_count: 3, forks_count: 2,
    };
}

const search = (total = 10, incomplete = false) => Response.json({
    total_count: total, incomplete_results: incomplete, items: [],
});

function successfulResponses() {
    return [
        Response.json(profile),
        Response.json([repository(), { ...repository(2), fork: true,
            stargazers_count: 5, forks_count: 999 }]),
        search(10), search(8), search(2),
    ];
}

function sequence(responses: Response[]) {
    const requests: Array<{ url: URL; headers: Headers; redirect: string | undefined }> = [];
    const fetcher = (async (input, init) => {
        requests.push({
            url: new URL(String(input)), headers: new Headers(init?.headers),
            redirect: init?.redirect,
        });
        const response = responses.shift();
        if (!response) throw new Error('Unexpected request.');
        return response;
    }) as Fetcher;
    return { fetcher, requests };
}

describe('anonymous GitHub profile', () => {
    it('uses no deployment token and returns only supported owned-public aggregates', async () => {
        const { fetcher, requests } = sequence(successfulResponses());
        const env = { GITHUB_USERNAME: 'Leask', GITHUB_TOKEN: 'must-never-be-used' };
        const result = await fetchPublicGitHub(env, fetcher);
        expect(result).toMatchObject({
            username: 'Leask', name: 'Leask', followers: 501, visibility: 'public',
            accessMode: 'public', languageCoverage: 'unavailable',
            publicRepositories: 2, stars: 8, forks: 2, analyzedForks: 1,
            pullRequests: 10, mergedPullRequests: 8, issues: 2,
            languages: [], analyzedRepositories: 0,
        });
        expect(result.totalBytes).toBeUndefined();
        expect(result.repositoryLanguageCounts).toBeUndefined();
        expect(result.privateRepositories).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain('must-never-be-used');
        expect(requests).toHaveLength(5);
        expect(requests.every(request => request.url.origin === 'https://api.github.com'
            && !request.headers.has('authorization') && request.redirect === 'manual'))
            .toBe(true);
        expect(requests.filter(request => request.url.pathname.startsWith('/search/')))
            .toHaveLength(3);
        expect(requests.some(request => /\/languages|\/commits|graphql/.test(request.url.pathname)))
            .toBe(false);
    });

    it('filters forks without including their upstream popularity', async () => {
        const { fetcher } = sequence(successfulResponses());
        const result = await fetchPublicGitHub({
            GITHUB_USERNAME: 'Leask', GITHUB_INCLUDE_FORKS: 'false',
        }, fetcher);
        expect(result).toMatchObject({
            publicRepositories: 1, stars: 3, forks: 2, analyzedForks: 0,
            repositoryAffiliations: ['OWNER'], includeForks: false,
        });
    });

    it('follows complete metadata pages without fetching individual repositories', async () => {
        const next = 'https://api.github.com/users/Leask/repos?type=owner'
            + '&sort=full_name&direction=asc&per_page=100&page=2';
        const { fetcher, requests } = sequence([
            Response.json({ ...profile, public_repos: 101 }),
            Response.json(Array.from({ length: 100 }, (_, index) => repository(index + 1)), {
                headers: { Link: `<${next}>; rel="next", <${next}>; rel="last"` },
            }),
            Response.json([repository(101)]), search(10), search(8), search(2),
        ]);
        const result = await fetchPublicGitHub({ GITHUB_USERNAME: 'Leask' }, fetcher);
        expect(result).toMatchObject({ publicRepositories: 101, stars: 303, forks: 202 });
        expect(requests.filter(request => request.url.pathname.endsWith('/repos')))
            .toHaveLength(2);
        expect(requests[2].url.searchParams.get('page')).toBe('2');
    });

    it('keeps real zero counts and does not invent unsupported language bytes', async () => {
        const { fetcher } = sequence([
            Response.json({ ...profile, public_repos: 0, followers: 0 }),
            Response.json([]), search(0), search(0), search(0),
        ]);
        const result = await fetchPublicGitHub({ GITHUB_USERNAME: 'Leask' }, fetcher);
        expect(result).toMatchObject({
            publicRepositories: 0, followers: 0, stars: 0, forks: 0,
            pullRequests: 0, mergedPullRequests: 0, issues: 0,
        });
        expect(JSON.stringify(result)).not.toContain('totalBytes');
    });

    it('returns intentional partial metadata at the explicit inventory cap', async () => {
        const { fetcher, requests } = sequence([
            Response.json({ ...profile, public_repos: 1001 }),
            search(10), search(8), search(2),
        ]);
        const result = await fetchPublicGitHub({ GITHUB_USERNAME: 'Leask' }, fetcher);
        expect(result.followers).toBe(501);
        expect(result.publicRepositories).toBeUndefined();
        expect(result.stars).toBeUndefined();
        expect(result.forks).toBeUndefined();
        expect(result.scope).toContain('10-page public metadata limit');
        expect(requests).toHaveLength(4);
    });

    it('rejects changing or truncated inventories so the cache can retain its last good value', async () => {
        const { fetcher } = sequence([
            Response.json(profile), Response.json([repository()]),
        ]);
        await expect(fetchPublicGitHub({ GITHUB_USERNAME: 'Leask' }, fetcher))
            .rejects.toThrow('inventory changed');
    });

    it.each([
        { ...repository(), private: true },
        { ...repository(), visibility: 'private' },
        { ...repository(), owner: { id: 20, login: 'Leask' } },
        { ...repository(), owner: { id: 10, login: 'other' } },
        { ...repository(), full_name: 'other/repo-1' },
    ])('rejects repository visibility or identity mismatches', async repo => {
        const { fetcher } = sequence([
            Response.json(profile), Response.json([repo, repository(2)]),
        ]);
        await expect(fetchPublicGitHub({ GITHUB_USERNAME: 'Leask' }, fetcher))
            .rejects.toThrow('identity or visibility');
    });

    it('rejects duplicate repositories rather than counting them twice', async () => {
        const { fetcher } = sequence([
            Response.json(profile), Response.json([repository(), repository()]),
        ]);
        await expect(fetchPublicGitHub({ GITHUB_USERNAME: 'Leask' }, fetcher))
            .rejects.toThrow('identity or visibility');
    });

    it.each([
        'https://untrusted.invalid/users/Leask/repos?type=owner&sort=full_name&direction=asc&per_page=100&page=2',
        'https://api.github.com/users/other/repos?type=owner&sort=full_name&direction=asc&per_page=100&page=2',
        'https://api.github.com/users/Leask/repos?type=owner&sort=full_name&direction=asc&per_page=100&page=1',
    ])('rejects untrusted, changed or repeated pagination endpoints', async next => {
        const { fetcher } = sequence([
            Response.json({ ...profile, public_repos: 3 }),
            Response.json([repository(), repository(2)], {
                headers: { Link: `<${next}>; rel="next"` },
            }),
        ]);
        await expect(fetchPublicGitHub({ GITHUB_USERNAME: 'Leask' }, fetcher))
            .rejects.toThrow('pagination');
    });

    it('rejects public Search partial results instead of publishing a smaller total', async () => {
        const responses = successfulResponses();
        responses[2] = search(5, true);
        const { fetcher } = sequence(responses);
        await expect(fetchPublicGitHub({ GITHUB_USERNAME: 'Leask' }, fetcher))
            .rejects.toThrow('incomplete results');
    });

    it('rejects internally inconsistent authored PR counts', async () => {
        const responses = successfulResponses();
        responses[3] = search(11);
        const { fetcher } = sequence(responses);
        await expect(fetchPublicGitHub({ GITHUB_USERNAME: 'Leask' }, fetcher))
            .rejects.toThrow('inconsistent');
    });

    it.each([403, 429])('honors rate-limit cooldown without exposing the error body', async status => {
        const { fetcher } = sequence([
            Response.json(profile),
            new Response('upstream-sensitive-error-body', {
                status, headers: { 'Retry-After': '3600' },
            }),
        ]);
        await expect(fetchPublicGitHub({ GITHUB_USERNAME: 'Leask' }, fetcher))
            .rejects.toMatchObject({
                message: `GitHub public API returned HTTP ${status}.`,
                retryAfterSeconds: 3600,
            });
    });

    it('honors the anonymous core reset when Retry-After is absent', async () => {
        const reset = Math.ceil(Date.now() / 1000) + 120;
        const { fetcher } = sequence([new Response(null, {
            status: 403, headers: { 'X-RateLimit-Reset': String(reset) },
        })]);
        await expect(fetchPublicGitHub({ GITHUB_USERNAME: 'Leask' }, fetcher))
            .rejects.toHaveProperty('retryAfterSeconds', expect.any(Number));
    });

    it.each([
        new Response(null, { status: 302, headers: { Location: 'https://untrusted.invalid/' } }),
        new Response('{invalid'),
        new Response('{}', { headers: { 'Content-Length': String(3 * 1024 * 1024) } }),
        Response.json({ ...profile, login: 'other' }),
    ])('rejects redirects, malformed responses and profile identity changes', async response => {
        const { fetcher, requests } = sequence([response]);
        await expect(fetchPublicGitHub({ GITHUB_USERNAME: 'Leask' }, fetcher))
            .rejects.toThrow();
        expect(requests).toHaveLength(1);
        expect(requests[0].redirect).toBe('manual');
    });

    it.each(['https://github.com/Leask', '../other', '-invalid', 'a'.repeat(40)])(
        'rejects invalid account identifiers before making a request', async username => {
            const { fetcher, requests } = sequence([]);
            await expect(fetchPublicGitHub({ GITHUB_USERNAME: username }, fetcher))
                .rejects.toThrow('username');
            expect(requests).toHaveLength(0);
        },
    );
});

describe('anonymous GitHub activity', () => {
    it('uses one public Search count and keeps unsupported aggregates unknown', async () => {
        const { fetcher, requests } = sequence([search(42)]);
        const result = await fetchPublicGitHubActivity({ GITHUB_USERNAME: 'Leask' }, fetcher);
        expect(result).toMatchObject({ username: 'Leask', visibility: 'public', commits: 42 });
        expect(result.allTimeContributions).toBeUndefined();
        expect(result.reviewContributions).toBeUndefined();
        expect(result.allTimeContributedRepositories).toBeUndefined();
        expect(result.organizationCount).toBeUndefined();
        expect(result.contributionsByYear).toEqual([]);
        expect(requests).toHaveLength(1);
        expect(requests[0].url.pathname).toBe('/search/commits');
        expect(requests[0].url.searchParams.get('q')).toBe('author:Leask');
        expect(requests[0].headers.has('authorization')).toBe(false);
    });

    it('preserves real zero and rejects incomplete Search snapshots', async () => {
        const zero = sequence([search(0)]);
        expect((await fetchPublicGitHubActivity({ GITHUB_USERNAME: 'Leask' }, zero.fetcher))
            .commits).toBe(0);
        const partial = sequence([search(1000, true)]);
        await expect(fetchPublicGitHubActivity({ GITHUB_USERNAME: 'Leask' }, partial.fetcher))
            .rejects.toThrow('incomplete results');
    });
});
