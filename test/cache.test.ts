import { describe, expect, it } from 'vitest';
import { SnapshotCache } from '../src/cache';
import type { Storage } from '../src/cache';
import type { GitHubData, WakaData } from '../src/types';

class MemoryStorage implements Storage {
    values = new Map<string, unknown>();
    async get<T>(key: string): Promise<T | undefined> {
        return structuredClone(this.values.get(key)) as T | undefined;
    }
    async put<T>(key: string, value: T): Promise<void> {
        this.values.set(key, structuredClone(value));
    }
}

const github: GitHubData = {
    username: 'test', name: 'Test', followers: 4, publicRepositories: 3,
    analyzedRepositories: 2, stars: 8, forks: 1, pullRequests: 6,
    mergedPullRequests: 3, issues: 2, totalBytes: 100,
    languages: [{ name: 'TypeScript', bytes: 100, color: '#3178c6' }],
    scope: 'Public owned non-fork repository bytes',
};
const waka: WakaData = {
    username: 'test', range: 'all_time', totalSeconds: 100,
    dailyAverageSeconds: 10, start: null, end: null,
    includesToday: false, rangeLabel: 'since 2020',
    languages: [
        { name: 'TypeScript', seconds: 70, percent: 70 },
        { name: 'Other', seconds: 30, percent: 30 },
    ],
};

function harness() {
    const storage = new MemoryStorage();
    let now = Date.parse('2026-10-25T12:00:00Z');
    let gitCalls = 0;
    let wakaCalls = 0;
    let failing = false;
    const pending: Promise<unknown>[] = [];
    const loaders = {
        github: async () => {
            gitCalls++;
            if (failing) {
                throw new Error('secret_token_must_not_escape');
            }
            return structuredClone(github);
        },
        wakatime: async () => {
            wakaCalls++;
            return structuredClone(waka);
        },
    };
    const policy = { freshSeconds: 60, retrySeconds: 30, now: () => now };
    const engine = new SnapshotCache(storage, loaders, policy);
    return {
        storage, engine, loaders, policy,
        wait: (p: Promise<unknown>) => { pending.push(p); },
        flush: async () => { await Promise.all(pending.splice(0)); },
        advance: (seconds: number) => { now += seconds * 1000; },
        fail: () => { failing = true; },
        recover: () => { failing = false; },
        calls: () => [gitCalls, wakaCalls],
    };
}

describe('durable last-good snapshots', () => {
    it('loads once, then serves fresh data without another upstream call', async () => {
        const h = harness();
        const first = await h.engine.read('all_time', h.wait);
        const second = await h.engine.read('all_time', h.wait);
        expect(h.calls()).toEqual([1, 1]);
        expect(first.github.status).toBe('fresh');
        expect(second.github.data).toEqual(github);
    });

    it('retains data and success timestamp through an outage and process restart', async () => {
        const h = harness();
        const first = await h.engine.read('all_time', h.wait);
        h.advance(90 * 24 * 60 * 60);
        h.fail();
        const restarted = new SnapshotCache(h.storage, h.loaders, h.policy);
        const stale = await restarted.read('all_time', h.wait);
        expect(stale.github.status).toBe('stale');
        expect(stale.github.data).toEqual(github);
        await h.flush();
        const failed = await restarted.read('all_time', h.wait);
        expect(failed.github.data).toEqual(github);
        expect(failed.github.lastSuccessAt).toBe(first.github.lastSuccessAt);
        expect(failed.github.lastError).not.toContain('secret_token');
        expect(failed.wakatime.status).toBe('fresh');
    });

    it('persists failure cooldown across instances without hammering upstream', async () => {
        const h = harness();
        h.fail();
        const failed = await h.engine.read('all_time', h.wait);
        expect(failed.github.data).toBeNull();
        expect(failed.github.status).toBe('unavailable');
        expect(failed.github.lastSuccessAt).toBeNull();
        const restart = new SnapshotCache(h.storage, h.loaders, h.policy);
        await restart.read('all_time', h.wait);
        expect(h.calls()).toEqual([1, 1]);
        h.advance(31);
        h.recover();
        const recovered = await restart.read('all_time', h.wait);
        expect(recovered.github.status).toBe('fresh');
        expect(recovered.github.lastError).toBeNull();
        expect(h.calls()).toEqual([2, 1]);
    });

    it('keeps WakaTime range snapshots separate; never substitutes all-time', async () => {
        const h = harness();
        await h.engine.read('all_time', h.wait);
        const engine = new SnapshotCache(h.storage, {
            github: h.loaders.github,
            wakatime: async () => { throw new Error('range not public'); },
        }, h.policy);
        const recent = await engine.read('last_7_days', h.wait);
        expect(recent.range).toBe('last_7_days');
        expect(recent.wakatime.data).toBeNull();
        expect(recent.github.data).toEqual(github);
        const all = await engine.read('all_time', h.wait);
        expect(all.wakatime.data).toEqual(waka);
    });

    it('coalesces simultaneous cold requests into one refresh per provider', async () => {
        const h = harness();
        let release!: (value: GitHubData) => void;
        let calls = 0;
        const load = new Promise<GitHubData>(resolve => { release = resolve; });
        const engine = new SnapshotCache(h.storage, {
            github: () => { calls++; return load; },
            wakatime: h.loaders.wakatime,
        }, h.policy);
        const a = engine.read('all_time', h.wait);
        await new Promise(resolve => setTimeout(resolve, 5));
        const b = engine.read('all_time', h.wait);
        release(github);
        const results = await Promise.all([a, b]);
        expect(calls).toBe(1);
        expect(results.every(x => x.github.data?.totalBytes === 100)).toBe(true);
    });

    it('serves stale immediately while a slow provider is still pending', async () => {
        const h = harness();
        await h.engine.read('all_time', h.wait);
        h.advance(61);
        let release!: (value: GitHubData) => void;
        const load = new Promise<GitHubData>(resolve => { release = resolve; });
        const engine = new SnapshotCache(h.storage, {
            github: () => load, wakatime: h.loaders.wakatime,
        }, h.policy);
        const result = await engine.read('all_time', h.wait);
        expect(result.github.status).toBe('stale');
        expect(result.github.data).toEqual(github);
        release({ ...github, stars: 12 });
        await h.flush();
        const next = await engine.read('all_time', h.wait);
        expect(next.github.data?.stars).toBe(12);
        expect(next.github.status).toBe('fresh');
    });
});
