import { describe, expect, it } from 'vitest';
import {
    displayLanguages, joinLanguages, renderCard, renderPage, selectLanguages,
    timeRangeLabel, refreshAge,
} from '../src/render';
import type { CardOptions, LanguageRow, StatsSnapshot } from '../src/types';
import { LANGUAGE_ICONS, languageIcon } from '../src/language-icons';

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

function activitySnapshot(): StatsSnapshot {
    const data = snapshot();
    data.githubActivity = {
        status: 'fresh', lastSuccessAt: '2026-10-25T14:00:00Z',
        lastAttemptAt: '2026-10-25T14:00:00Z', lastError: null, retryAt: null,
        data: {
            username: 'Leask', visibility: 'all',
            scope: 'Token-visible personal contributions across organizations',
            commits: 98765, pullRequestsCommented: 321,
            pullRequestsReviewed: 432, issuesCommented: 543,
            discussionsStarted: 21, discussionsAnswered: 12,
            reviewContributions: 654, contributedRepositories: 87,
            allTimeContributedRepositories: 234, allTimeContributions: 456789,
            contributionsByYear: [
                { year: 2025, contributions: 12345 },
                { year: 2026, contributions: 23456 },
            ],
            recentFrom: '2025-10-25T17:00:00Z',
            recentTo: '2026-10-25T17:00:00Z',
            allTimeFrom: '2010-03-01T00:00:00Z',
            allTimeTo: '2026-10-25T17:00:00Z', organizationCount: 4,
        },
    };
    return data;
}

function rankedSnapshot(time: string[], code: string[]): StatsSnapshot {
    const data = snapshot();
    data.wakatime.data!.languages = time.map((name, index) => ({
        name, seconds: (time.length - index) * 100, percent: time.length - index,
    }));
    data.github.data!.languages = code.map((name, index) => ({
        name, bytes: (code.length - index) * 100, color: '#3178c6',
    }));
    data.github.data!.totalBytes = data.github.data!.languages
        .reduce((sum, language) => sum + language.bytes, 0);
    return data;
}

describe('language comparison', () => {
    it('sets displayed Others to100 minus displayed named shares at each precision', () => {
        const rows: LanguageRow[] = [33.35, 33.35, 33.3].map((share, index) => ({
            name: ['A', 'B', 'Others'][index], color: '#3178c6',
            seconds: share * 100, timePercent: share,
            codeBytes: [1004, 1004, 7992][index],
            codePercent: [10.04, 10.04, 79.92][index],
        }));
        const before = JSON.stringify(rows);
        const card = displayLanguages(rows, 1);
        expect(card.map(row => row.timePercent)).toEqual([33.4, 33.4, 33.2]);
        expect(card.map(row => row.codePercent)).toEqual([10, 10, 80]);
        const table = displayLanguages(rows, 2);
        expect(table.map(row => row.timePercent)).toEqual([33.35, 33.35, 33.3]);
        expect(table.map(row => row.codePercent)).toEqual([10.04, 10.04, 79.92]);
        for (const [result, scale] of [[card, 10], [table, 100]] as const) {
            for (const field of ['timePercent', 'codePercent'] as const) {
                expect(result.reduce((sum, row) =>
                    sum + Math.round(row[field]! * scale), 0)).toBe(100 * scale);
            }
            expect(result.map(row => [row.seconds, row.codeBytes]))
                .toEqual(rows.map(row => [row.seconds, row.codeBytes]));
        }
        expect(JSON.stringify(rows)).toBe(before);
    });

    it('avoids negative Others when named rounding alone exceeds100 percent', () => {
        const rows: LanguageRow[] = [33.36, 33.36, 33.27, 0.01]
            .map((share, index) => ({
                name: ['A', 'B', 'D', 'Others'][index], color: '#3178c6',
                seconds: share, timePercent: share,
                codeBytes: share, codePercent: share,
            }));
        const result = displayLanguages(rows, 1);
        expect(result.at(-1)!.timePercent).toBe(0);
        expect(result.every(row => row.timePercent >= 0)).toBe(true);
        expect(result.reduce((sum, row) =>
            sum + Math.round(row.timePercent * 10), 0)).toBe(1000);
        expect(result.reduce((sum, row) =>
            sum + Math.round(row.codePercent! * 10), 0)).toBe(1000);
    });

    it('does not turn missing, empty or incomplete shares into100 percent', () => {
        const row: LanguageRow = {
            name: 'Others', color: '#8791a3', seconds: 0, timePercent: 0,
            codeBytes: null, codePercent: null,
        };
        expect(displayLanguages([row], 1)).toEqual([row]);
        row.timePercent = 70;
        expect(displayLanguages([row], 2)[0].timePercent).toBe(70);
        expect(displayLanguages([row], 2)[0].codePercent).toBeNull();
        expect(displayLanguages([], 1)).toEqual([]);
    });

    it('combines engineering families before selecting either source ranking', () => {
        const data = rankedSnapshot(
            ['reStructuredText', 'Python', 'Cython', 'Jupyter Notebook',
                'XML', 'JSON with Comments', 'YAML', 'TOML', 'INI',
                'GLSL', 'HLSL', 'Metal', 'ShaderLab', 'Vue.js', 'Jade', 'CSS'],
            ['Markdown', 'Python', 'JSON', 'TSConfig', 'Sublime Text Config',
                'HTML', 'Vue', 'Mustache', 'Go Template', 'CSS', 'SCSS', 'Less'],
        );
        const before = JSON.stringify(data);
        const rows = joinLanguages(data);
        const byName = new Map(rows.map(row => [row.name, row]));
        expect([...byName.keys()].sort()).toEqual([
            'HTML/CSS', 'JSON/YAML/TOML/INI', 'Markdown/Text',
            'Python', 'Shaders',
        ]);
        expect(byName.get('Python')).toMatchObject({ seconds: 4200, codeBytes: 1100 });
        expect(byName.get('HTML/CSS')).toMatchObject({ seconds: 600, codeBytes: 2800 });
        expect(byName.get('Shaders')).toMatchObject({ seconds: 2200, codeBytes: 0 });
        expect(rows.reduce((sum, row) => sum + row.seconds, 0)).toBe(13600);
        expect(rows.reduce((sum, row) => sum + (row.codeBytes ?? 0), 0)).toBe(7800);
        expect(JSON.stringify(data)).toBe(before);
    });

    it('groups Makefile with C/C++ and Awk with Shell before ranking', () => {
        const data = rankedSnapshot(
            ['Makefile', 'C', 'AWK', 'Bash'],
            ['Makefile', 'C++', 'Awk', 'Shell'],
        );
        data.wakatime.data!.totalSeconds = 1000;
        const before = JSON.stringify(data);
        const rows = joinLanguages(data);
        expect(rows.map(row => [row.name, row.seconds, row.codeBytes]))
            .toEqual([['C/C++', 700, 700], ['Shell', 300, 300]]);
        expect(rows.reduce((sum, row) => sum + row.timePercent, 0)).toBe(100);
        expect(rows.reduce((sum, row) => sum + row.codePercent!, 0)).toBe(100);
        expect(JSON.stringify(data)).toBe(before);
    });

    it('selects nine named leaders without Other, then sorts by time and sums the tail', () => {
        const data = rankedSnapshot(
            ['A', 'B', 'LangC', 'D', 'E', 'F'],
            ['U', 'V', 'W', 'X', 'Y', 'Z'],
        );
        data.wakatime.data!.languages.push({ name: 'Other', seconds: 10000, percent: 80 });
        data.wakatime.data!.totalSeconds = 12100;
        const all = joinLanguages(data);
        const before = JSON.stringify(all);
        const rows = selectLanguages(all);
        expect(rows.map(row => row.name)).toEqual([
            'A', 'B', 'LangC', 'D', 'U', 'V', 'W', 'X', 'Y', 'Others',
        ]);
        expect(rows[9]).toMatchObject({ seconds: 10300, codeBytes: 100 });
        expect(rows.reduce((sum, row) => sum + row.seconds, 0)).toBe(12100);
        expect(rows.reduce((sum, row) => sum + (row.codeBytes ?? 0), 0)).toBe(2100);
        expect(rows.reduce((sum, row) => sum + row.timePercent, 0)).toBeCloseTo(100);
        expect(rows.reduce((sum, row) => sum + (row.codePercent ?? 0), 0)).toBeCloseTo(100);
        expect(JSON.stringify(all)).toBe(before);
        expect(selectLanguages(all, 'code').slice(0, 4).map(row => row.name))
            .toEqual(['U', 'V', 'W', 'X']);
        expect(selectLanguages(all, 'name').at(-1)!.name).toBe('Others');
    });

    it('handles short lists, a one-row card and missing sources without losing totals', () => {
        const data = snapshot();
        const rows = selectLanguages(joinLanguages(data));
        expect(rows.map(row => row.name))
            .toEqual(['Shell', 'JavaScript/TypeScript', 'C/C++', 'Others']);
        expect(rows.at(-1)).toMatchObject({ seconds: 3000, codeBytes: 0, codePercent: 0 });
        expect(selectLanguages(joinLanguages(data), 'time', 1))
            .toMatchObject([{ name: 'Others', seconds: 10000, codeBytes: 1000 }]);
        data.github.data = null;
        expect(selectLanguages(joinLanguages(data)).every(row => row.codePercent === null))
            .toBe(true);
        data.wakatime.data = null;
        expect(selectLanguages(joinLanguages(data))).toEqual([]);
    });

    it('uses exact seconds to conserve100 percent despite upstream rounding', () => {
        const data = rankedSnapshot(['A', 'B', 'D'], ['U', 'V']);
        data.wakatime.data!.totalSeconds = 10000;
        data.wakatime.data!.languages = [
            { name: 'A', seconds: 3333, percent: 33.3 },
            { name: 'B', seconds: 3333, percent: 33.3 },
            { name: 'D', seconds: 3334, percent: 33.3 },
        ];
        const rows = selectLanguages(joinLanguages(data), 'time', 3);
        expect(rows.map(row => row.name)).toEqual(['D', 'U', 'Others']);
        expect(rows.reduce((sum, row) => sum + row.timePercent, 0)).toBeCloseTo(100);
        expect(rows.reduce((sum, row) => sum + (row.codePercent ?? 0), 0)).toBeCloseTo(100);
    });

    it('sums families before ranking and preserves both source totals', () => {
        const data = snapshot();
        data.wakatime.data!.totalSeconds = 200;
        data.wakatime.data!.languages = [
            { name: 'JavaScript', seconds: 40, percent: 20 },
            { name: 'TypeScript', seconds: 35, percent: 17.5 },
            { name: 'JSX', seconds: 5, percent: 2.5 },
            { name: 'TSX', seconds: 10, percent: 5 },
            { name: 'Python', seconds: 60, percent: 30 },
            { name: 'Markdown', seconds: 20, percent: 10 },
            { name: 'Text', seconds: 30, percent: 15 },
        ];
        data.github.data!.languages = [
            ['C', 40], ['C++', 30], ['Python', 60],
            ['JavaScript', 20], ['TypeScript', 30], ['Markdown', 8], ['Text', 12],
        ].map(([name, bytes]) => ({
            name: name as string, bytes: bytes as number, color: '#3178c6',
        }));
        data.github.data!.totalBytes = 200;
        const before = JSON.stringify(data);
        const rows = joinLanguages(data);
        expect(rows.map(row => row.name)).toEqual([
            'C/C++', 'JavaScript/TypeScript', 'Python', 'Markdown/Text',
        ]);
        expect(rows[1]).toMatchObject({ seconds: 90, timePercent: 45,
            codeBytes: 50, codePercent: 25 });
        expect(rows[0]).toMatchObject({ codeBytes: 70, codePercent: 35 });
        expect(rows[3]).toMatchObject({ seconds: 50, timePercent: 25,
            codeBytes: 20, codePercent: 10 });
        expect(rows.reduce((sum, row) => sum + row.seconds, 0)).toBe(200);
        expect(rows.reduce((sum, row) => sum + row.timePercent, 0)).toBe(100);
        expect(rows.reduce((sum, row) => sum + (row.codeBytes ?? 0), 0)).toBe(200);
        expect(JSON.stringify(data)).toBe(before);
    });

    it('groups explicit shell/SQL dialects without merging unrelated languages', () => {
        const data = rankedSnapshot(
            ['Bash', 'Zsh', 'Fish', 'SQL', 'PLpgSQL', 'TSQL'],
            ['Shell', 'SQL', 'C#', 'Java', 'HTML', 'CSS', 'JSON', 'YAML'],
        );
        const rows = joinLanguages(data);
        expect(rows.find(row => row.name === 'Shell')!.seconds).toBe(1500);
        expect(rows.find(row => row.name === 'SQL')!.seconds).toBe(600);
        for (const name of ['C#', 'Java', 'HTML/CSS', 'JSON/YAML/TOML/INI']) {
            expect(rows.some(row => row.name === name)).toBe(true);
        }
        expect(rows).toHaveLength(6);
    });

    it('alternates the two rankings and selects ten distinct leaders', () => {
        const data = rankedSnapshot(
            ['A', 'B', 'LangC', 'D', 'E', 'F'],
            ['U', 'V', 'W', 'X', 'Y', 'Z'],
        );
        const expected = ['U', 'A', 'V', 'B', 'W', 'LangC', 'X', 'D', 'Y', 'E'];
        expect(joinLanguages(data).slice(0, 10).map(row => row.name))
            .toEqual(expected);
        const svg = renderCard(data, { ...options, sort: 'alternating', limit: 10 });
        expect([...svg.matchAll(/<g><title>([^:]+): WakaTime/g)]
            .map(match => match[1])).toEqual([...expected.slice(0, 9), 'Others']);
    });

    it('merges repeated selections and keeps advancing until ten unique rows', () => {
        const data = rankedSnapshot(
            ['A', 'B', 'LangC', 'D', 'E', 'F', 'G', 'H'],
            ['B', 'A', 'X', 'Y', 'Z', 'Q', 'R', 'S'],
        );
        const rows = joinLanguages(data);
        expect(rows.slice(0, 10).map(row => row.name))
            .toEqual(['B', 'A', 'X', 'LangC', 'Y', 'D', 'Z', 'E', 'Q', 'F']);
        expect(new Set(rows.map(row => row.name)).size).toBe(rows.length);
        expect(rows[1]).toMatchObject({ seconds: 800, codeBytes: 700 });
    });

    it('merges aliases before alternating and falls back to the available source', () => {
        const data = rankedSnapshot(['Bash', 'Python'], ['Shell', 'C/C++']);
        expect(joinLanguages(data).map(row => row.name))
            .toEqual(['Shell', 'C/C++', 'Python']);
        expect(joinLanguages(data)[0]).toMatchObject({ seconds: 200, codeBytes: 200 });
        data.wakatime.data = null;
        expect(joinLanguages(data).map(row => row.name)).toEqual(['Shell', 'C/C++']);
        const timeOnly = snapshot();
        timeOnly.github.data = null;
        expect(joinLanguages(timeOnly).map(row => row.name))
            .toEqual(['Shell', 'Other', 'JavaScript/TypeScript']);
    });

    it('uses explicit aliases without inventing a common denominator', () => {
        const rows = joinLanguages(snapshot());
        const shell = rows.find((row) => row.name === 'Shell')!;
        expect(shell.timePercent).toBe(50);
        expect(shell.codePercent).toBe(20);
        expect(rows.find((row) => row.name === 'Other')!.codePercent).toBeNull();
        expect(rows.find((row) => row.name === 'C/C++')!.timePercent).toBe(0);
        expect(rows.find((row) => row.name === 'C/C++')!.codePercent).toBe(30);
    });

    it('uses the full source seconds denominator rather than rounded percentages', () => {
        const data = snapshot();
        data.wakatime.data!.languages = [
            { name: 'TypeScript', seconds: 42, percent: 3.25 },
        ];
        expect(joinLanguages(data).find((row) => row.name === 'JavaScript/TypeScript')!.timePercent)
            .toBe(0.42);
    });

    it('has no code percentage when GitHub is unavailable and never maps Other', () => {
        const data = snapshot();
        data.github.data = null;
        data.github.status = 'unavailable';
        expect(joinLanguages(data).every((row) => row.codePercent === null)).toBe(true);
        const svg = renderCard(data, options);
        expect(svg).toContain(' · unavailable · ');
        expect(svg).toContain('GitHub · unavailable');
        expect(svg).not.toContain('NaN');
    });

    it('can order code first and combine duplicate aliases once', () => {
        const data = snapshot();
        data.wakatime.data!.languages.push({ name: 'Shell', seconds: 10, percent: 0.1 });
        const rows = joinLanguages(data, 'code');
        expect(rows[0].name).toBe('JavaScript/TypeScript');
        const bash = rows.find((row) => row.name === 'Shell')!;
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
        expect(rows[0].timePercent).toBe(22.58);
        expect(rows[1].name).toBe('G-code');
        expect(rows[1].seconds).toBe(0);
        expect(rows[1].codePercent).toBe(100);
    });
});

describe('safe README SVG', () => {
    it.each(['overview', 'languages', 'activity'] as const)(
        'hides only the profile block and closes its gap in the %s view', view => {
            const data = activitySnapshot();
            const full = renderCard(data, { ...options, view });
            const hidden = renderCard(data, { ...options, view, header: false });
            expect(full).toContain('data-profile-header="true"');
            expect(hidden).not.toContain('data-profile-header');
            expect(hidden).not.toContain('data-profile-name');
            expect(hidden).not.toContain('data-profile-description');
            expect(hidden).toContain('data-profile-rank');
            expect(hidden).toContain('data-rank-icon="true"');
            expect(hidden.indexOf('data-profile-rank'))
                .toBeLessThan(hidden.indexOf('data-refresh-times'));
            expect(hidden.match(/data-summary-metric=/g)).toHaveLength(8);
            expect(hidden).toContain('data-refresh-times="true"');
            expect(hidden).toContain('data-project-credit="true"');
            const height = (svg: string) => Number(svg.match(/height="(\d+)"/)![1]);
            expect(height(full) - height(hidden)).toBe(100);
            expect(renderCard(data, { ...options, view, header: true })).toBe(full);
        },
    );

    it('shows two relative refresh ages and linked project credit in a compact footer', () => {
        const svg = renderCard(snapshot(), options);
        expect(svg).toContain('GitHub: 1 hr, 0 mins ago | WakaTime: 1 hr, 30 mins ago');
        expect(svg).toContain('data-refresh-times="true"');
        expect(svg).not.toContain('data-profile-rank');
        expect(svg).toContain('data-project-credit="true" href="https://github.com/Leask/CodeStats"');
        expect(svg).toContain('>Power by github.com/Leask/<tspan');
        expect(svg).toContain('font-weight="650">CodeStats</tspan>');
        expect(svg).not.toContain('>CODESTATS</text>');
        expect(svg).not.toContain('FRESH SNAPSHOT');
        expect(svg).not.toContain('groups · full source totals');
        expect(svg).not.toContain('CODESTATS/01');
        expect(refreshAge(null, snapshot().generatedAt)).toBe('not refreshed');
        expect(refreshAge('invalid', snapshot().generatedAt)).toBe('not refreshed');
        expect(refreshAge('2026-10-25T18:00:00Z', snapshot().generatedAt))
            .toBe('0 hr, 0 mins ago');
        expect(refreshAge('2026-10-25T16:59:00Z', snapshot().generatedAt))
            .toBe('0 hr, 1 min ago');
    });

    it.each([
        ['2014-12-11', '2026-10-25', 'Recent 12 years'],
        ['2026-05-01', '2026-10-24', 'Recent 6 months'],
        ['2026-10-01', '2026-10-25', 'Recent 25 days'],
        ['2026-10-19', '2026-10-25', 'Recent 7 days'],
        ['2026-10-25', '2026-10-25', 'Recent 1 day'],
        ['2025-11-01', '2026-10-25', 'Recent 1 year'],
    ])('describes the actual span %s to %s as %s', (start, end, expected) => {
        const data = snapshot();
        data.wakatime.data!.start = start;
        data.wakatime.data!.end = end;
        expect(timeRangeLabel(data)).toBe(expected);
        const svg = renderCard(data, options);
        expect(svg).toContain(`>${expected.toUpperCase()}</text>`);
        expect(svg).toContain('>GITHUB · CODE BYTES</text>');
        expect(svg).not.toContain('WAKATIME · ALL TIME');
    });

    it('uses the published since date and saved cutoff when precise dates are absent', () => {
        const data = snapshot();
        data.wakatime.data!.start = null;
        data.wakatime.data!.end = null;
        data.wakatime.data!.rangeLabel = 'since Dec 11 2014';
        data.wakatime.lastSuccessAt = '2020-12-11T12:00:00Z';
        data.wakatime.status = 'stale';
        expect(timeRangeLabel(data)).toBe('Recent 6 years');
        data.wakatime.data!.rangeLabel = 'All time';
        expect(timeRangeLabel(data)).toBe('Recent activity');
        data.range = 'last_7_days';
        expect(timeRangeLabel(data)).toBe('Recent 7 days');
        data.range = 'last_30_days';
        expect(timeRangeLabel(data)).toBe('Recent 1 month');
    });

    it('embeds trusted language paths and handles unknown names without external assets', () => {
        const svg = renderCard(snapshot(), options);
        expect(svg).toContain('data-language-icon="Shell"');
        expect(svg).toContain(`d="${LANGUAGE_ICONS.shell}"`);
        expect(svg.match(/data-language-icon=/g)).toHaveLength(4);
        expect(svg).not.toContain('<circle cx="37"');
        expect(svg).not.toMatch(/<(?:image|use|script)\b/);
        for (const name of ['unknown', '__proto__', 'constructor', '<script>']) {
            expect(languageIcon(name, LANGUAGE_ICONS)).toBe(LANGUAGE_ICONS._fallback);
        }
    });

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
        expect(svg).toContain('saved data · refresh unavailable');
        expect(svg).toContain('GitHub · saved data · refresh unavailable · 2026-10-25 16:00 UTC');
        expect(svg).toContain('WakaTime · fresh · 2026-10-25 15:30 UTC');
        expect(svg).toContain('through 2026-10-24 · today excluded by source');
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
        expect(svg).not.toContain('full source totals');
        expect(svg).toContain('Others: WakaTime');
        expect(svg).toContain('x="64" y="303" font-size="10"');
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

    it('builds a self-contained builder with native details and safe DOM rendering', () => {
        const html = renderPage();
        expect(html).toContain('<details id="language-details">');
        expect(html).toContain('/api/stats?range=');
        expect(html).toContain('Localhost images cannot load on GitHub.');
        expect(html).toContain("document.createTextNode(row.name)");
        expect(html).not.toContain('.innerHTML');
        expect(html).not.toContain('https://cdn.');
        expect(html).toContain('Build your card.');
        expect(html).toContain('<details id="readme-details" open>');
        expect(html).toContain("theme: 'transparent'");
        expect(html).not.toContain('Your last saved snapshot is retained on the server.');
    });
});

describe('GitHub personal activity', () => {
    it('shows expanded aggregates with independent periods and source time', () => {
        const svg = renderCard(activitySnapshot(), { ...options, view: 'activity' });
        for (const value of [
            '98,765', '456,789', '321', '432', '543', '654', '87', '234',
        ]) {
            expect(svg).toContain(`>${value}</text>`);
        }
        for (const label of [
            'Commits', 'Calendar contributions', 'PRs reviewed',
            'PRs commented on', 'Issues commented on', 'Discussions started',
            'Accepted answers', 'Review contributions', 'Repos contributed to',
        ]) {
            expect(svg).toContain(label);
        }
        expect(svg).toContain('Lifetime · GitHub index');
        expect(svg).toContain('Lifetime · calendar');
        expect(svg).toContain('Lifetime: 2010-03-01–2026-10-25. Recent year: 2025-10-25–2026-10-25.');
        expect(svg).toContain('GitHub activity · fresh · 2026-10-25 14:00 UTC');
        expect(svg).toContain('TOKEN-VISIBLE ACTIVITY');
        expect(svg).toContain('Public + private aggregates visible to the token');
        expect(svg).toContain('excluding their own pull requests');
        expect(svg).toContain('not a commit count');
        expect(svg).toContain('on default branches');
        expect(svg).toContain('review-only repositories are included');
        expect(svg).toContain('GitHub recent-year repositoriesContributedTo count');
    });

    it('keeps missing activity unknown in every summary view', () => {
        const data = snapshot();
        const svg = renderCard(data, { ...options, view: 'activity' });
        expect(svg).toContain(' · unavailable · ');
        expect(svg).toContain('Commits: —.');
        expect(svg).toContain('Calendar contributions: —.');
        expect(svg).toContain('GitHub activity · unavailable · no successful snapshot yet');
        expect(svg).toContain('Public PRs opened: 80.');
        expect(svg).toContain('Activity scope unavailable.');
        for (const view of ['overview', 'languages'] as const) {
            const existing = renderCard(data, { ...options, view });
            expect(existing).toContain('GitHub activity · unavailable');
            expect(existing).toContain('RECENT 7 YEARS');
        }
    });

    it('retains stale activity and labels its summary as saved data in every view', () => {
        const data = activitySnapshot();
        data.githubActivity!.status = 'stale';
        data.githubActivity!.lastError = 'activity API timeout';
        const svg = renderCard(data, { ...options, view: 'activity' });
        expect(svg).toContain('saved data · refresh unavailable');
        expect(svg).toContain('>98,765</text>');
        expect(svg).toContain('GitHub activity · saved data · refresh unavailable · 2026-10-25 14:00 UTC');
        expect(renderCard(data, options)).toContain('saved data · refresh unavailable');
        data.githubActivity!.data = null;
        data.githubActivity!.status = 'unavailable';
        const unavailable = renderCard(data, { ...options, view: 'activity' });
        expect(unavailable).toContain('GitHub activity · unavailable');
        expect(unavailable).toContain('Commits: —.');
    });

    it('keeps activity visible when the other sources are unavailable', () => {
        const data = activitySnapshot();
        data.github.data = null;
        data.github.status = 'unavailable';
        data.wakatime.data = null;
        data.wakatime.status = 'unavailable';
        const svg = renderCard(data, { ...options, view: 'activity' });
        expect(svg).toContain(' · unavailable · ');
        expect(svg).toContain('>@Leask</tspan>');
        expect(svg).toContain('>98,765</text>');
    });

    it('uses the complete configured repository total in the summary', () => {
        const data = activitySnapshot();
        data.github.data!.visibility = 'all';
        data.github.data!.repositories = 240;
        data.github.data!.privateRepositories = 42;
        data.github.data!.scope = 'Owned token-visible non-fork repositories';
        const svg = renderCard(data, { ...options, view: 'activity' });
        expect(svg).toContain('>REPOSITORIES</text>');
        expect(svg).toContain('>240</text>');
        expect(svg).toContain('>PULL REQUESTS</text>');
        expect(svg).not.toContain('PUBLIC REPOSITORIES');
        expect(svg).not.toContain('Public PRs opened');
        expect(renderCard(snapshot(), options)).toContain('>198</text>');
        data.github.data!.repositories = undefined;
        expect(renderCard(data, options)).not.toContain('>198</text>');
    });

    it('shows the requested eight source metrics in two rows of four', () => {
        const data = activitySnapshot();
        Object.assign(data.github.data!, { visibility: 'all', repositories: 240 });
        const svg = renderCard(data, options);
        const groups = [...svg.matchAll(
            /<g data-summary-metric="([^"]+)">(.*?)<\/g>/g,
        )];
        expect(groups.map(group => group[1])).toEqual([
            'coding-time', 'calendar-contributions', 'repositories', 'commits-indexed',
            'pull-requests', 'issues', 'followers', 'stars',
        ]);
        expect(groups.map(group => group[2].match(/>([^<]+)<\/text>/)![1]))
            .toEqual(['2', '456,789', '240', '98,765', '80', '50', '20', '1,250']);
        expect(groups.map(group => Number(group[2].match(/<text [^>]* y="(\d+)"/)![1])))
            .toEqual([166, 166, 166, 166, 230, 230, 230, 230]);
        expect(groups.every(group => [...group[2].matchAll(/<text\b/g)].length === 2))
            .toBe(true);
        expect(svg.match(/data-summary-icon="/g)).toHaveLength(8);
    });

    it('renders two profile lines and keeps the rank in the footer', () => {
        const data = activitySnapshot();
        Object.assign(data.github.data!, {
            name: 'Full Name', bio: 'Builds <tools>', profileStatus: 'Fallback status',
            avatarDataUri: 'data:image/png;base64,iVBORw==',
        });
        const svg = renderCard(data, options);
        expect(svg).toContain('data-github-avatar="true"');
        expect(svg).toContain('<circle cx="66" cy="78" r="34"/>');
        expect(svg).toContain('>Full Name<tspan');
        expect(svg).toContain('>@Leask</tspan>');
        expect(svg).toContain('Builds &lt;tools&gt;');
        expect(svg).not.toContain('Fallback status');
        expect(svg).toContain('Top 14.39% · A');
        expect(svg.match(/data-profile-rank=/g)).toHaveLength(1);
        expect(svg.indexOf('data-profile-rank'))
            .toBeGreaterThan(svg.indexOf('data-summary-metric'));
        data.github.data!.bio = ' ';
        expect(renderCard(data, options)).toContain('Fallback status');
        data.github.data!.profileStatus = null;
        expect(renderCard(data, options)).toMatch(
            /data-profile-description="true"><title><\/title><text[^>]*><\/text>/,
        );
        data.github.data!.avatarDataUri = 'https://example.com/avatar.png';
        expect(renderCard(data, options)).not.toContain('<image');
    });

    it('escapes activity scope and keeps large and invalid metrics within bounds', () => {
        const data = activitySnapshot();
        data.githubActivity!.data!.scope = '<script>private-repo</script>';
        data.githubActivity!.data!.commits = Number.MAX_SAFE_INTEGER;
        data.githubActivity!.data!.pullRequestsCommented = Number.NaN;
        data.githubActivity!.data!.issuesCommented = -1;
        const svg = renderCard(data, { ...options, view: 'activity' });
        expect(svg).toContain('&lt;script&gt;private-repo&lt;/script&gt;');
        expect(svg).not.toContain('<script>');
        expect(svg).not.toContain('NaN');
        expect(svg).toContain('PRs commented on: —.');
        expect(svg).toContain('Issues commented on: —.');
        expect(svg).toContain('font-size="14"');
        const height = Number(svg.match(/height="(\d+)"/)![1]);
        for (const match of svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"/g)) {
            expect(Number(match[1])).toBeLessThanOrEqual(848);
            expect(Number(match[2])).toBeLessThan(height);
        }
        expect(svg.match(/<g><title>/g)).toHaveLength(14);
    });

    it('provides expandable activity, yearly totals, definitions and source health', () => {
        const html = renderPage();
        expect(html).toContain('<details id="activity-details">');
        expect(html).toContain('id="githubActivity-status"');
        expect(html).toContain('id="contribution-years"');
        expect(html).toContain('How these counts are defined');
        expect(html).toContain('GitHub activity periods are independent of the WakaTime range.');
        expect(html).toContain("td.textContent = value");
        expect(html).toContain("dd.textContent = metric.definition");
        expect(html).not.toContain('.innerHTML');
        expect(html).toContain("markdown($('view').value, 'CodeStats')");
        expect(html).toContain("markdown('languages'");
        expect(html).toContain("markdown('activity'");
        expect(html).toContain("const project = 'https://github.com/Leask/CodeStats'");
        expect(html).toContain('<option value="all_time">All time</option>');
    });
});
