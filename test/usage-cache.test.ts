import { describe, expect, it, vi } from 'vitest';
import { SnapshotCache } from '../src/cache';
import type { Storage } from '../src/cache';
import type { AIUsageData } from '../src/types';
import { UpstreamError } from '../src/errors';
import { normalizeCodexUsage } from '../src/codex-usage';
import { importCodexRequest } from '../src/usage-import';

class MemoryStorage implements Storage {
    values = new Map<string, unknown>();
    async get<T>(key: string) {
        return structuredClone(this.values.get(key)) as T | undefined;
    }
    async put<T>(key: string, value: T) {
        this.values.set(key, structuredClone(value));
    }
}

const at = '2026-10-28T12:00:00.000Z';
const now = Date.parse(at);
const usage: AIUsageData = {
    collectionVersion: 3,
    service: 'openrouter', label: 'OpenRouter', totalTokens: 12345,
    totalPrompts: 100,
    period: 'Last 30 days', since: '2026-09-28T00:00:00.000Z',
    until: '2026-10-28T00:00:00.000Z', scope: 'Account aggregate',
};
const loaders = {
    github: async () => { throw new UpstreamError('Fixture unavailable.'); },
    wakatime: async () => { throw new UpstreamError('Fixture unavailable.'); },
};
const payload = (observedAt = at) => ({
    observedAt,
    summary: {
        lifetimeTokens: 131320846898, peakDailyTokens: 5262475191,
        longestRunningTurnSec: 203454, currentStreakDays: 82,
        longestStreakDays: 109,
    },
});

describe('optional usage snapshots', () => {
    it('omits unconfigured services without fetching them', async () => {
        const cache = new SnapshotCache(new MemoryStorage(), loaders, {
            freshSeconds: 60, retrySeconds: 30, now: () => now,
        });
        expect((await cache.read('all_time', () => {})).aiUsage).toBeUndefined();
    });

    it('preserves each service success and cooldown after failure and restart', async () => {
        let clock = now;
        const storage = new MemoryStorage();
        const fetchUsage = vi.fn(async () => usage);
        const policy = { freshSeconds: 60, retrySeconds: 30, now: () => clock };
        const load = { ...loaders, aiUsage: { openrouter: fetchUsage } };
        const cache = new SnapshotCache(storage, load, policy);
        const first = await cache.read('all_time', () => {});
        expect(first.aiUsage!.openrouter).toMatchObject({
            data: usage, status: 'fresh', lastSuccessAt: at,
        });
        clock += 61_000;
        fetchUsage.mockRejectedValue(new Error('fixture-private-diagnostic'));
        const pending: Promise<unknown>[] = [];
        const stale = await cache.read('last_7_days', promise => pending.push(promise));
        expect(stale.aiUsage!.openrouter!.data).toEqual(usage);
        await Promise.all(pending);
        const restart = new SnapshotCache(storage, load, policy);
        const failed = await restart.read('last_30_days', () => {});
        expect(failed.aiUsage!.openrouter).toMatchObject({
            data: usage, status: 'stale', lastSuccessAt: at,
            lastError: 'Token usage refresh failed; saved data is retained.',
        });
        expect(JSON.stringify(failed)).not.toContain('fixture-private-diagnostic');
        expect(fetchUsage).toHaveBeenCalledTimes(2);
    });

    it.each([
        { previousVersion: undefined, succeeds: true },
        { previousVersion: undefined, succeeds: false },
        { previousVersion: 2 as const, succeeds: true },
        { previousVersion: 2 as const, succeeds: false },
    ])('retains OpenRouter data during an upgrade from $previousVersion, success=$succeeds', async ({ previousVersion, succeeds }) => {
        const storage = new MemoryStorage();
        const old = { ...usage };
        old.collectionVersion = previousVersion;
        delete old.totalPrompts;
        const key = 'usage:openrouter:v1:last30completed';
        await storage.put(key, {
            data: old, lastSuccessAt: at, lastAttemptAt: at,
            lastError: null, retryAt: null, status: 'fresh',
        });
        const current: AIUsageData = {
            ...usage, totalTokens: 292_849_641, period: 'Last 367 days',
            totalPrompts: 129_146,
            since: '2025-10-26T00:00:00.000Z',
            summary: { longestStreakDays: 120,
                averageDailyTokens: 292_849_641 / 367,
                averageWeeklyTokens: 292_849_641 / 367 * 7 },
        };
        let finish!: () => void;
        const upgrading = new Promise<AIUsageData>((resolve, reject) => {
            finish = () => succeeds ? resolve(current)
                : reject(new UpstreamError('OpenRouter usage API returned HTTP 503.'));
        });
        const cache = new SnapshotCache(storage, {
            ...loaders, aiUsage: { openrouter: () => upgrading },
        }, { freshSeconds: 60, retrySeconds: 30, now: () => now,
            aiUsageKeys: { openrouter: key } });
        const pending: Promise<unknown>[] = [];
        const before = await cache.read('all_time', promise => pending.push(promise));
        expect(before.aiUsage!.openrouter).toMatchObject({
            status: 'stale', data: old, lastSuccessAt: at,
        });
        finish();
        await Promise.all(pending);
        const after = await cache.read('all_time', () => {});
        expect(after.aiUsage!.openrouter).toMatchObject({
            status: succeeds ? 'fresh' : 'stale',
            data: succeeds ? current : old, lastSuccessAt: at,
        });
        expect(after.aiUsage!.openrouter!.lastError).toBe(succeeds ? null
            : 'OpenRouter usage API returned HTTP 503.');
    });

    it('keeps imported observation age across reads and never refreshes it by visiting', async () => {
        const storage = new MemoryStorage();
        const cache = new SnapshotCache(storage, loaders, {
            freshSeconds: 60, retrySeconds: 30, now: () => now,
            importedCodexUsage: true,
        });
        await cache.saveCodexUsage(payload('2026-10-28T10:00:00.000Z'));
        const result = await cache.read('all_time', () => {});
        expect(result.aiUsage!.codex).toMatchObject({
            status: 'stale', lastSuccessAt: '2026-10-28T10:00:00.000Z',
            data: { totalTokens: 131320846898, service: 'codex' },
        });
        const before = structuredClone(storage.values);
        await expect(cache.saveCodexUsage(payload('2026-10-28T09:00:00.000Z')))
            .rejects.toThrow('not newer');
        expect(storage.values).toEqual(before);
    });

    it('serializes concurrent imports so an older observation cannot win', async () => {
        const cache = new SnapshotCache(new MemoryStorage(), loaders, {
            freshSeconds: 60, retrySeconds: 30, now: () => now,
            importedCodexUsage: true,
        });
        const writes = await Promise.allSettled([
            cache.saveCodexUsage(payload(at)),
            cache.saveCodexUsage(payload('2026-10-28T11:59:00.000Z')),
        ]);
        expect(writes.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
        expect((await cache.read('all_time', () => {})).aiUsage!.codex!.lastSuccessAt)
            .toBe(at);
    });

    it('does not make an old local Codex observation fresh on a new fetch', async () => {
        const old = normalizeCodexUsage(payload('2026-10-28T10:00:00.000Z'), now).data;
        const reader = vi.fn(async () => old);
        const cache = new SnapshotCache(new MemoryStorage(), {
            ...loaders, aiUsage: { codex: reader },
        }, { freshSeconds: 60, retrySeconds: 30, now: () => now });
        const first = await cache.read('all_time', () => {});
        expect(first.aiUsage!.codex).toMatchObject({
            status: 'stale', lastSuccessAt: '2026-10-28T10:00:00.000Z',
            retryAt: '2026-10-28T12:00:30.000Z',
        });
        await cache.read('all_time', () => {});
        expect(reader).toHaveBeenCalledTimes(1);
    });

    it('upgrades a fresh total-only Codex snapshot without dropping its saved value', async () => {
        const storage = new MemoryStorage();
        const current = normalizeCodexUsage(payload(), now).data;
        const old = { ...current };
        delete old.summary;
        delete old.collectionVersion;
        await storage.put('usage:codex:v1', {
            data: old, lastSuccessAt: at, lastAttemptAt: at,
            lastError: null, retryAt: null, status: 'fresh',
        });
        let finish!: (value: AIUsageData) => void;
        const refreshing = new Promise<AIUsageData>(resolve => { finish = resolve; });
        const cache = new SnapshotCache(storage, {
            ...loaders, aiUsage: { codex: () => refreshing },
        }, { freshSeconds: 60, retrySeconds: 30, now: () => now });
        const pending: Promise<unknown>[] = [];
        const before = await cache.read('all_time', promise => pending.push(promise));
        expect(before.aiUsage!.codex).toMatchObject({ data: old, status: 'stale' });
        finish(current);
        await Promise.all(pending);
        const after = await cache.read('all_time', () => {});
        expect(after.aiUsage!.codex).toMatchObject({
            status: 'fresh', data: { collectionVersion: 2,
                totalTokens: 131320846898,
                summary: { peakDailyTokens: 5262475191,
                    longestRunningTurnSec: 203454,
                    longestStreakDays: 109, currentStreakDays: 82 } },
        });
    });
});

describe('Codex aggregate validation and import authorization', () => {
    const settings = {
        GITHUB_USERNAME: 'test', WAKATIME_USERNAME: 'test',
        DEFAULT_RANGE: 'all_time', FRESH_SECONDS: '60', RETRY_SECONDS: '30',
        CODEX_USAGE_ENABLED: 'true', CODEX_SYNC_TOKEN: 'isolated-fixture-'.repeat(3),
    };
    const request = (value: unknown, token = settings.CODEX_SYNC_TOKEN) => new Request(
        'https://stats.example/api/usage/codex', {
            method: 'POST', headers: {
                Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
            }, body: JSON.stringify(value),
        },
    );

    it('retains null metrics and strips unrelated/private fields', () => {
        const value = payload();
        const result = normalizeCodexUsage({ ...value,
            summary: { ...value.summary, lifetimeTokens: null, credential: 'fixture-private' },
            accessToken: 'fixture-private',
        }, now);
        expect(result.data.totalTokens).toBeNull();
        expect(result.data.period).toBe('Lifetime');
        expect(result.data.summary).toEqual({
            peakDailyTokens: 5262475191, longestRunningTurnSec: 203454,
            longestStreakDays: 109, currentStreakDays: 82,
        });
        expect(JSON.stringify(result)).not.toContain('fixture-private');
        expect(result.observedAt).toBe(at);
    });

    it('rejects invalid, incomplete, negative and unsafe numeric data', () => {
        for (const value of [-1, 1.2, '123', Number.MAX_SAFE_INTEGER + 1, undefined]) {
            const bad = payload();
            expect(() => normalizeCodexUsage({ ...bad,
                summary: { ...bad.summary, lifetimeTokens: value },
            }, now)).toThrow('incomplete');
        }
        expect(() => normalizeCodexUsage(payload('2099-01-01T00:00:00Z'), now))
            .toThrow('observation time');
    });

    it('requires the separate sync secret and honors an explicit opt-out', async () => {
        const save = vi.fn();
        expect((await importCodexRequest(request(payload(), 'wrong'), settings, save)).status)
            .toBe(401);
        expect((await importCodexRequest(request(payload()), {
            ...settings, CODEX_USAGE_ENABLED: 'false',
        }, save)).status).toBe(404);
        expect((await importCodexRequest(request(payload()), {
            ...settings, CODEX_SYNC_TOKEN: 'short',
        }, save)).status).toBe(503);
        expect(save).not.toHaveBeenCalled();
        expect((await importCodexRequest(request(payload()), settings, save)).status)
            .toBe(200);
        expect(save).toHaveBeenCalledWith(payload());
    });

    it('accepts a valid sync secret without a redundant enable flag', async () => {
        const save = vi.fn();
        const automatic = { ...settings, CODEX_USAGE_ENABLED: undefined };
        expect((await importCodexRequest(request(payload(), 'wrong'), automatic, save))
            .status).toBe(401);
        expect(save).not.toHaveBeenCalled();
        expect((await importCodexRequest(request(payload()), automatic, save))
            .status).toBe(200);
        expect(save).toHaveBeenCalledWith(payload());
    });

    it('rejects oversized, invalid JSON, wrong content type and wrong method', async () => {
        const save = vi.fn();
        const large = await importCodexRequest(request('x'.repeat(20_000)), settings, save);
        expect(large.status).toBe(413);
        const broken = request(payload());
        const badJson = new Request(broken.url, {
            method: 'POST', headers: broken.headers, body: '{',
        });
        expect((await importCodexRequest(badJson, settings, save)).status).toBe(400);
        const wrongType = request(payload());
        wrongType.headers.set('Content-Type', 'text/plain');
        expect((await importCodexRequest(wrongType, settings, save)).status).toBe(415);
        expect((await importCodexRequest(new Request(broken.url), settings, save)).status)
            .toBe(405);
        expect(save).not.toHaveBeenCalled();
    });
});
