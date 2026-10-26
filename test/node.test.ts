import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeService, settingsFromEnvironment } from '../src/node';
import { SqliteStorage } from '../src/node-storage';
import { profileIdentity } from '../src/snapshot';
import type { Fetcher, Settings, SourceSnapshot, StatsSnapshot } from '../src/types';

const directories: string[] = [];
const services: Array<ReturnType<typeof createNodeService>> = [];
const settings: Settings = {
    GITHUB_USERNAME: 'test', GITHUB_VISIBILITY: 'all',
    WAKATIME_USERNAME: 'test', DEFAULT_RANGE: 'all_time',
    FRESH_SECONDS: '60', RETRY_SECONDS: '900',
    GITHUB_TOKEN: 'isolated-fixture-not-a-secret',
};

function directory(): string {
    const value = mkdtempSync(join(tmpdir(), 'codestats-node-test-'));
    directories.push(value);
    return value;
}

afterEach(async () => {
    await Promise.all(services.splice(0).map(service => service.close()));
    for (const path of directories.splice(0)) {
        rmSync(path, { recursive: true, force: true });
    }
});

/** Only official-origin requests are accepted, with small aggregate fixtures. */
function upstream() {
    let failing = false;
    let release: (() => void) | undefined;
    let gate: Promise<void> | undefined;
    let requests = 0;
    const fetcher = (async (input, init) => {
        requests++;
        const url = new URL(String(input));
        expect(['api.github.com', 'api.wakatime.com']).toContain(url.hostname);
        if (gate) await gate;
        if (failing) return new Response('fixture failure', { status: 503 });
        if (url.hostname === 'api.wakatime.com') {
            return Response.json({ data: {
                is_up_to_date: true, is_including_today: false,
                total_seconds_including_other_language: 100,
                daily_average_including_other_language: 10,
                languages: [{ name: 'TypeScript', total_seconds: 100, percent: 100 }],
            } });
        }
        const json = (value: unknown) => Response.json(value, {
            headers: { 'x-oauth-scopes': 'repo, read:user, read:org' },
        });
        if (url.pathname.startsWith('/search/')) {
            return json({ total_count: 12, incomplete_results: false });
        }
        const { query } = JSON.parse(String(init?.body));
        if (query.includes('query ActivityProfile')) {
            return json({ data: {
                viewer: { id: 'test-user', login: 'test',
                    organizations: { totalCount: 2 } },
                user: { id: 'test-user', login: 'test',
                    createdAt: '2020-01-01T00:00:00Z',
                    repositoryDiscussions: { totalCount: 2 },
                    repositoryDiscussionComments: { totalCount: 1 },
                    contributionsCollection: { contributionYears: [2026] },
                    recent: { totalPullRequestReviewContributions: 3 },
                    repositoriesContributedTo: { totalCount: 1 } },
            } });
        }
        if (query.includes('query ActivityCalendar')) {
            return json({ data: { user: { range_0: {
                contributionCalendar: { totalContributions: 50 },
                restrictedContributionsCount: 0,
            } } } });
        }
        if (query.includes('query ActivityRepositories')) {
            return json({ data: { user: { range_0: {
                commitContributionsByRepository: [{ repository: {
                    id: 'external-repo', owner: { id: 'other-user' },
                } }],
                issueContributionsByRepository: [],
                pullRequestContributionsByRepository: [],
                pullRequestReviewContributionsByRepository: [],
                repositoryContributions: { totalCount: 0, nodes: [],
                    pageInfo: { hasNextPage: false, endCursor: null } },
            } } } });
        }
        if (query.includes('query Profile')) {
            return json({ data: {
                user: { login: 'test', name: 'Test', followers: { totalCount: 2 },
                    publicRepositories: { totalCount: 1 },
                    privateRepositories: { totalCount: 0 },
                    repositories: { totalCount: 1 } },
                prs: { issueCount: 4 }, merged: { issueCount: 3 },
                issues: { issueCount: 2 },
            } });
        }
        return json({ data: { user: { login: 'test', repositories: {
            totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{ id: 'fixture-repo', isPrivate: false, isFork: false,
                owner: { login: 'test' },
                stargazerCount: 8, forkCount: 2,
                languages: { totalSize: 1000,
                    pageInfo: { hasNextPage: false, endCursor: null },
                    edges: [{ size: 1000,
                        node: { name: 'TypeScript', color: '#3178c6' } }] },
            }],
        } } } });
    }) as Fetcher;
    return {
        fetcher,
        calls: () => requests,
        fail: () => { failing = true; },
        pause: () => { gate = new Promise<void>(accept => { release = accept; }); },
        resume: () => { release?.(); gate = undefined; },
    };
}

function service(path: string, fetcher: Fetcher, env = settings) {
    const created = createNodeService(env, { dataDirectory: path, fetcher });
    services.push(created);
    return created;
}

async function stats(url: string): Promise<StatsSnapshot> {
    return (await fetch(url + '/api/stats')).json();
}

describe('Node runtime and persistent snapshots', () => {
    it('persists the same key across restart without sharing account namespaces', async () => {
        const path = directory();
        const first = new SqliteStorage(path, 'profile-one');
        await first.put('github', { stars: 42 });
        first.close();
        const restarted = new SqliteStorage(path, 'profile-one');
        expect(await restarted.get('github')).toEqual({ stars: 42 });
        restarted.close();
        const other = new SqliteStorage(path, 'profile-two');
        expect(await other.get('github')).toBeUndefined();
        other.close();
    });

    it('keeps database and SQLite sidecars private without changing process umask', async () => {
        const original = process.umask();
        const path = directory();
        const store = new SqliteStorage(path, 'test');
        await store.put('key', { success: true });
        expect(statSync(path).mode & 0o777).toBe(0o700);
        for (const file of readdirSync(path)) {
            expect(statSync(join(path, file)).mode & 0o777).toBe(0o600);
        }
        expect(process.umask()).toBe(original);
        store.close();
    });

    it('rejects a shared directory instead of changing its existing permissions', () => {
        const path = directory();
        chmodSync(path, 0o755);
        expect(() => new SqliteStorage(path, 'test')).toThrow('private directory');
        expect(statSync(path).mode & 0o777).toBe(0o755);
    });

    it('serves the real shared HTML, JSON, SVG, HEAD, ETag and method handling', async () => {
        const source = upstream();
        const node = service(directory(), source.fetcher);
        const url = await node.listen(0);
        expect((await fetch(url + '/build')).headers.get('content-type')).toContain('text/html');
        expect(await (await fetch(url + '/build/')).text()).toContain('Build your card.');
        expect(await (await fetch(url + '/health')).json()).toMatchObject({
            service: 'CodeStats', runtime: 'ready',
        });
        const value = await stats(url);
        expect(value.github.data?.totalBytes).toBe(1000);
        expect(value.githubActivity?.data?.allTimeContributions).toBe(50);
        expect(value.wakatime.data?.totalSeconds).toBe(100);
        expect(JSON.stringify(value)).not.toContain(settings.GITHUB_TOKEN);
        expect(JSON.stringify(value)).not.toContain('fixture-repo');
        const svg = await fetch(url + '/card.svg');
        expect(svg.headers.get('content-type')).toContain('image/svg+xml');
        const markup = await svg.text();
        expect(markup).toContain('TypeScript');
        expect(markup).toContain('@media(prefers-color-scheme:dark)');
        const homepage = await fetch(url + '/');
        expect(homepage.headers.get('content-type')).toContain('image/svg+xml');
        expect(await homepage.text()).toContain('@media(prefers-color-scheme:dark)');
        const etag = svg.headers.get('etag')!;
        const notModified = await fetch(url + '/card.svg', {
            headers: { 'If-None-Match': etag },
        });
        expect(notModified.status).toBe(304);
        expect(await notModified.text()).toBe('');
        const head = await fetch(url + '/card.svg', { method: 'HEAD' });
        expect(head.status).toBe(200);
        expect(await head.text()).toBe('');
        expect((await fetch(url + '/health', { method: 'POST' })).status).toBe(405);
        expect((await fetch(url + '/health', { method: 'DELETE' })).headers.get('allow'))
            .toBe('GET, HEAD');
        expect((await fetch(url + '/api/stats?range=wrong')).status).toBe(400);
        expect((await fetch(url + '/missing')).status).toBe(404);
    });

    it('reuses successful data after process recreation while upstream is down', async () => {
        const path = directory();
        const source = upstream();
        const first = service(path, source.fetcher);
        const value = await stats(await first.listen(0));
        await first.close();
        const calls = source.calls();
        source.fail();
        const second = service(path, source.fetcher);
        const restored = await stats(await second.listen(0));
        expect(restored.github.data).toEqual(value.github.data);
        expect(restored.githubActivity?.data).toEqual(value.githubActivity?.data);
        expect(restored.wakatime.data).toEqual(value.wakatime.data);
        expect(source.calls()).toBe(calls);
    });

    it('isolates owned-only stars from earlier broad-scope cached totals', async () => {
        const path = directory();
        const legacyKey = 'github:repositories:v4:all:'
            + 'COLLABORATOR,ORGANIZATION_MEMBER,OWNER:true';
        const legacy = { data: { collectionVersion: 4, stars: 15_598 },
            lastSuccessAt: new Date().toISOString(), lastError: null,
            lastAttemptAt: new Date().toISOString(), retryAt: null };
        const storage = new SqliteStorage(path, profileIdentity(settings));
        await storage.put(legacyKey, legacy);
        storage.close();
        const node = service(path, upstream().fetcher);
        const value = await stats(await node.listen(0));
        expect(value.github.data).toMatchObject({ collectionVersion: 6, stars: 8 });
        expect(await node.storage.get(legacyKey)).toEqual(legacy);
    });

    it('drains stale refreshes on shutdown and preserves failure cooldown on restart', async () => {
        const path = directory();
        const source = upstream();
        const first = service(path, source.fetcher);
        const url = await first.listen(0);
        const value = await stats(url);
        const coreKey = 'github:repositories:v6:all:'
            + 'COLLABORATOR,ORGANIZATION_MEMBER,OWNER:true';
        for (const key of [coreKey, 'github:activity:all:v3:true', 'wakatime:all_time']) {
            const record = await first.storage.get<SourceSnapshot<unknown>>(key);
            await first.storage.put(key, {
                ...record, lastSuccessAt: '2020-01-01T00:00:00.000Z', retryAt: null,
            });
        }
        source.fail();
        source.pause();
        const stale = await stats(url);
        expect(stale.github.status).toBe('stale');
        expect(stale.github.data).toEqual(value.github.data);
        let closed = false;
        const closing = first.close().then(() => { closed = true; });
        await new Promise(accept => setTimeout(accept, 15));
        expect(closed).toBe(false);
        source.resume();
        await closing;
        const calls = source.calls();
        const restarted = service(path, source.fetcher);
        const failed = await stats(await restarted.listen(0));
        expect(failed.github.lastSuccessAt).toBe('2020-01-01T00:00:00.000Z');
        expect(failed.github.lastError).toContain('503');
        expect(failed.github.data).toEqual(value.github.data);
        expect(failed.githubActivity?.data).toEqual(value.githubActivity?.data);
        expect(failed.wakatime.data).toEqual(value.wakatime.data);
        expect(Date.parse(failed.github.retryAt!)).toBeGreaterThan(Date.now());
        expect(source.calls()).toBe(calls);
    });

    it('does not expose an earlier account snapshot after configuration changes', async () => {
        const path = directory();
        const source = upstream();
        const first = service(path, source.fetcher);
        await stats(await first.listen(0));
        await first.close();
        source.fail();
        const otherSettings = { ...settings, GITHUB_USERNAME: 'other' };
        expect(profileIdentity(otherSettings)).not.toBe(profileIdentity(settings));
        const other = service(path, source.fetcher, otherSettings);
        const value = await stats(await other.listen(0));
        expect(value.github.data).toBeNull();
        expect(value.githubActivity?.data).toBeNull();
        expect(value.wakatime.data).toBeNull();
    });

    it('keeps the runtime defaults and validates visibility without logging keys', () => {
        expect(settingsFromEnvironment({})).toMatchObject({
            GITHUB_USERNAME: 'Leask', GITHUB_VISIBILITY: 'all',
            WAKATIME_USERNAME: 'leask', DEFAULT_RANGE: 'all_time',
        });
        expect(() => settingsFromEnvironment({ GITHUB_VISIBILITY: 'mixed' }))
            .toThrow('GITHUB_VISIBILITY');
    });
});
