import { describe, expect, it } from 'vitest';
import { SnapshotCache } from '../src/cache';
import { UpstreamError } from '../src/errors';
import type { Storage } from '../src/cache';
import type { GitHubActivityData, GitHubData, WakaData } from '../src/types';

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

const activity: GitHubActivityData = {
    username: 'test', visibility: 'all', scope: 'Token-visible personal activity',
    commits: 10, pullRequestsCommented: 4, pullRequestsReviewed: 2,
    issuesCommented: 3, discussionsStarted: 1, discussionsAnswered: 0,
    reviewContributions: 2, contributedRepositories: 4,
    allTimeContributedRepositories: 6, allTimeContributions: 20,
    contributionsByYear: [{ year: 2026, contributions: 20 }],
    recentFrom: '2025-10-25T00:00:00Z', recentTo: '2026-10-25T00:00:00Z',
    allTimeFrom: '2026-01-01T00:00:00Z', allTimeTo: '2026-10-25T00:00:00Z',
    organizationCount: 2,
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
    it('refreshes an older collection without discarding its saved data', async () => {
        const h = harness();
        const original = new SnapshotCache(h.storage, {
            ...h.loaders, githubActivity: async () => activity,
        }, h.policy);
        const before = await original.read('all_time', h.wait);
        const updated = { ...activity, collectionVersion: 2 as const,
            allTimeContributedRepositories: 8 };
        const migrated = new SnapshotCache(h.storage, {
            ...h.loaders, githubActivity: async () => updated,
        }, { ...h.policy, githubActivityCollectionVersion: 2 });
        const refreshing = await migrated.read('all_time', h.wait);
        expect(refreshing.githubActivity?.status).toBe('stale');
        expect(refreshing.githubActivity?.data).toEqual(activity);
        expect(refreshing.githubActivity?.lastSuccessAt)
            .toBe(before.githubActivity?.lastSuccessAt);
        await h.flush();
        const after = await migrated.read('all_time', h.wait);
        expect(after.githubActivity?.status).toBe('fresh');
        expect(after.githubActivity?.data).toEqual(updated);
        expect(after.github).toEqual(before.github);
        expect(after.wakatime).toEqual(before.wakatime);
    });

    it('keeps old collection coverage stale through failure and restart', async () => {
        const h = harness();
        const original = new SnapshotCache(h.storage, {
            ...h.loaders, githubActivity: async () => activity,
        }, h.policy);
        const before = await original.read('all_time', h.wait);
        let calls = 0;
        const loaders = { ...h.loaders, githubActivity: async () => {
            calls++;
            throw new UpstreamError('GitHub rate limited.', 3600);
        } };
        const policy = { ...h.policy, githubActivityCollectionVersion: 2 };
        const migrated = new SnapshotCache(h.storage, loaders, policy);
        await migrated.read('all_time', h.wait);
        await h.flush();
        const restarted = new SnapshotCache(h.storage, loaders, policy);
        const after = await restarted.read('all_time', h.wait);
        expect(after.githubActivity?.status).toBe('stale');
        expect(after.githubActivity?.data).toEqual(activity);
        expect(after.githubActivity?.lastSuccessAt)
            .toBe(before.githubActivity?.lastSuccessAt);
        expect(after.githubActivity?.lastError).toContain('rate limited');
        expect(calls).toBe(1);
        expect(after.github).toEqual(before.github);
        expect(after.wakatime).toEqual(before.wakatime);
    });

    it('isolates private/public GitHub records while preserving WakaTime', async () => {
        const h = harness();
        await h.engine.read('all_time', h.wait);
        const all = new SnapshotCache(h.storage, {
            ...h.loaders,
            github: async () => ({ ...github, stars: 99, visibility: 'all' }),
            githubActivity: async () => activity,
        }, { ...h.policy, githubKey: 'github:all-v1',
            githubActivityKey: 'github:activity:all:v1' });
        const expanded = await all.read('all_time', h.wait);
        expect(expanded.github.data?.stars).toBe(99);
        expect(expanded.githubActivity?.data).toEqual(activity);
        expect(expanded.wakatime.data).toEqual(waka);
        const publicAgain = await h.engine.read('all_time', h.wait);
        expect(publicAgain.github.data?.stars).toBe(8);
        expect(publicAgain.githubActivity).toBeUndefined();
        expect(h.calls()).toEqual([1, 1]);
    });

    it('retains independent activity data and server cooldown across restart', async () => {
        const h = harness();
        let failing = false;
        let calls = 0;
        const loaders = {
            ...h.loaders,
            githubActivity: async () => {
                calls++;
                if (failing) {
                    throw new UpstreamError('GitHub rate limited.', 3600);
                }
                return activity;
            },
        };
        const engine = new SnapshotCache(h.storage, loaders, h.policy);
        const first = await engine.read('all_time', h.wait);
        h.advance(61);
        failing = true;
        await engine.read('all_time', h.wait);
        await h.flush();
        const restarted = new SnapshotCache(h.storage, loaders, h.policy);
        const failed = await restarted.read('all_time', h.wait);
        expect(failed.githubActivity?.data).toEqual(activity);
        expect(failed.githubActivity?.lastSuccessAt)
            .toBe(first.githubActivity?.lastSuccessAt);
        expect(failed.githubActivity?.lastError).toContain('rate limited');
        expect(Date.parse(failed.githubActivity!.retryAt!))
            .toBe(Date.parse(failed.generatedAt) + 3600 * 1000);
        expect(failed.github.status).toBe('fresh');
        expect(failed.wakatime.status).toBe('fresh');
        h.advance(901);
        await restarted.read('all_time', h.wait);
        expect(calls).toBe(2);
        await h.flush();
    });

    it('does not invent activity zeros on a cold capability failure', async () => {
        const h = harness();
        const engine = new SnapshotCache(h.storage, {
            ...h.loaders,
            githubActivity: async () => { throw new Error('private-secret'); },
        }, h.policy);
        const result = await engine.read('all_time', h.wait);
        expect(result.githubActivity?.data).toBeNull();
        expect(result.githubActivity?.status).toBe('unavailable');
        expect(result.githubActivity?.lastError).toContain('GitHub');
        expect(result.githubActivity?.lastError).not.toContain('private-secret');
        expect(result.github.status).toBe('fresh');
        expect(result.wakatime.status).toBe('fresh');
    });

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
