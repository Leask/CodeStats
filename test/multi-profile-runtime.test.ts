import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodeService, settingsFromEnvironment } from '../src/node';
import { SqliteStorage } from '../src/node-storage';
import { normalizeCodexUsage } from '../src/codex-usage';
import type { CodexUsageReading } from '../src/codex-node';
import { profileIdentity } from '../src/snapshot';
import { publicProfileIdentity, resolveProfile } from '../src/profile';
import type { Fetcher, Settings, StatsSnapshot } from '../src/types';

vi.mock('cloudflare:workers', () => ({
    DurableObject: class {
        constructor(_state: unknown, protected env: unknown) {}
    },
}));

const folders: string[] = [];
const services: Array<ReturnType<typeof createNodeService>> = [];
const settings: Settings = {
    GITHUB_USERNAME: 'owner', WAKATIME_USERNAME: 'owner',
    DEFAULT_RANGE: 'all_time', FRESH_SECONDS: '60', RETRY_SECONDS: '60',
    GITHUB_TOKEN: 'github-owner-fixture', WAKATIME_TOKEN: 'waka-owner-fixture',
    OPENROUTER_API_KEY: 'router-owner-fixture', CODEX_USAGE_ENABLED: 'true',
    CODEX_USERNAME: 'owner-codex',
};

function directory() {
    const folder = mkdtempSync(join(tmpdir(), 'codestats-profiles-'));
    folders.push(folder);
    return folder;
}

function waka(username: string, seconds = 200) {
    return { data: {
        username, is_up_to_date: true, is_including_today: false,
        total_seconds_including_other_language: seconds,
        daily_average_including_other_language: 10,
        languages: [{ name: 'Python', total_seconds: seconds, percent: 100 }],
    } };
}

function upstream() {
    const calls: Array<{ path: string; authorization: string | null }> = [];
    const fetcher = (async (input, init) => {
        const url = new URL(String(input));
        const authorization = new Headers(init?.headers).get('authorization');
        calls.push({ path: url.pathname, authorization });
        if (url.pathname === '/api/v1/users/current') {
            expect(authorization).toBe('Bearer waka-owner-fixture');
            return Response.json({ data: { username: 'owner' } });
        }
        if (url.hostname === 'api.wakatime.com') {
            const username = url.pathname.split('/')[4];
            if (username === 'owner' && !authorization) {
                return new Response('Private fixture', { status: 404 });
            }
            return Response.json(waka(username, username === 'owner' ? 100 : 200));
        }
        throw new Error('A disabled provider must not be contacted.');
    }) as Fetcher;
    return { fetcher, calls };
}

function service(fetcher: Fetcher, options: {
    settings?: Settings; publicCacheLimit?: number; codexReader?: () => Promise<CodexUsageReading>;
    folder?: string;
} = {}) {
    const node = createNodeService(options.settings ?? settings, {
        dataDirectory: options.folder ?? directory(), fetcher,
        publicCacheLimit: options.publicCacheLimit,
        codexReader: options.codexReader,
    });
    services.push(node);
    return node;
}

async function stats(origin: string, query = ''): Promise<StatsSnapshot> {
    const response = await fetch(origin + '/api/stats' + query);
    expect(response.status).toBe(200);
    return response.json();
}

function codexObservation() {
    return { observedAt: new Date(Date.now() - 1000).toISOString(), summary: {
        lifetimeTokens: 123456, peakDailyTokens: 12000,
        longestRunningTurnSec: 100, currentStreakDays: 3, longestStreakDays: 5,
    } };
}

afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await Promise.all(services.splice(0).map(node => node.close()));
    folders.splice(0).forEach(folder => rmSync(folder, { recursive: true, force: true }));
});

describe('isolated multi-profile Node runtime', () => {
    it('uses one SQLite handle with independent namespace views', async () => {
        const store = new SqliteStorage(directory(), 'legacy');
        const alice = store.scoped('alice');
        const bob = store.scoped('bob');
        await store.put('observation', { account: 'owner' });
        await alice.put('observation', { account: 'alice' });
        expect(await bob.get('observation')).toBeUndefined();
        expect(await alice.get('observation')).toEqual({ account: 'alice' });
        expect(await store.get('observation')).toEqual({ account: 'owner' });
        store.close();
        await expect(alice.get('observation')).rejects.toThrow();
    });

    it('keeps same-name public requests anonymous and owner imports private', async () => {
        const source = upstream();
        let localCodexReads = 0;
        const node = service(source.fetcher, { codexReader: async () => {
            localCodexReads++;
            return codexObservation();
        } });
        const origin = await node.listen(0);
        const owner = await stats(origin, '?sources=wakatime');
        expect(owner.wakatime.data).toMatchObject({ username: 'owner', totalSeconds: 100 });
        const { data, observedAt } = normalizeCodexUsage(codexObservation());
        await node.storage.put('usage:codex:v1', {
            data, lastSuccessAt: observedAt, lastAttemptAt: observedAt,
            lastError: null, retryAt: null, status: 'fresh',
        });
        const before = source.calls.length;
        const visitor = await stats(origin,
            '?wakatime=owner&codex=owner-codex&sources=wakatime,codex,openrouter');
        expect(visitor.wakatime.data).toBeNull();
        expect(visitor.aiUsage?.codex?.data).toBeNull();
        expect(visitor.aiUsage?.openrouter?.data).toBeNull();
        expect(visitor.github).toMatchObject({ enabled: false, data: null });
        expect(source.calls.slice(before)).toEqual([
            { path: '/api/v1/users/owner/stats/all_time', authorization: null },
        ]);
        expect(localCodexReads).toBe(0);
        const configured = await stats(origin, '?sources=codex');
        expect(configured.aiUsage?.codex?.data?.totalTokens).toBe(123456);
        expect(JSON.stringify(visitor)).not.toContain('owner-fixture');
    });

    it('reuses profile observations across masks and restarts with a bounded LRU', async () => {
        const source = upstream();
        const folder = directory();
        const node = service(source.fetcher, { folder, publicCacheLimit: 2 });
        const origin = await node.listen(0);
        await stats(origin, '?wakatime=alice');
        const calls = source.calls.length;
        await stats(origin, '?wakatime=alice&sources=wakatime,openrouter');
        expect(source.calls.length).toBe(calls);
        await stats(origin, '?wakatime=bob');
        await stats(origin, '?wakatime=charlie');
        expect(node.publicProfileCount).toBe(2);
        const before = source.calls.length;
        await stats(origin, '?wakatime=alice');
        expect(source.calls.length).toBe(before);
        await node.close();
        const restarted = service(source.fetcher, { folder, publicCacheLimit: 2 });
        await stats(await restarted.listen(0), '?wakatime=alice');
        expect(source.calls.length).toBe(before);
    });

    it('shares configured in-flight provider reads across different source masks', async () => {
        let release: (() => void) | undefined;
        let entered: (() => void) | undefined;
        let reads = 0;
        const started = new Promise<void>(resolve => { entered = resolve; });
        const gate = new Promise<void>(resolve => { release = resolve; });
        const node = service(upstream().fetcher, { codexReader: async () => {
            reads++; entered?.(); await gate;
            return codexObservation();
        } });
        const origin = await node.listen(0);
        const first = stats(origin, '?sources=codex');
        await started;
        const second = stats(origin, '?sources=codex,wakatime');
        release?.();
        const results = await Promise.all([first, second]);
        expect(reads).toBe(1);
        expect(results.every(result => result.aiUsage?.codex?.data?.totalTokens === 123456)).toBe(true);
    });

    it('will not evict a cold public profile with active upstream work', async () => {
        let release: (() => void) | undefined;
        let entered: (() => void) | undefined;
        const started = new Promise<void>(resolve => { entered = resolve; });
        const gate = new Promise<void>(resolve => { release = resolve; });
        const source = upstream();
        const node = service((async (input, init) => {
            if (String(input).includes('/alice/')) { entered?.(); await gate; }
            return source.fetcher(input, init);
        }) as Fetcher, { publicCacheLimit: 1 });
        const origin = await node.listen(0);
        const pending = stats(origin, '?wakatime=alice');
        await started;
        try {
            expect((await fetch(origin + '/api/stats?wakatime=bob')).status).toBe(503);
            expect(node.publicProfileCount).toBe(1);
        } finally { release?.(); }
        expect((await pending).wakatime.data?.username).toBe('alice');
    });

    it('refreshes only configured accounts and drains refreshing work on close', async () => {
        const source = upstream();
        const node = service(source.fetcher, { settings: { ...settings,
            GITHUB_USERNAME: '', GITHUB_TOKEN: undefined,
            CODEX_USAGE_ENABLED: 'false', OPENROUTER_API_KEY: undefined,
            AUTO_REFRESH_SECONDS: '60',
        } });
        const origin = await node.listen(0);
        await stats(origin, '?wakatime=alice');
        const before = source.calls.length;
        const first = node.refreshConfigured();
        expect(node.refreshConfigured()).toBe(first);
        expect((await first).wakatime.data?.username).toBe('owner');
        expect(source.calls.slice(before).every(call => call.path.includes('/owner/')
            || call.path.endsWith('/current'))).toBe(true);
        await node.close();
        await expect(node.refreshConfigured()).rejects.toThrow('closing');
    });

    it('resolves token-only configured Waka accounts without inheriting public names', async () => {
        const source = upstream();
        const node = service(source.fetcher, { settings: { ...settings,
            WAKATIME_USERNAME: '',
        } });
        const origin = await node.listen(0);
        const configured = await stats(origin, '?sources=wakatime');
        expect(configured.wakatime.data?.username).toBe('owner');
        const before = source.calls.length;
        await stats(origin, '?wakatime=alice');
        expect(source.calls.slice(before)).toEqual([
            { path: '/api/v1/users/alice/stats/all_time', authorization: null },
        ]);
    });

    it('retains the legacy Codex observation while resolving token-only Waka identity', async () => {
        const source = upstream();
        let localReads = 0;
        const node = service(source.fetcher, { settings: { ...settings,
            WAKATIME_USERNAME: '',
        }, codexReader: async () => { localReads++; return codexObservation(); } });
        const { data, observedAt } = normalizeCodexUsage(codexObservation());
        const imported = {
            data, lastSuccessAt: observedAt, lastAttemptAt: observedAt,
            lastError: null, retryAt: null, status: 'fresh',
        };
        await node.storage.put('usage:codex:v1', imported);
        const origin = await node.listen(0);
        expect((await stats(origin, '?sources=codex')).aiUsage?.codex?.data?.totalTokens)
            .toBe(123456);
        expect(source.calls).toEqual([]);
        const resolved = await stats(origin, '?sources=codex,wakatime');
        expect(resolved.wakatime.data?.username).toBe('owner');
        expect(resolved.aiUsage?.codex?.data?.totalTokens).toBe(123456);
        expect(localReads).toBe(0);
        expect(await node.storage.get('usage:codex:v1')).toEqual(imported);
    });

    it('requires explicit opt-in for refresh timers and rejects malformed intervals', () => {
        expect(settingsFromEnvironment({})).toMatchObject({
            GITHUB_USERNAME: '', WAKATIME_USERNAME: '', AUTO_REFRESH_SECONDS: '0',
        });
        for (const value of ['1', '59', '-1', 'NaN', '2.5', '2147484']) {
            expect(() => service(upstream().fetcher, {
                settings: { ...settings, AUTO_REFRESH_SECONDS: value },
            })).toThrow('AUTO_REFRESH_SECONDS');
        }
    });
});

describe('Worker profile routing and refresh isolation', () => {
    function objectEnv() {
        return { ...settings, SNAPSHOTS: {
            idFromName: (identity: string) => ({ toString: () => identity }),
        } } as unknown as import('../src/types').Env;
    }

    function objectState(identity: string) {
        const values = new Map<string, unknown>();
        const state = {
            id: { toString: () => identity },
            storage: {
                get: async <T>(key: string) => values.get(key) as T | undefined,
                put: async (key: string, value: unknown) => { values.set(key, value); },
            },
            waitUntil: (promise: Promise<unknown>) => { void promise.catch(() => undefined); },
        } as unknown as DurableObjectState;
        return { state, values };
    }

    it('binds public selectors to the matching object before any data is read', async () => {
        const { SnapshotStore } = await import('../src/index');
        const source = upstream();
        vi.stubGlobal('fetch', source.fetcher);
        const env = objectEnv();
        const url = new URL('https://snapshot.internal/public?range=all_time&wakatime=alice');
        const selection = resolveProfile(url, settings);
        const { state } = objectState(publicProfileIdentity(selection));
        const object = new SnapshotStore(state, env);
        for (const path of [
            '/public?range=all_time',
            '/public?range=all_time&wakatime=bob',
            '/?range=all_time',
            '/codex',
            '/public?range=all_time&wakatime=alice&force=true',
        ]) {
            const response = await object.fetch(new Request('https://snapshot.internal' + path));
            expect(response.status).toBe(400);
        }
        expect(source.calls).toEqual([]);
        const result = await (await object.fetch(new Request(url))).json<StatsSnapshot>();
        expect(result.wakatime.data?.username).toBe('alice');
        expect(result.github).toMatchObject({ data: null, enabled: false });
        expect(source.calls).toEqual([
            { path: '/api/v1/users/alice/stats/all_time', authorization: null },
        ]);
    });

    it('keeps Codex imports on legacy storage without resolving an excluded Waka account', async () => {
        const { SnapshotStore } = await import('../src/index');
        const calls: string[] = [];
        vi.stubGlobal('fetch', (async input => {
            calls.push(String(input));
            return new Response('Not available', { status: 401 });
        }) as Fetcher);
        const env = { ...objectEnv(), WAKATIME_USERNAME: '' };
        const { state, values } = objectState(profileIdentity(env));
        const object = new SnapshotStore(state, env);
        const uploaded = await object.fetch(new Request('https://snapshot.internal/codex', {
            method: 'POST', body: JSON.stringify(codexObservation()),
        }));
        expect(uploaded.status).toBe(200);
        expect(values.has('usage:codex:v1')).toBe(true);
        const response = await object.fetch(new Request(
            'https://snapshot.internal/?range=all_time&sources=codex',
        ));
        expect((await response.json<StatsSnapshot>()).aiUsage?.codex?.data?.totalTokens).toBe(123456);
        expect(calls).toEqual([]);
    });

    it.each([401, 429])('retries token-owner resolution after HTTP %i cooldown without clearing data', async status => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const { SnapshotStore } = await import('../src/index');
        const source = upstream();
        let unavailable = true;
        let identities = 0;
        vi.stubGlobal('fetch', (async (input, init) => {
            if (String(input).endsWith('/current')) {
                identities++;
                if (unavailable) return new Response('Pending', {
                    status, headers: status === 429 ? { 'Retry-After': '600' } : {},
                });
            }
            return source.fetcher(input, init);
        }) as Fetcher);
        const env = { ...objectEnv(), WAKATIME_USERNAME: '' };
        const { state, values } = objectState(profileIdentity(env));
        values.set('unrelated-last-good', { retained: true });
        const object = new SnapshotStore(state, env);
        const read = async () => (await object.fetch(new Request(
            'https://snapshot.internal/?range=all_time&sources=wakatime',
        ))).json<StatsSnapshot>();
        expect((await read()).wakatime.data).toBeNull();
        await read();
        expect(identities).toBe(1);
        unavailable = false;
        vi.setSystemTime(Date.now() + 61_000);
        if (status === 429) {
            expect((await read()).wakatime.data).toBeNull();
            expect(identities).toBe(1);
            vi.setSystemTime(Date.now() + 540_000);
        }
        expect((await read()).wakatime.data?.username).toBe('owner');
        expect(identities).toBe(3); // canonical preparation and owner-bound OAuth fallback
        expect(values.get('unrelated-last-good')).toEqual({ retained: true });
    });

    it('serializes only public selectors and keeps imports/scheduler on the legacy object', async () => {
        const worker = (await import('../src/index')).default;
        const records: Array<{ identity: string; url: URL }> = [];
        const { createProfileCache } = await import('../src/snapshot');
        const store = new Map<string, unknown>();
        const cache = createProfileCache({
            get: async <T>(key: string) => store.get(key) as T | undefined,
            put: async (key, value) => { store.set(key, value); },
        }, { ...settings, GITHUB_USERNAME: '', WAKATIME_USERNAME: '',
            GITHUB_TOKEN: undefined, WAKATIME_TOKEN: undefined,
            CODEX_USAGE_ENABLED: 'false', OPENROUTER_API_KEY: undefined });
        const empty = await cache.read('all_time', () => undefined);
        const env = { ...settings, SNAPSHOTS: {
            idFromName: (identity: string) => ({ toString: () => identity }),
            get: (id: { toString(): string }) => ({
                fetch: async (input: string | URL | Request) => {
                    const url = new URL(typeof input === 'string' ? input : input instanceof URL
                        ? input.toString() : input.url);
                    records.push({ identity: id.toString(), url });
                    return Response.json(url.pathname === '/codex' ? { saved: true } : empty);
                },
            }),
        } };
        const typedEnv = env as unknown as import('../src/types').Env;
        const request = new Request('https://cards.invalid/api/stats?wakatime=alice');
        expect((await worker.fetch(request, typedEnv)).status).toBe(200);
        expect(records[0].identity).toBe(publicProfileIdentity(resolveProfile(new URL(request.url), settings)));
        expect(records[0].url.pathname).toBe('/public');
        expect([...records[0].url.searchParams.keys()]).toEqual(['range', 'wakatime', 'sources']);
        expect(records[0].url.searchParams.get('wakatime')).toBe('alice');
        const pending: Promise<unknown>[] = [];
        await worker.scheduled({} as ScheduledController, typedEnv, {
            waitUntil: (promise: Promise<unknown>) => { pending.push(promise); },
        } as ExecutionContext);
        await Promise.all(pending);
        expect(records[1].identity).toBe(profileIdentity(settings));
        expect(records[1].url.pathname).toBe('/');
        expect(records[1].url.searchParams.get('force')).toBe('true');
        expect(records[1].url.searchParams.has('wakatime')).toBe(false);
        const importUrl = 'https://cards.invalid/api/usage/codex?wakatime=alice';
        expect((await worker.fetch(new Request(importUrl, { method: 'POST' }), typedEnv)).status).toBe(400);
        expect(records).toHaveLength(2);
    });
});
