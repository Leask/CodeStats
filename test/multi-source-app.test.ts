import { describe, expect, it, vi } from 'vitest';
import { createHandler } from '../src/app';
import type { ReadOptions } from '../src/cache';
import type { PrimarySource, ProfileSelection } from '../src/profile';
import type {
    AIUsageData, Range, Settings, SourceSnapshot, StatsSnapshot,
} from '../src/types';

const services: PrimarySource[] = ['github', 'wakatime', 'codex', 'openrouter'];
const labels = ['GitHub', 'WakaTime', 'Codex', 'OpenRouter'];
const settings: Settings = {
    GITHUB_USERNAME: 'owner', WAKATIME_USERNAME: 'owner-time',
    CODEX_USERNAME: 'owner-codex', CODEX_USAGE_ENABLED: 'true',
    GITHUB_TOKEN: 'github-private-credential-fixture',
    WAKATIME_TOKEN: 'waka-private-credential-fixture',
    OPENROUTER_API_KEY: 'router-private-credential-fixture',
    DEFAULT_RANGE: 'all_time', FRESH_SECONDS: '21600', RETRY_SECONDS: '900',
};
const observed = {
    github: '2026-10-28T09:01:00Z', wakatime: '2026-10-28T10:02:00Z',
    codex: '2026-10-28T11:03:00Z', openrouter: '2026-10-28T12:04:00Z',
};

function source<T>(data: T, provider: PrimarySource): SourceSnapshot<T> {
    return { data, status: 'fresh', lastSuccessAt: observed[provider],
        lastAttemptAt: observed[provider], lastError: null, retryAt: null };
}

function fixture(): StatsSnapshot {
    const usage = (service: 'codex' | 'openrouter'): AIUsageData => ({
        service, label: service, totalTokens: service === 'codex' ? 713003 : 813004,
        totalPrompts: service === 'openrouter' ? 713 : undefined,
        period: service === 'codex' ? 'Lifetime' : 'Last 367 days',
        since: null, until: '2026-10-28', scope: 'Fixture account aggregate',
        summary: service === 'codex' ? {
            peakDailyTokens: 513, longestRunningTurnSec: 3500,
            longestStreakDays: 109, currentStreakDays: 82,
        } : { averageDailyTokens: 1271, averageWeeklyTokens: 8897,
            longestStreakDays: 120 },
    });
    return {
        schemaVersion: 1, range: 'all_time', generatedAt: '2026-10-28T13:05:00Z',
        github: source({ username: 'owner', name: 'Owner GitHub Identity',
            visibility: 'all', publicRepositories: 13, privateRepositories: 7,
            repositories: 20, analyzedRepositories: 20, followers: 41,
            stars: 17, forks: 2, pullRequests: 19, mergedPullRequests: 11, issues: 3,
            totalBytes: 1270, scope: 'private-repository-scope-fixture',
            languages: [{ name: 'Rust', bytes: 1270, color: '#dea584' }],
            repositoryLanguageCounts: [{ languages: ['Rust'], repositories: 20 }],
        }, 'github'),
        githubActivity: source({ username: 'owner', visibility: 'all',
            scope: 'private-activity-scope-fixture', commits: 313,
            allTimeContributions: 413, contributionsByYear: [
                { year: 2026, contributions: 413 },
            ],
        }, 'github'),
        wakatime: source({ username: 'owner-time', range: 'all_time',
            totalSeconds: 73740, dailyAverageSeconds: 1800, start: '2020-01-01',
            end: '2026-10-28', includesToday: false, rangeLabel: 'Since 2020',
            languages: [{ name: 'Python', seconds: 73740, percent: 100 }],
        }, 'wakatime'),
        aiUsage: { codex: source(usage('codex'), 'codex'),
            openrouter: source(usage('openrouter'), 'openrouter') },
    };
}

function app(value = fixture()) {
    const reader = vi.fn(async (_env: Settings, _range: Range,
        _selection: ProfileSelection, _options: ReadOptions) => value);
    return { reader, handler: createHandler(reader) };
}

function request(path: string, query: Record<string, string> = {}): Request {
    const url = new URL(path, 'https://cards.example.invalid');
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    return new Request(url);
}

async function json(handler: ReturnType<typeof createHandler>, query: Record<string, string>) {
    const response = await handler.fetch(request('/api/stats', query), settings);
    expect(response.status).toBe(200);
    return response.json() as Promise<StatsSnapshot & { languageRows: unknown[] }>;
}

async function card(handler: ReturnType<typeof createHandler>, query: Record<string, string>) {
    const response = await handler.fetch(request('/card.svg', query), settings);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/svg+xml');
    const text = await response.text();
    expect(text).toContain('<svg');
    expect(text).not.toMatch(/NaN|Infinity|undefined/);
    return text;
}

describe('multi-source HTTP selection', () => {
    it.each(Array.from({ length: 15 }, (_, index) => index + 1))(
        'isolates selected data and native refresh times for source mask %i', async mask => {
            const original = fixture();
            const before = structuredClone(original);
            const { handler, reader } = app(original);
            const selected = services.filter((_, index) => mask & (1 << index));
            const query = { sources: [...selected].reverse().join(',') };
            const data = await json(handler, query);
            const svg = await card(handler, query);
            expect(data.selectedSources).toEqual(selected);
            expect(reader.mock.calls[0][2]).toEqual({ mode: 'configured',
                sources: selected, accounts: { github: 'owner',
                    wakatime: 'owner-time', codex: 'owner-codex' } });
            expect(reader.mock.calls[0][3]).toEqual({ sources: selected });
            for (const [index, provider] of services.entries()) {
                const enabled = selected.includes(provider);
                const entry = provider === 'github' ? data.github
                    : provider === 'wakatime' ? data.wakatime : data.aiUsage?.[provider];
                if (enabled) {
                    expect(entry?.data).toBeTruthy();
                    expect(entry?.lastSuccessAt).toBe(observed[provider]);
                    expect(svg).toContain(labels[index] + ':');
                } else {
                    expect(entry?.data ?? null).toBeNull();
                    expect(entry?.lastSuccessAt ?? null).toBeNull();
                    expect(JSON.stringify(data)).not.toContain(observed[provider]);
                    expect(svg).not.toContain(labels[index] + ':');
                }
            }
            if (!selected.includes('github')) {
                expect(data.githubActivity).toBeUndefined();
                expect(svg).not.toContain('Owner GitHub Identity');
                expect(JSON.stringify(data)).not.toContain('private-repository-scope-fixture');
            }
            if (!selected.includes('wakatime')) {
                expect(JSON.stringify(data)).not.toContain('73740');
                expect(svg).not.toContain('owner-time');
            }
            for (const secret of ['github-private-', 'waka-private-', 'router-private-']) {
                expect(JSON.stringify(data) + svg).not.toContain(secret);
            }
            expect(original).toEqual(before);
        },
    );

    it.each(services)('renders only %s when a focused view is requested', async view => {
        const { handler } = app();
        const svg = await card(handler, { sources: services.join(','), view });
        expect(svg).toContain(`data-source-section="${view}"`);
        for (const [index, provider] of services.entries()) {
            if (provider === view) continue;
            expect(svg).not.toContain(`data-source-section="${provider}"`);
            expect(svg).not.toContain(labels[index] + ':');
        }
        if (view !== 'github') expect(svg).not.toContain('Owner GitHub Identity');
        if (view !== 'wakatime') expect(svg).not.toContain('owner-time');
        if (view !== 'codex') expect(svg).not.toContain('713,003 tokens');
        if (view !== 'openrouter') expect(svg).not.toContain('813,004 tokens');
    });

    it.each(['overview', ...services])('supports %s themes and optional headers', async view => {
        const { handler } = app();
        for (const theme of ['dark', 'light', 'transparent']) {
            for (const header of ['true', 'false']) {
                const svg = await card(handler, { view, theme, header });
                expect(svg).toContain('width="880"');
                expect(svg.includes('data-profile-header="true"')
                    || svg.includes('data-source-header="true"')).toBe(header === 'true');
                expect(svg).toContain('github.com/Leask/CodeStats');
                expect([...svg.matchAll(/font-size="([\d.]+)"/g)]
                    .every(match => [27, 13, 11].includes(Number(match[1])))).toBe(true);
                if (theme === 'transparent') expect(svg).toContain('prefers-color-scheme');
            }
        }
    });

    it.each(['languages', 'activity'])('keeps the legacy %s view usable', async view => {
        const { handler } = app();
        const svg = await card(handler, { view, sources: 'github,wakatime' });
        expect(svg).toContain('GitHub:');
        expect(svg).toContain('WakaTime:');
        expect(svg).not.toContain('data-token-service="codex"');
        expect(svg).not.toContain('data-token-service="openrouter"');
        expect(svg).toContain(view === 'activity' ? 'TOKEN-VISIBLE ACTIVITY' : 'CODE BYTES');
    });

    it('provides a useful neutral card with no configured sources', async () => {
        const { handler } = app();
        const response = await handler.fetch(request('/card.svg'), {
            DEFAULT_RANGE: 'all_time', FRESH_SECONDS: '60', RETRY_SECONDS: '60',
            GITHUB_USERNAME: '', WAKATIME_USERNAME: '',
        });
        expect(response.status).toBe(200);
        const svg = await response.text();
        expect(svg).toContain('Select a source to build your card.');
        expect(svg).not.toContain('data-source-metric');
        expect(svg).not.toContain('Owner GitHub Identity');
    });
});

describe('public HTTP privacy boundaries', () => {
    const publicQuery = { github: 'owner', wakatime: 'owner-time', codex: 'owner-codex',
        sources: services.join(',') };

    it('never authorizes private data for explicit same-name public selectors', async () => {
        const original = fixture();
        const before = structuredClone(original);
        const { handler, reader } = app(original);
        const data = await json(handler, publicQuery);
        expect(reader.mock.calls[0][2]).toMatchObject({ mode: 'public' });
        expect(data.profile?.mode).toBe('public');
        expect(data.github.data).toBeNull();
        expect(data.github.lastSuccessAt).toBeNull();
        expect(data.githubActivity).toBeUndefined();
        for (const provider of ['codex', 'openrouter'] as const) {
            expect(data.aiUsage?.[provider]).toMatchObject({ data: null,
                lastSuccessAt: null, lastAttemptAt: null, retryAt: null,
                status: 'unavailable' });
        }
        const text = JSON.stringify(data);
        expect(text).not.toContain('private-repository-scope-fixture');
        expect(text).not.toContain('private-activity-scope-fixture');
        expect(text).not.toContain('713003');
        expect(text).not.toContain('813004');
        const svg = await card(handler, { ...publicQuery, view: 'codex' });
        expect(svg).toContain('href="https://chatgpt.com/u/owner-codex"');
        expect(svg).not.toContain('713,003');
        expect(svg).toContain('not refreshed');
        expect(original).toEqual(before);
    });

    it('scrubs owner AI refresh metadata and raw errors even without cached data', async () => {
        const original = fixture();
        for (const provider of ['codex', 'openrouter'] as const) {
            original.aiUsage![provider]!.data = null;
            original.aiUsage![provider]!.lastError = 'owner-private-native-error-fixture';
            original.aiUsage![provider]!.retryAt = '2026-10-29T01:00:00Z';
        }
        const { handler } = app(original);
        const query = { codex: 'external-id', sources: 'codex,openrouter' };
        const data = await json(handler, query);
        const text = JSON.stringify(data) + await card(handler, query);
        expect(text).not.toContain('owner-private-native-error-fixture');
        expect(text).not.toContain('2026-10-29T01:00:00Z');
        for (const provider of ['codex', 'openrouter'] as const) {
            expect(data.aiUsage?.[provider]?.lastSuccessAt).toBeNull();
            expect(data.aiUsage?.[provider]?.lastAttemptAt).toBeNull();
            expect(text).not.toContain(observed[provider]);
        }
    });

    it.each(['missing-profile', 'matching-profile'])
        ('rejects private or mismatched activity with a %s snapshot', async kind => {
            const original = fixture();
            if (kind === 'missing-profile') original.github.data = null;
            else original.github.data!.visibility = 'public';
            original.githubActivity!.data!.username = 'different-owner';
            const { handler } = app(original);
            const data = await json(handler, { github: 'owner' });
            expect(data.githubActivity?.data ?? null).toBeNull();
            expect(data.githubActivity?.lastSuccessAt ?? null).toBeNull();
            expect(JSON.stringify(data)).not.toContain('private-activity-scope-fixture');
        });

    it('displays unknown anonymous GitHub counts as dashes, preserving real zeros', async () => {
        const original = fixture();
        Object.assign(original.github.data!, { visibility: 'public', stars: undefined,
            pullRequests: undefined, issues: undefined, followers: 0,
            privateRepositories: undefined, totalBytes: undefined,
            languageCoverage: 'unavailable', languages: [], scope: 'Public profile only' });
        original.githubActivity = undefined;
        const { handler } = app(original);
        const query = { github: 'owner', view: 'github' };
        const data = await json(handler, query);
        expect(data.github.data?.stars).toBeUndefined();
        expect(data.github.data?.followers).toBe(0);
        expect(data.languageRows).toEqual([]);
        const svg = await card(handler, query);
        expect(svg).toContain('STARS RECEIVED: —');
        expect(svg).toContain('FOLLOWERS: 0');
        expect(svg).toContain('data-language-unavailable="github"');
        expect(svg).not.toContain('data-code-bar');
    });

    it('drops mismatched public GitHub and WakaTime identities', async () => {
        const { handler } = app();
        const data = await json(handler, { github: 'visitor', wakatime: 'visitor-time' });
        expect(data.github.data).toBeNull();
        expect(data.wakatime.data).toBeNull();
        expect(data.github.lastSuccessAt).toBeNull();
        expect(data.wakatime.lastSuccessAt).toBeNull();
        expect(JSON.stringify(data)).not.toContain('73740');
    });

    it('rejects a same-name OAuth WakaTime snapshot for an anonymous selector', async () => {
        const original = fixture();
        original.wakatime.data!.accessMode = 'oauth';
        original.wakatime.lastError = 'private-oauth-error-fixture';
        const { handler } = app(original);
        const query = { wakatime: 'owner-time' };
        const data = await json(handler, query);
        expect(data.wakatime).toMatchObject({ data: null, lastSuccessAt: null,
            lastAttemptAt: null, retryAt: null, status: 'unavailable' });
        const text = JSON.stringify(data) + await card(handler, query);
        expect(text).not.toContain('73740');
        expect(text).not.toContain(observed.wakatime);
        expect(text).not.toContain('private-oauth-error-fixture');
    });
});

describe('HTTP query validation before reading state', () => {
    it.each([
        ['github', 'https://github.com/owner'], ['github', 'two--hyphens'],
        ['github', ''], ['wakatime', 'user/path'], ['wakatime', '_leading'],
        ['codex', 'https://chatgpt.com/u/owner'], ['codex', '../owner'],
        ['codex', '.'], ['codex', 'user?other'],
        ['sources', ''], ['sources', 'github,github'], ['sources', 'github,'],
        ['sources', 'unknown'], ['sources', 'anthropic'],
        ['token', 'private-fixture-value'], ['github_token', 'private-fixture-value'],
        ['apiKey', 'private-fixture-value'], ['authorization', 'private-fixture-value'],
        ['openrouter_api_key', 'private-fixture-value'],
    ])('rejects invalid %s without reading snapshots or echoing credentials', async (name, value) => {
        const { handler, reader } = app();
        const response = await handler.fetch(request('/api/stats', { [name]: value }), settings);
        expect(response.status).toBe(400);
        expect(reader).not.toHaveBeenCalled();
        expect(await response.text()).not.toContain('private-fixture-value');
    });

    it.each(['github=alice&github=bob', 'sources=github&sources=codex',
        'GitHub=owner', 'github=owner&GitHub=visitor'])
        ('rejects ambiguous query selectors %s', async query => {
            const { handler, reader } = app();
            const response = await handler.fetch(new Request(
                'https://cards.example.invalid/card.svg?' + query,
            ), settings);
            expect(response.status).toBe(400);
            expect(reader).not.toHaveBeenCalled();
        });
});
