import { describe, expect, it } from 'vitest';
import { createHandler } from '../src/app';
import type {
    LanguageRow, Settings, SourceSnapshot, StatsSnapshot,
} from '../src/types';

const settings: Settings = {
    GITHUB_USERNAME: 'test', WAKATIME_USERNAME: 'test',
    DEFAULT_RANGE: 'all_time', FRESH_SECONDS: '21600', RETRY_SECONDS: '900',
};

function languageSnapshot(): StatsSnapshot {
    const successful = <T>(data: T): SourceSnapshot<T> => ({
        data, lastSuccessAt: '2026-10-28T12:00:00Z',
        lastAttemptAt: '2026-10-28T12:00:00Z', lastError: null,
        retryAt: null, status: 'fresh',
    });
    return {
        schemaVersion: 1, range: 'all_time',
        generatedAt: '2026-10-28T12:00:00Z',
        github: successful({
            collectionVersion: 7, username: 'test', name: 'Test', followers: 4,
            visibility: 'all', publicRepositories: 3, privateRepositories: 2,
            repositories: 5, analyzedRepositories: 5, stars: 1, forks: 1,
            pullRequests: 2, mergedPullRequests: 1, issues: 1,
            totalBytes: 105, scope: 'Selected owner, organization and collaborator scope',
            languages: [
                { name: 'JavaScript', bytes: 40, color: '#f1e05a' },
                { name: 'TypeScript', bytes: 30, color: '#3178c6' },
                { name: 'Python', bytes: 20, color: '#3572a5' },
                { name: 'Rust', bytes: 10, color: '#dea584' },
                { name: 'JSON', bytes: 3, color: '#292929' },
                { name: 'YAML', bytes: 1, color: '#cb171e' },
                { name: 'TOML', bytes: 1, color: '#9c4221' },
            ],
            repositoryLanguageCounts: [
                { languages: ['JavaScript', 'Python', 'TypeScript'], repositories: 2 },
                { languages: ['JSON', 'Python', 'Rust', 'YAML'], repositories: 1 },
                { languages: ['TOML'], repositories: 1 },
                { languages: [], repositories: 1 },
            ],
        }),
        wakatime: successful({
            username: 'test', range: 'all_time', totalSeconds: 100,
            dailyAverageSeconds: 10, start: null, end: null,
            includesToday: false, rangeLabel: 'since 2020',
            languages: [
                { name: 'Python', seconds: 60, percent: 60 },
                { name: 'TypeScript', seconds: 30, percent: 30 },
                { name: 'Rust', seconds: 10, percent: 10 },
            ],
        }),
    };
}

describe('public repository-count rows', () => {
    it('publishes deduplicated groups without exposing or mutating membership data', async () => {
        const snapshot = languageSnapshot();
        const before = structuredClone(snapshot);
        const handler = createHandler(async () => snapshot);
        const response = await handler.fetch(new Request(
            'https://test.invalid/api/stats?limit=2&sort=code',
        ), settings);
        const text = await response.text();
        const data = JSON.parse(text);
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(text).not.toContain('repositoryLanguageCounts');
        expect(data.github.data.repositories).toBe(5);
        expect(data.languageRows.map((row: LanguageRow) => [
            row.name, row.repositoryCount,
        ])).toEqual([
            ['JavaScript/TypeScript', 2], ['Others', 4],
        ]);
        expect(snapshot).toEqual(before);
        const svg = await (await handler.fetch(new Request(
            'https://test.invalid/card.svg?limit=2&sort=code',
        ), settings)).text();
        expect(svg).toContain('JavaScript/TypeScript: 2 repos;');
        expect(svg).toContain('Others: 4 repos;');
        expect(svg).not.toContain('repositoryLanguageCounts');
        expect(snapshot).toEqual(before);
    });

    it('computes Others as a union for the requested limit and display order', async () => {
        const handler = createHandler(async () => languageSnapshot());
        const response = await handler.fetch(new Request(
            'https://test.invalid/api/stats?limit=3&sort=time',
        ), settings);
        const data = JSON.parse(await response.text());
        expect(data.languageRows.map((row: LanguageRow) => [
            row.name, row.repositoryCount,
        ])).toEqual([
            ['Python', 3], ['JavaScript/TypeScript', 2], ['Others', 2],
        ]);
        const allOther = await handler.fetch(new Request(
            'https://test.invalid/api/stats?limit=1&sort=name',
        ), settings);
        const only = JSON.parse(await allOther.text());
        expect(only.languageRows).toHaveLength(1);
        expect(only.languageRows[0]).toMatchObject({
            name: 'Others', repositoryCount: 4, codeBytes: 105, seconds: 100,
        });
        // A language-empty repository contributes to the headline, not Others.
        expect(only.github.data.repositories).toBe(5);
    });

    it('keeps repository counts unknown for an older saved GitHub collection', async () => {
        const snapshot = languageSnapshot();
        snapshot.github.data!.collectionVersion = 6;
        delete snapshot.github.data!.repositoryLanguageCounts;
        snapshot.github.status = 'stale';
        const handler = createHandler(async () => snapshot);
        const response = await handler.fetch(new Request(
            'https://test.invalid/api/stats?limit=2',
        ), settings);
        const data = JSON.parse(await response.text());
        expect(data.github.data.collectionVersion).toBe(6);
        expect(data.github.status).toBe('stale');
        expect(data.languageRows.every((row: LanguageRow) =>
            row.repositoryCount === null)).toBe(true);
        const svg = await (await handler.fetch(new Request(
            'https://test.invalid/card.svg?limit=2',
        ), settings)).text();
        expect(svg).toContain('— repos');
        expect(svg).not.toContain('>0 repos</text>');
    });

    it('distinguishes a known WakaTime-only language count from unavailable data', async () => {
        const snapshot = languageSnapshot();
        snapshot.wakatime.data!.totalSeconds = 105;
        snapshot.wakatime.data!.languages.push({
            name: 'Go', seconds: 5, percent: 100 * 5 / 105,
        });
        const handler = createHandler(async () => snapshot);
        const response = await handler.fetch(new Request(
            'https://test.invalid/api/stats?limit=100',
        ), settings);
        const data = JSON.parse(await response.text());
        expect(data.languageRows.find((row: LanguageRow) => row.name === 'Go'))
            .toMatchObject({ repositoryCount: 0, codeBytes: 0 });
        snapshot.github.data = null;
        const missing = await handler.fetch(new Request(
            'https://test.invalid/api/stats?limit=100',
        ), settings);
        const unavailable = JSON.parse(await missing.text());
        expect(unavailable.github.data).toBeNull();
        expect(unavailable.languageRows.every((row: LanguageRow) =>
            row.repositoryCount === null)).toBe(true);
    });
});

describe('shared snapshot failure responses', () => {
    const handler = createHandler(async () => {
        throw new Error('private native exception that must never be published');
    });

    it('reports binding presence independently of cached errors without values', async () => {
        const request = new Request('https://test.invalid/health');
        const missing = await handler.fetch(request, settings);
        expect(JSON.parse(await missing.text()).configuration).toEqual({
            githubTokenConfigured: false, wakatimeTokenConfigured: false,
        });
        const configured = await handler.fetch(request, {
            ...settings, GITHUB_TOKEN: 'isolated-github-fixture',
            WAKATIME_TOKEN: 'isolated-waka-fixture',
        });
        expect(configured.headers.get('cache-control')).toBe('no-store');
        const body = await configured.text();
        expect(JSON.parse(body).configuration).toEqual({
            githubTokenConfigured: true, wakatimeTokenConfigured: true,
        });
        expect(body).not.toContain('isolated-');
    });

    it.each(['/', '/card.svg', '/api/stats'])(
        'returns a sanitized, uncached service error for %s', async path => {
            const response = await handler.fetch(
                new Request('https://test.invalid' + path), settings,
            );
            expect(response.status).toBe(503);
            expect(response.headers.get('cache-control')).toBe('no-store');
            const body = await response.text();
            expect(body).toContain('snapshot_unavailable');
            expect(body).not.toContain('private native exception');
            expect(body).not.toContain('saved snapshot');
        },
    );

    it.each(['0', 'no', 'FALSE', ''])(
        'rejects invalid header=%s before reading the snapshot', async value => {
            const response = await handler.fetch(
                new Request('https://test.invalid/?header=' + value), settings,
            );
            expect(response.status).toBe(400);
            expect(await response.text()).toBe('Header must be true or false.');
        },
    );

    it('keeps the builder available without reading a broken snapshot', async () => {
        const response = await handler.fetch(
            new Request('https://test.invalid/build'), settings,
        );
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('Copy Markdown');
        const customRange = await handler.fetch(
            new Request('https://test.invalid/build'),
            { ...settings, DEFAULT_RANGE: 'last_7_days' },
        );
        expect(await customRange.text()).toContain('range: "last_7_days"');
        const head = await handler.fetch(
            new Request('https://test.invalid/', { method: 'HEAD' }), settings,
        );
        expect(head.status).toBe(503);
        expect(await head.text()).toBe('');
    });
});
