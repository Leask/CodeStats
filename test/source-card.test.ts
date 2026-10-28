import { describe, expect, it } from 'vitest';
import { renderSourceCard } from '../src/source-card';
import type {
    AIUsageData, CardOptions, LanguageRow, SourceSnapshot, StatsSnapshot,
} from '../src/types';

type Provider = 'github' | 'wakatime' | 'codex' | 'openrouter';
type Fixture = StatsSnapshot & {
    selectedSources: Provider[];
    profile: {
        mode: 'configured' | 'public';
        accounts: { github?: string; wakatime?: string; codex?: string };
    };
};
const providers: Provider[] = ['github', 'wakatime', 'codex', 'openrouter'];
const options: CardOptions = {
    theme: 'dark', view: 'overview', limit: 10, sort: 'code',
};
const rows: LanguageRow[] = [
    { name: 'Shell', color: '#89e051', codeBytes: 397, codePercent: 39.7,
        seconds: 2000, timePercent: 20, repositoryCount: 3 },
    { name: 'Python', color: '#3572a5', codeBytes: 300, codePercent: 30,
        seconds: 4200, timePercent: 42, repositoryCount: 5 },
    { name: 'Others', color: '#97a8ba', codeBytes: 303, codePercent: 30.3,
        seconds: 3800, timePercent: 38, repositoryCount: 2 },
];
const context = { rows, codeScale: 40, timeScale: 50 };

function source<T>(data: T): SourceSnapshot<T> {
    return { data, status: 'fresh', lastSuccessAt: '2026-10-28T10:00:00Z',
        lastAttemptAt: '2026-10-28T10:00:00Z', lastError: null, retryAt: null };
}

function usage(service: 'codex' | 'openrouter'): AIUsageData {
    return { service, label: service, totalTokens: service === 'codex'
        ? 131_320_846_898 : 29_000_111,
    totalPrompts: service === 'openrouter' ? 42 : undefined,
    period: service === 'codex' ? 'Lifetime tokens' : 'Last 367 days',
    since: null, until: '2026-10-28T00:00:00Z', scope: 'Account aggregate',
    summary: service === 'codex' ? {
        peakDailyTokens: 5_262_475_191, longestRunningTurnSec: 203_454,
        longestStreakDays: 109, currentStreakDays: 82,
    } : { averageDailyTokens: 79_019.38, averageWeeklyTokens: 553_135.66,
        longestStreakDays: 120 } };
}

function fixture(): Fixture {
    return {
        schemaVersion: 1, range: 'all_time', generatedAt: '2026-10-28T13:00:00Z',
        selectedSources: [...providers],
        profile: { mode: 'configured', accounts: {
            github: 'github-sentinel', wakatime: 'wakatime-sentinel', codex: 'codex-user',
        } },
        github: source({
            username: 'github-sentinel', name: 'GitHub Person', followers: 20,
            repositories: 10, publicRepositories: 8, analyzedRepositories: 10,
            visibility: 'all', stars: 4, forks: 2, pullRequests: 9,
            mergedPullRequests: 7, issues: 3, totalBytes: 1000,
            languages: [{ name: 'Shell', bytes: 397, color: '#89e051' },
                { name: 'Python', bytes: 300, color: '#3572a5' },
                { name: 'C++', bytes: 303, color: '#f34b7d' }], scope: 'Fixture inventory',
        }),
        githubActivity: source({
            username: 'github-sentinel', visibility: 'all', scope: 'Fixture activity',
            commits: 61, pullRequestsCommented: 6, pullRequestsReviewed: 5,
            issuesCommented: 3, discussionsStarted: 1, discussionsAnswered: 0,
            reviewContributions: 5, contributedRepositories: 2,
            allTimeContributedRepositories: 5, allTimeContributions: 91,
            contributionsByYear: [{ year: 2026, contributions: 91 }],
            recentFrom: '2025-10-28T00:00:00Z', recentTo: '2026-10-28T00:00:00Z',
            allTimeFrom: '2020-01-01T00:00:00Z', allTimeTo: '2026-10-28T00:00:00Z',
            organizationCount: 2,
        }),
        wakatime: source({
            username: 'wakatime-sentinel', range: 'all_time', totalSeconds: 10000,
            dailyAverageSeconds: 300, start: '2020-01-01', end: '2026-10-28',
            includesToday: false, rangeLabel: 'since 2020',
            languages: [{ name: 'Shell', seconds: 2000, percent: 20 },
                { name: 'Python', seconds: 4200, percent: 42 },
                { name: 'Other', seconds: 3800, percent: 38 }],
        }),
        aiUsage: { codex: source(usage('codex')), openrouter: source(usage('openrouter')) },
    };
}

function render(data = fixture(), view: string = 'overview', header = true): string {
    return renderSourceCard(data, { ...options, view: view as CardOptions['view'], header }, context);
}

function metric(svg: string, key: string): string {
    return svg.split(`data-source-metric="${key}"`)[1]?.split('</g>')[0] ?? '';
}

describe('provider-specific cards', () => {
    it.each(providers)('renders only %s data, identity and refresh time', provider => {
        const svg = render(fixture(), provider);
        expect(svg).toContain(`data-source-section="${provider}"`);
        expect(svg).toContain(`data-refresh-source="${provider}"`);
        for (const other of providers.filter(value => value !== provider)) {
            expect(svg).not.toContain(`data-source-section="${other}"`);
            expect(svg).not.toContain(`data-refresh-source="${other}"`);
        }
        if (provider !== 'github') {
            expect(svg).not.toContain('github-sentinel');
            expect(svg).not.toContain('GitHub Person');
            expect(svg).not.toContain('data-code-bar');
        }
        if (provider !== 'wakatime') {
            expect(svg).not.toContain('wakatime-sentinel');
            expect(svg).not.toContain('data-time-bar');
        }
        if (provider !== 'codex') expect(svg).not.toContain('131,320,846,898');
        if (provider !== 'openrouter') expect(svg).not.toContain('29,000,111');
    });

    it('uses native five-field metric orders and explicit request units', () => {
        const keys = (svg: string) => [...svg.matchAll(/data-source-metric="([^"]+)"/g)]
            .map(match => match[1]);
        expect(keys(render(fixture(), 'codex'))).toEqual([
            'totalTokens', 'peakDailyTokens', 'longestRunningTurnSec',
            'longestStreakDays', 'currentStreakDays',
        ]);
        const router = render(fixture(), 'openrouter');
        expect(keys(router)).toEqual(['totalTokens', 'averageDailyTokens',
            'averageWeeklyTokens', 'totalPrompts', 'longestStreakDays']);
        expect(router).toContain('Total prompts: 42 requests');
        expect(router).toContain('Last 367 days');
        expect(render(fixture(), 'codex')).toContain('>56h31m</text>');
        expect(render(fixture(), 'codex')).not.toContain('Lifetime tokens');
    });

    it('honors the supplied 10% scales without relabeling source percentages', () => {
        const github = render(fixture(), 'github');
        const waka = render(fixture(), 'wakatime');
        expect(github).toContain('GITHUB · CODE BYTES · SCALE 40%');
        expect(github).toMatch(/data-code-bar="true"[^>]*width="543\.89"/);
        expect(github).toContain('>39.7%</text>');
        expect(github).toContain('>397 B</text>');
        expect(waka).toContain('WAKATIME · CODE TIME · SCALE 50%');
        expect(waka).toMatch(/data-time-bar="true"[^>]*width="219\.20"/);
        expect(waka).not.toContain(' repos');
    });

    it('does not invent public GitHub bytes or unknown metrics', () => {
        const data = fixture();
        data.profile.mode = 'public';
        Object.assign(data.github.data!, { languageCoverage: 'unavailable',
            totalBytes: undefined, stars: undefined, followers: 0 });
        const svg = render(data, 'github');
        expect(svg).toContain('data-language-unavailable="github"');
        expect(svg).toContain('Public GitHub profile mode');
        expect(svg).not.toContain('data-code-bar');
        expect(metric(svg, 'stars')).toContain('>—</text>');
        expect(metric(svg, 'followers')).toContain('>0</text>');
    });

    it('retains stale observations while showing genuine zeros and unknowns', () => {
        const data = fixture();
        const source = data.aiUsage!.codex!;
        source.status = 'stale'; source.lastError = 'Temporary upstream failure';
        source.data!.totalTokens = 0;
        source.data!.summary!.peakDailyTokens = null;
        const svg = render(data, 'codex');
        expect(svg).toContain('data-usage-status="stale"');
        expect(svg).toContain('saved data');
        expect(metric(svg, 'totalTokens')).toContain('>0</text>');
        expect(metric(svg, 'peakDailyTokens')).toContain('>—</text>');
        expect(svg).toContain('Codex: 3h ago');
    });

    it('reports the native WakaTime period and its saved observation status', () => {
        const data = fixture();
        data.wakatime.data!.range = 'last_7_days';
        data.wakatime.status = 'stale';
        const svg = render(data, 'wakatime');
        expect(svg).toContain('Last 7 days · saved data');
        expect(svg).not.toContain('Last 30 days');
    });

    it('dates the GitHub card by the oldest displayed aggregate observation', () => {
        const data = fixture();
        data.githubActivity!.status = 'stale';
        data.githubActivity!.lastSuccessAt = '2026-10-28T08:00:00Z';
        const svg = render(data, 'github');
        expect(svg).toContain('data-source-status="stale"');
        expect(svg).toContain('Saved data');
        expect(svg).toContain('GitHub: 5h ago');
        expect(svg).not.toContain('GitHub: 3h ago');
    });

    it.each(['codex', 'openrouter'])('never shows owner %s usage in public mode', provider => {
        const data = fixture();
        data.profile.mode = 'public';
        data.profile.accounts.codex = 'external-id';
        const svg = render(data, provider);
        expect(svg).not.toContain('131,320,846,898');
        expect(svg).not.toContain('29,000,111');
        expect(svg).not.toContain('data-source-metric');
        expect(svg).toContain('not refreshed');
        if (provider === 'codex') {
            expect(svg).toContain('href="https://chatgpt.com/u/external-id"');
            expect(svg).toContain('require sign-in');
        } else expect(svg).toContain('account-specific Management key');
    });

    it('shows configured but unavailable providers without fabricated values', () => {
        const data = fixture();
        data.wakatime.data = null; data.wakatime.status = 'unavailable';
        data.wakatime.lastSuccessAt = null;
        data.wakatime.lastError = 'The requested statistics range is private.';
        const svg = render(data, 'wakatime');
        expect(svg).toContain('statistics range is private');
        expect(svg).not.toContain('data-source-metric');
        expect(svg).not.toContain('data-time-bar');
        expect(svg).toContain('WakaTime: not refreshed');
    });

    it('escapes untrusted labels and errors and rejects external embedded images', () => {
        const data = fixture();
        data.github.data!.name = '<script>alert(1)</script>';
        data.github.data!.avatarDataUri = 'https://evil.invalid/avatar.svg';
        const svg = render(data, 'github');
        expect(svg).toContain('&lt;script&gt;');
        expect(svg).not.toContain('<script>');
        expect(svg).not.toContain('<image');
        expect(svg).not.toContain('evil.invalid');
        data.profile.mode = 'public';
        data.profile.accounts.codex = '../<script>';
        expect(render(data, 'codex')).not.toContain('data-codex-profile');
    });

    it.each(['dark', 'light', 'transparent'] as const)('uses shared card geometry in %s mode', theme => {
        const svg = renderSourceCard(fixture(), { ...options, theme }, context);
        expect(svg).toContain('width="880"');
        expect(svg).toContain('data-card-padding="32"');
        expect(svg).toContain('data-project-credit="true"');
        expect(svg).not.toMatch(/NaN|Infinity/);
        expect([...svg.matchAll(/font-size="([\d.]+)"/g)]
            .every(match => [27, 13, 11].includes(Number(match[1])))).toBe(true);
    });
});

describe('partial overview composition', () => {
    it('explains a cold instance without inventing metrics or refreshes', () => {
        const data = fixture();
        data.selectedSources = [];
        const svg = render(data);
        expect(svg).toContain('Select a source to build your card.');
        expect(svg).toContain('Choose GitHub, WakaTime, Codex or OpenRouter');
        expect(svg).not.toContain('data-source-header');
        expect(svg).not.toContain('data-source-section');
        expect(svg).not.toContain('data-source-metric');
        expect(svg).not.toContain('data-refresh-source');
        expect(svg).toContain('data-project-credit');
        expect(svg).not.toMatch(/NaN|Infinity/);
    });

    it.each(Array.from({ length: 15 }, (_, index) => index + 1))(
        'renders exactly selected source mask %i', mask => {
            const data = fixture();
            data.selectedSources = providers.filter((_, index) => mask & (1 << index));
            const svg = render(data);
            for (const provider of providers) {
                expect(svg.includes(`data-source-section="${provider}"`))
                    .toBe(data.selectedSources.includes(provider));
                expect(svg.includes(`data-refresh-source="${provider}"`))
                    .toBe(data.selectedSources.includes(provider));
            }
        },
    );

    it('hides the large header without exposing an unselected account', () => {
        const data = fixture();
        data.selectedSources = ['wakatime', 'openrouter'];
        const svg = render(data, 'overview', false);
        expect(svg).not.toContain('data-source-header');
        expect(svg).not.toContain('github-sentinel');
        expect(svg).not.toContain('codex-user');
        expect(svg).toContain('wakatime-sentinel');
        expect(svg).toContain('data-source-section="openrouter"');
    });
});
