import { describe, expect, it } from 'vitest';
import { joinLanguages, renderCard, renderPage } from '../src/render';
import type { CardOptions, StatsSnapshot } from '../src/types';

const options: CardOptions = {
    theme: 'dark', view: 'overview', limit: 8, sort: 'time',
};

function snapshot(): StatsSnapshot {
    return {
        schemaVersion: 1,
        range: 'all_time',
        generatedAt: '2026-10-25T17:00:00Z',
        github: {
            status: 'fresh', lastSuccessAt: '2026-10-25T16:00:00Z',
            lastAttemptAt: '2026-10-25T16:00:00Z', lastError: null, retryAt: null,
            data: {
                username: 'Leask', name: 'Leask', followers: 20,
                publicRepositories: 198, analyzedRepositories: 75,
                stars: 1250, forks: 30, pullRequests: 80,
                mergedPullRequests: 60, issues: 50,
                totalBytes: 1000, scope: 'Owned public non-fork repositories',
                languages: [
                    { name: 'Shell', bytes: 200, color: '#89e051' },
                    { name: 'TypeScript', bytes: 500, color: '#3178c6' },
                    { name: 'C++', bytes: 300, color: '#f34b7d' },
                ],
            },
        },
        wakatime: {
            status: 'fresh', lastSuccessAt: '2026-10-25T15:30:00Z',
            lastAttemptAt: '2026-10-25T15:30:00Z', lastError: null, retryAt: null,
            data: {
                username: 'leask', range: 'all_time', totalSeconds: 10000,
                dailyAverageSeconds: 300, start: '2020-01-01',
                end: '2026-10-24', includesToday: false, rangeLabel: 'since 2020-01-01',
                languages: [
                    { name: 'Bash', seconds: 5000, percent: 50 },
                    { name: 'Other', seconds: 3000, percent: 30 },
                    { name: 'TypeScript', seconds: 2000, percent: 20 },
                ],
            },
        },
    };
}

describe('language comparison', () => {
    it('uses explicit aliases without inventing a common denominator', () => {
        const rows = joinLanguages(snapshot());
        const shell = rows.find((row) => row.name === 'Bash')!;
        expect(shell.timePercent).toBe(50);
        expect(shell.codePercent).toBe(20);
        expect(rows.find((row) => row.name === 'Other')!.codePercent).toBeNull();
        expect(rows.find((row) => row.name === 'C++')!.timePercent).toBe(0);
        expect(rows.find((row) => row.name === 'C++')!.codePercent).toBe(30);
    });

    it('preserves upstream percentages instead of renormalizing visible languages', () => {
        const data = snapshot();
        data.wakatime.data!.languages = [
            { name: 'TypeScript', seconds: 42, percent: 3.25 },
        ];
        expect(joinLanguages(data).find((row) => row.name === 'TypeScript')!.timePercent)
            .toBe(3.25);
    });

    it('has no code percentage when GitHub is unavailable and never maps Other', () => {
        const data = snapshot();
        data.github.data = null;
        data.github.status = 'unavailable';
        expect(joinLanguages(data).every((row) => row.codePercent === null)).toBe(true);
        const svg = renderCard(data, options);
        expect(svg).toContain('PARTIAL DATA');
        expect(svg).toContain('GitHub · unavailable');
        expect(svg).not.toContain('NaN');
    });

    it('can order code first and combine duplicate aliases once', () => {
        const data = snapshot();
        data.wakatime.data!.languages.push({ name: 'Shell', seconds: 10, percent: 0.1 });
        const rows = joinLanguages(data, 'code');
        expect(rows[0].name).toBe('TypeScript');
        const bash = rows.find((row) => row.name === 'Bash')!;
        expect(bash.seconds).toBe(5010);
        expect(bash.codeBytes).toBe(200);
        expect(rows).toHaveLength(4);
    });

    it('orders time by precise seconds when upstream percentages round to zero', () => {
        const data = snapshot();
        data.wakatime.data!.languages = [
            { name: 'A small time language', seconds: 2258, percent: 0 },
        ];
        data.github.data!.languages = [
            { name: 'G-code', bytes: 1000, color: '#d08cf2' },
        ];
        const rows = joinLanguages(data, 'time');
        expect(rows[0].name).toBe('A small time language');
        expect(rows[0].seconds).toBe(2258);
        expect(rows[0].timePercent).toBe(0);
        expect(rows[1].name).toBe('G-code');
        expect(rows[1].seconds).toBe(0);
        expect(rows[1].codePercent).toBe(100);
    });
});

describe('safe README SVG', () => {
    it('escapes labels and validates color instead of allowing SVG injection', () => {
        const data = snapshot();
        data.github.data!.username = '<script>alert("x")</script>';
        data.wakatime.data!.languages[0].name = '<image href="evil">';
        data.github.data!.languages[0].color = '"><script>alert(1)</script>';
        const svg = renderCard(data, options);
        expect(svg).not.toContain('<script>');
        expect(svg).not.toContain('<image href=');
        expect(svg).toContain('&lt;script&gt;');
        expect(svg).not.toContain('foreignObject');
        expect(svg).not.toMatch(/<(?:image|use|script)\b/);
    });

    it('discloses each saved source timestamp and its stale state', () => {
        const data = snapshot();
        data.github.status = 'stale';
        data.github.lastError = 'upstream timeout';
        const svg = renderCard(data, options);
        expect(svg).toContain('SAVED SNAPSHOT');
        expect(svg).toContain('GitHub · saved data · refresh unavailable · 2026-10-25 16:00 UTC');
        expect(svg).toContain('WakaTime · fresh · 2026-10-25 15:30 UTC');
        expect(svg).toContain('through 2026-10-24 · today excluded by source');
        expect(svg).toContain('75 non-forks analyzed');
    });

    it('distinguishes an overdue refresh from a failed refresh', () => {
        const data = snapshot();
        data.github.status = 'stale';
        data.github.lastError = null;
        const svg = renderCard(data, options);
        expect(svg).toContain('GitHub · saved data · refresh due · 2026-10-25 16:00 UTC');
        expect(svg).not.toContain('refresh unavailable');
    });

    it('supports the endpoint maximum of100 rows and keeps language duration below its label', () => {
        const data = snapshot();
        data.wakatime.data!.languages = Array.from({ length: 103 }, (_, i) => ({
            name: `Language ${String(i).padStart(3, '0')}`,
            seconds: 5000,
            percent: 0.1,
        }));
        data.github.data!.languages = [];
        const svg = renderCard(data, { ...options, limit: 100 });
        expect(svg.match(/<g><title>/g)).toHaveLength(100);
        expect(svg).toContain('+ 3 more language mappings');
        expect(svg).toContain('x="49" y="303" font-size="10"');
        expect(svg).not.toContain('x="207" y="289"');
    });

    it('renders honest empty state, activity and transparent variants', () => {
        const data = snapshot();
        expect(renderCard(data, { ...options, view: 'activity' })).toContain('Public PRs opened');
        expect(renderCard(data, { ...options, theme: 'transparent' })).toContain('fill="none"');
        data.github.data = null;
        data.wakatime.data = null;
        data.github.status = 'unavailable';
        data.wakatime.status = 'unavailable';
        data.github.lastSuccessAt = null;
        data.wakatime.lastSuccessAt = null;
        const svg = renderCard(data, options);
        expect(svg).toContain('Waiting for the first successful source snapshot.');
        expect(svg).toContain('no successful snapshot yet');
    });

    it('uses the upstream all-time label when dates are absent and adapts transparent colors', () => {
        const data = snapshot();
        data.wakatime.data!.start = null;
        data.wakatime.data!.end = null;
        data.wakatime.data!.rangeLabel = 'since Dec 11, 2014';
        const svg = renderCard(data, { ...options, theme: 'transparent' });
        expect(svg).toContain('since Dec 11, 2014');
        expect(svg).toContain('today excluded by source');
        expect(svg).not.toContain('through 2026-10-25');
        expect(svg).toContain('@media(prefers-color-scheme:dark)');
    });

    it('builds a self-contained preview with native details and safe DOM rendering', () => {
        const html = renderPage();
        expect(html).toContain('<details id="language-details">');
        expect(html).toContain('/api/stats?range=');
        expect(html).toContain('Localhost images cannot load on GitHub.');
        expect(html).toContain("document.createTextNode(row.name)");
        expect(html).not.toContain('.innerHTML');
        expect(html).not.toContain('https://cdn.');
    });
});
