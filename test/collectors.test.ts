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
    stargazerCount: 3,
    forkCount: 2,
    languages: { totalSize: 120, pageInfo: pageInfo(), edges: edges() },
});
const profile = {
    user: {
        login: 'Leask', name: 'Leask', followers: { totalCount: 50 },
        publicRepositories: { totalCount: 3 },
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

describe('GitHub collector', () => {
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
        expect(data.publicRepositories).toBe(3);
        expect(data.stars).toBe(6);
        expect(data.languages.map((x) => [x.name, x.bytes])).toEqual([
            ['Python', 120], ['TypeScript', 120], ['JavaScript', 30],
        ]);
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
        expect(requests[3]?.body.variables).toEqual({
            login: 'Leask', after: 'repo-next',
        });
        expect(JSON.stringify(data)).not.toContain('repo-1');
        expect(JSON.stringify(data)).not.toContain('fixture-only');
        expect(requests.every((request) => request.redirect === 'manual')).toBe(true);
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
        const noName = { ...profile, user: { ...profile.user, name: '' } };
        const { fetcher } = sequence([json(noName), json(repositories([], 0))]);
        const data = await fetchGitHub(githubEnv, fetcher);
        expect(data.name).toBe('Leask');
        expect(data.analyzedRepositories).toBe(0);
        expect(data.languages).toEqual([]);
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
