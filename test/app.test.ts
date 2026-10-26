import { describe, expect, it } from 'vitest';
import { createHandler } from '../src/app';
import type { Settings } from '../src/types';

const settings: Settings = {
    GITHUB_USERNAME: 'test', WAKATIME_USERNAME: 'test',
    DEFAULT_RANGE: 'all_time', FRESH_SECONDS: '21600', RETRY_SECONDS: '900',
};

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
