import { UpstreamError } from './errors';
import { count, object, text } from './github-api';
import { fetchAvatar, profileText } from './github-profile';
import type { Fetcher, GitHubActivityData, GitHubData, Settings } from './types';

const ORIGIN = 'https://api.github.com';
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

class IncompleteInventory extends Error {}

function login(value: string): string {
    if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(value)) {
        throw new UpstreamError('GitHub username is invalid.');
    }
    return value;
}

function retryAfter(headers: Headers): number | undefined {
    const now = Date.now();
    const retry = headers.get('retry-after');
    const reset = headers.get('x-ratelimit-reset');
    const delay = retry === null ? NaN : /^\d+$/.test(retry)
        ? Number(retry) : (Date.parse(retry) - now) / 1000;
    const resetDelay = reset === null ? NaN : Number(reset) - now / 1000;
    const delays = [delay, resetDelay].filter(value => Number.isFinite(value)
        && value > 0);
    return delays.length ? Math.min(86400, Math.ceil(Math.max(...delays)))
        : undefined;
}

/** Anonymous requests have no access to deployment credentials. */
function publicClient(fetcher: Fetcher, maximumRequests: number) {
    const signal = AbortSignal.timeout(45_000);
    let requests = 0;
    return async (path: string) => {
        const url = new URL(path, ORIGIN);
        if (url.origin !== ORIGIN || url.username || url.password || url.hash) {
            throw new UpstreamError('GitHub public request origin is invalid.');
        }
        if (++requests > maximumRequests || signal.aborted) {
            throw new UpstreamError('GitHub public request budget exceeded.');
        }
        let response: Response;
        try {
            response = await fetcher(url.toString(), {
                redirect: 'manual', signal,
                headers: {
                    Accept: 'application/vnd.github+json',
                    'User-Agent': 'CodeStats',
                },
            });
        } catch {
            throw new UpstreamError('GitHub public request failed or timed out.');
        }
        if (!response.ok) {
            await response.body?.cancel();
            throw new UpstreamError(
                `GitHub public API returned HTTP ${response.status}.`,
                [403, 429].includes(response.status)
                    ? retryAfter(response.headers) : undefined,
            );
        }
        const reader = response.body?.getReader();
        if (!reader || Number(response.headers.get('content-length'))
            > MAX_BODY_BYTES) {
            await reader?.cancel();
            throw new UpstreamError('GitHub public response is incomplete or too large.');
        }
        const decoder = new TextDecoder();
        let bytes = 0;
        let body = '';
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                bytes += value.length;
                if (bytes > MAX_BODY_BYTES) {
                    await reader.cancel();
                    throw new Error();
                }
                body += decoder.decode(value, { stream: true });
            }
            body += decoder.decode();
            return { value: JSON.parse(body) as unknown, headers: response.headers };
        } catch {
            throw new UpstreamError('GitHub public response is invalid or too large.');
        }
    };
}

type PublicClient = ReturnType<typeof publicClient>;

async function searchCount(client: PublicClient, kind: 'issues' | 'commits',
    query: string): Promise<number> {
    const params = new URLSearchParams({ q: query, per_page: '1' });
    const result = object((await client(`/search/${kind}?${params}`)).value);
    if (result.incomplete_results !== false) {
        throw new UpstreamError('GitHub public Search returned incomplete results.');
    }
    return count(result.total_count);
}

function repositoryPath(username: string, page: number): string {
    const params = new URLSearchParams({
        type: 'owner', sort: 'full_name', direction: 'asc',
        per_page: String(PAGE_SIZE), page: String(page),
    });
    return `/users/${encodeURIComponent(username)}/repos?${params}`;
}

/** Only a validated next-page indication is used; URLs are constructed locally. */
function hasNext(headers: Headers, username: string, page: number): boolean {
    const header = headers.get('link');
    if (!header) return false;
    let next = false;
    const relations = new Set<string>();
    for (const part of header.split(',')) {
        const match = part.trim().match(/^<([^>]+)>;\s*rel="(next|prev|first|last)"$/);
        if (!match || relations.has(match[2])) {
            throw new UpstreamError('GitHub public pagination is invalid.');
        }
        relations.add(match[2]);
        let url: URL;
        try {
            url = new URL(match[1], ORIGIN);
        } catch {
            throw new UpstreamError('GitHub public pagination URL is invalid.');
        }
        const expected = new URL(repositoryPath(username, page + 1), ORIGIN);
        if (url.origin !== ORIGIN || url.username || url.password || url.hash
            || url.pathname.toLowerCase() !== expected.pathname.toLowerCase()
            || [...url.searchParams.keys()].some(key => !expected.searchParams.has(key))
            || [...url.searchParams].length !== 5
            || ['type', 'sort', 'direction', 'per_page'].some(key =>
                url.searchParams.get(key) !== expected.searchParams.get(key))
            || !/^[1-9]\d*$/.test(url.searchParams.get('page') ?? '')) {
            throw new UpstreamError('GitHub public pagination endpoint changed.');
        }
        if (match[2] === 'next') {
            if (Number(url.searchParams.get('page')) !== page + 1) {
                throw new UpstreamError('GitHub public pagination repeated or skipped a page.');
            }
            next = true;
        }
    }
    return next;
}

async function repositoryTotals(client: PublicClient, username: string,
    ownerId: number, expected: number, includeForks: boolean) {
    if (expected > MAX_PAGES * PAGE_SIZE) throw new IncompleteInventory();
    const ids = new Set<number>();
    const totals = { repositories: 0, stars: 0, forks: 0, analyzedForks: 0 };
    for (let page = 1; page <= MAX_PAGES; page++) {
        const response = await client(repositoryPath(username, page));
        if (!Array.isArray(response.value) || response.value.length > PAGE_SIZE) {
            throw new UpstreamError('GitHub public repository page is invalid.');
        }
        for (const value of response.value) {
            const repo = object(value);
            const owner = object(repo.owner);
            const id = count(repo.id);
            const name = text(repo.name);
            if (id === 0 || ids.has(id) || count(owner.id) !== ownerId
                || text(owner.login).toLowerCase() !== username.toLowerCase()
                || text(repo.full_name).toLowerCase() !== `${username}/${name}`.toLowerCase()
                || !/^[\w.-]+$/.test(name) || repo.private !== false
                || (repo.visibility !== undefined && repo.visibility !== 'public')
                || typeof repo.fork !== 'boolean') {
                throw new UpstreamError('GitHub public repository identity or visibility changed.');
            }
            ids.add(id);
            const stars = count(repo.stargazers_count);
            const forks = count(repo.forks_count);
            if (!includeForks && repo.fork) continue;
            totals.repositories++;
            totals.stars = count(totals.stars + stars);
            totals.analyzedForks += Number(repo.fork);
            if (!repo.fork) totals.forks = count(totals.forks + forks);
        }
        const next = hasNext(response.headers, username, page);
        if (!next) {
            if (ids.size !== expected) {
                throw new UpstreamError('GitHub public repository inventory changed during refresh.');
            }
            return totals;
        }
        if (!response.value.length || ids.size >= expected) {
            throw new UpstreamError('GitHub public repository pagination is incomplete.');
        }
    }
    throw new IncompleteInventory();
}

/** Public metadata only: no private repositories or per-repository language calls. */
export async function fetchPublicGitHub(
    env: Pick<Settings, 'GITHUB_USERNAME' | 'GITHUB_INCLUDE_FORKS'>,
    fetcher: Fetcher = fetch,
): Promise<GitHubData> {
    const username = login(env.GITHUB_USERNAME);
    const forkSetting = env.GITHUB_INCLUDE_FORKS ?? 'true';
    if (!['true', 'false'].includes(forkSetting)) {
        throw new UpstreamError('GITHUB_INCLUDE_FORKS must be true or false.');
    }
    const client = publicClient(fetcher, 1 + MAX_PAGES + 3);
    const profile = object((await client(`/users/${encodeURIComponent(username)}`)).value);
    const returned = login(text(profile.login));
    const ownerId = count(profile.id);
    if (returned.toLowerCase() !== username.toLowerCase() || ownerId === 0) {
        throw new UpstreamError('GitHub public profile identity changed.');
    }
    const expected = count(profile.public_repos);
    const result: GitHubData = {
        collectionVersion: 7, accessMode: 'public', languageCoverage: 'unavailable',
        username: returned, name: profileText(profile.name) ?? returned,
        bio: profileText(profile.bio), profileStatus: null, avatarDataUri: null,
        followers: count(profile.followers), visibility: 'public',
        repositoryAffiliations: ['OWNER'], includeForks: forkSetting === 'true',
        analyzedRepositories: 0, languages: [],
        scope: 'Anonymous public GitHub REST data. Owned public repositories only; '
            + (forkSetting === 'true' ? 'forks included. ' : 'forks excluded. ')
            + 'Organization/collaborator inventories and private data are unavailable. '
            + 'Stars count selected owned repositories only; fork networks are excluded. '
            + 'Language bytes and per-language repository unions are unavailable. '
            + 'Search counts describe indexed public authored activity; no commit history is traversed.',
    };
    try {
        const totals = await repositoryTotals(client, returned, ownerId,
            expected, forkSetting === 'true');
        result.publicRepositories = totals.repositories;
        result.stars = totals.stars;
        result.forks = totals.forks;
        result.analyzedForks = totals.analyzedForks;
    } catch (error) {
        if (!(error instanceof IncompleteInventory)) throw error;
        result.scope += ' The 10-page public metadata limit was reached; selected repository '
            + 'count, stars and forks are unavailable.';
    }
    const authored = `author:${returned} is:public`;
    result.pullRequests = await searchCount(client, 'issues', `${authored} is:pr`);
    result.mergedPullRequests = await searchCount(client, 'issues', `${authored} is:pr is:merged`);
    result.issues = await searchCount(client, 'issues', `${authored} is:issue`);
    if (result.pullRequests !== undefined && result.mergedPullRequests !== undefined
        && result.mergedPullRequests > result.pullRequests) {
        throw new UpstreamError('GitHub public pull request counts are inconsistent.');
    }
    result.avatarDataUri = await fetchAvatar(profile.avatar_url, fetcher);
    return result;
}

/** Search's public index count is not a contribution calendar or lifetime ledger. */
export async function fetchPublicGitHubActivity(
    env: Pick<Settings, 'GITHUB_USERNAME'>,
    fetcher: Fetcher = fetch,
): Promise<GitHubActivityData> {
    const username = login(env.GITHUB_USERNAME);
    const commits = await searchCount(publicClient(fetcher, 1), 'commits', `author:${username}`);
    return {
        collectionVersion: 3, username, visibility: 'public', commits,
        contributionsByYear: [],
        scope: 'Anonymous public GitHub Search count of indexed authored commits '
            + 'on default branches. Calendar, review, organization and contributed-repository '
            + 'aggregates are unavailable; no commit history is traversed.',
    };
}
