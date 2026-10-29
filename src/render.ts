import type {
    AIService,
    AIUsageData,
    GitHubData,
    CardOptions,
    LanguageRow,
    Range,
    RepositoryLanguageCount,
    SourceSnapshot,
    StatsSnapshot,
} from './types';
import { LANGUAGE_ICONS, languageIcon } from './language-icons';
import { CLOCK_ICON, GITHUB_ICON, METRIC_ICONS, TROPHY_ICON } from './ui-icons';
import { PROVIDER_ICONS } from './provider-icons';
import { profileRank } from './rank';
import { renderSourceCard } from './source-card';
import { normalizeProfileAccount } from './profile';

const ALIASES: Record<string, string> = {
    bash: 'shell',
    zsh: 'shell',
    sh: 'shell',
    fish: 'shell',
    ksh: 'shell',
    dash: 'shell',
    awk: 'shell',
    'shell script': 'shell',
    docker: 'dockerfile',
    c: 'c/c++',
    'c++': 'c/c++',
    cpp: 'c/c++',
    makefile: 'c/c++',
    csharp: 'c#',
    'c sharp': 'c#',
    'objective c': 'objective-c',
    'objective c++': 'objective-c',
    'objective-c++': 'objective-c',
    javascript: 'javascript/typescript',
    typescript: 'javascript/typescript',
    js: 'javascript/typescript',
    ts: 'javascript/typescript',
    jsx: 'javascript/typescript',
    tsx: 'javascript/typescript',
    'javascript react': 'javascript/typescript',
    'typescript react': 'javascript/typescript',
    markdown: 'markdown/text',
    text: 'markdown/text',
    'plain text': 'markdown/text',
    mdx: 'markdown/text',
    restructuredtext: 'markdown/text',
    rst: 'markdown/text',
    html: 'html/css',
    css: 'html/css',
    scss: 'html/css',
    sass: 'html/css',
    less: 'html/css',
    stylus: 'html/css',
    postcss: 'html/css',
    pcss: 'html/css',
    json: 'config',
    jsonc: 'config',
    'json with comments': 'config',
    tsconfig: 'config',
    'json/yaml/toml/ini': 'config',
    'sublime text config': 'config',
    xml: 'config',
    xslt: 'config',
    yaml: 'config',
    yml: 'config',
    toml: 'config',
    ini: 'config',
    cython: 'python',
    'jupyter notebook': 'python',
    ipython: 'python',
    glsl: 'shaders',
    hlsl: 'shaders',
    metal: 'shaders',
    shaderlab: 'shaders',
    wgsl: 'shaders',
    cg: 'shaders',
    vue: 'html/css',
    'vue.js': 'html/css',
    vuejs: 'html/css',
    svelte: 'html/css',
    astro: 'html/css',
    xhtml: 'html/css',
    htm: 'html/css',
    pug: 'html/css',
    jade: 'html/css',
    jinja: 'html/css',
    jinja2: 'html/css',
    mustache: 'html/css',
    handlebars: 'html/css',
    ejs: 'html/css',
    erb: 'html/css',
    twig: 'html/css',
    smarty: 'html/css',
    mako: 'html/css',
    liquid: 'html/css',
    blade: 'html/css',
    'go template': 'html/css',
    'html+erb': 'html/css',
    'html+django': 'html/css',
    viml: 'vim script',
    'perl 6': 'raku',
    perl6: 'raku',
    gdscript3: 'gdscript',
    'actionscript 3': 'actionscript',
    'nginx configuration file': 'nginx',
    mysql: 'sql',
    'transact-sql': 'sql',
    others: 'other',
    'golang': 'go',
    plpgsql: 'sql',
    plsql: 'sql',
    'pl/sql': 'sql',
    tsql: 'sql',
    't-sql': 'sql',
    sqlpl: 'sql',
};

const GROUP_NAMES: Record<string, string> = {
    'c/c++': 'C/C++',
    'javascript/typescript': 'JavaScript/TypeScript',
    'markdown/text': 'Markdown/Text',
    config: 'JSON/YAML/TOML/INI',
    python: 'Python',
    'html/css': 'HTML/CSS',
    shaders: 'Shaders',
    'vim script': 'Vim Script',
    raku: 'Raku',
    gdscript: 'GDScript',
    actionscript: 'ActionScript',
    nginx: 'Nginx',
    shell: 'Shell',
    'objective-c': 'Objective-C',
    sql: 'SQL',
};

const COLORS: Record<string, string> = {
    'javascript/typescript': '#f1df6a',
    'c/c++': '#e49ac9',
    'markdown/text': '#aab7ce',
    'html/css': '#e79980',
    'objective-c': '#438eff',
    config: '#e0cb8b',
    shaders: '#b594ed',
    javascript: '#f1df6a',
    typescript: '#63a3f3',
    python: '#89b5ed',
    rust: '#e9a886',
    go: '#60c8d5',
    swift: '#f59c7c',
    'c++': '#e49ac9',
    c: '#9aa7bb',
    'c#': '#b594ed',
    shell: '#b4d78c',
    vue: '#80d6b0',
    html: '#e79980',
    css: '#b6a1eb',
    json: '#e0cb8b',
    markdown: '#aab7ce',
    yaml: '#df9dac',
    sql: '#d7b689',
    other: '#8791a3',
};

const ACTIVITY_METRICS = [
    {
        source: 'githubActivity', key: 'commits', label: 'Commits',
        period: 'indexed',
        definition: 'Lifetime authored commits found in the GitHub search index '
            + 'on default branches. GitHub indexing rules apply; this is not a '
            + 'complete Git history.',
    },
    {
        source: 'githubActivity', key: 'allTimeContributions',
        label: 'Calendar contributions', period: 'calendar',
        definition: 'Sum of GitHub contribution calendar totals for every '
            + 'account year. Calendar eligibility rules apply; not a commit count.',
    },
    {
        source: 'githubActivity', key: 'pullRequestsReviewed',
        label: 'PRs reviewed', period: 'lifetime',
        definition: 'Distinct pull requests reviewed by this user, excluding '
            + 'their own pull requests. Multiple reviews count once per PR.',
    },
    {
        source: 'githubActivity', key: 'pullRequestsCommented',
        label: 'PRs commented on', period: 'lifetime',
        definition: 'Distinct pull requests commented on by this user, excluding '
            + 'their own pull requests. Multiple comments count once per PR.',
    },
    {
        source: 'githubActivity', key: 'issuesCommented',
        label: 'Issues commented on', period: 'lifetime',
        definition: 'Distinct issues commented on by this user, excluding their '
            + 'own issues. Pull requests are excluded; repeated comments count once.',
    },
    {
        source: 'githubActivity', key: 'discussionsStarted',
        label: 'Discussions started', period: 'lifetime',
        definition: 'Lifetime repository discussions authored by this user.',
    },
    {
        source: 'githubActivity', key: 'discussionsAnswered',
        label: 'Accepted answers', period: 'lifetime',
        definition: 'Lifetime authored repository discussion comments marked '
            + 'as accepted answers.',
    },
    {
        source: 'githubActivity', key: 'allTimeContributedRepositories',
        label: 'Repos contributed to', period: 'lifetime',
        definition: 'Distinct repositories reached by visible '
            + 'commit, issue, pull request, review and repository-creation contributions '
            + 'across collected account years. Deduplicated across years and '
            + 'contribution types; review-only repositories are included.',
    },
    {
        source: 'githubActivity', key: 'reviewContributions',
        label: 'Review contributions', period: 'recent',
        definition: 'GitHub contribution-collection pull request review '
            + 'contributions in the stated recent-year window. This counts '
            + 'contributions, not distinct pull requests.',
    },
    {
        source: 'githubActivity', key: 'contributedRepositories',
        label: 'Repos contributed to', period: 'recent',
        definition: 'GitHub recent-year repositoriesContributedTo count for commit, issue, pull request, review '
            + 'and repository-creation contributions. GitHub eligibility and '
            + 'visibility rules apply.',
    },
    {
        source: 'github', key: 'pullRequests', label: 'PRs opened',
        period: 'lifetime',
        definition: 'Lifetime pull requests authored by this user across '
            + 'repositories in the source visibility scope.',
    },
    {
        source: 'github', key: 'issues', label: 'Issues opened',
        period: 'lifetime',
        definition: 'Lifetime issues authored by this user across repositories '
            + 'in the source visibility scope. Pull requests are excluded.',
    },
    {
        source: 'github', key: 'followers', label: 'Followers', period: 'current',
        definition: 'Current followers of the GitHub account.',
    },
    {
        source: 'github', key: 'forks', label: 'Repository forks',
        period: 'current',
        definition: 'Current fork counts received by selected original '
            + 'repositories analyzed for the separate language-byte source.',
    },
] as const;

const ACTIVITY_PERIODS = {
    current: 'Current',
    indexed: 'Lifetime · GitHub index',
    calendar: 'Lifetime · calendar',
    lifetime: 'Lifetime',
    recent: 'Recent year',
};

function githubActivitySource(snapshot: StatsSnapshot) {
    return snapshot.githubActivity ?? {
        data: null, status: 'unavailable' as const,
        lastSuccessAt: null, lastAttemptAt: null,
        lastError: null, retryAt: null,
    };
}

function day(value: string | undefined): string {
    return value && !Number.isNaN(Date.parse(value))
        ? new Date(value).toISOString().slice(0, 10) : 'date unavailable';
}

function profileLine(value: string, maximum = 55): string {
    let units = 0;
    let result = '';
    for (const char of value) {
        units += /[MWmw@]|[^\u0000-\u00ff]/.test(char) ? 1
            : /[A-Z]/.test(char) ? 0.8 : 0.62;
        if (units > maximum) return result + '…';
        result += char;
    }
    return result;
}

function canonical(name: string): string {
    const normalized = name.trim().toLowerCase();
    return ALIASES[normalized] ?? normalized;
}

function safeColor(value: string | undefined, name: string): string {
    const key = canonical(name);
    if (GROUP_NAMES[key] && COLORS[key]) {
        return COLORS[key];
    }
    if (value && /^#[0-9a-f]{6}$/i.test(value)) {
        return value;
    }
    if (COLORS[key]) {
        return COLORS[key];
    }
    const palette = ['#9ebcf0', '#b9c791', '#d2a8cb', '#d8bc95', '#8acdc4'];
    let hash = 0;
    for (const char of key) {
        hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }
    return palette[hash % palette.length];
}

function xml(value: unknown): string {
    return String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;',
        '"': '&quot;', "'": '&apos;',
    })[char]!);
}

function finite(value: number): number {
    return Number.isFinite(value) && value >= 0 ? value : 0;
}

/** A repository can match several raw languages but counts once per group. */
function repositoriesUsing(
    counts: RepositoryLanguageCount[] | undefined,
    names: string[],
): number | null {
    if (counts === undefined) return null;
    const selected = new Set(names.map(canonical));
    return counts.reduce((sum, item) => sum + (
        item.languages.some(name => selected.has(canonical(name)))
            ? item.repositories : 0
    ), 0);
}

/** Alternate ranked sources, keeping each already-merged row only once. */
function alternateRanks<T>(first: T[], second: T[]): T[] {
    const result: T[] = [];
    const seen = new Set<T>();
    for (let index = 0; index < Math.max(first.length, second.length); index++) {
        for (const row of [first[index], second[index]]) {
            if (row !== undefined && !seen.has(row)) {
                seen.add(row);
                result.push(row);
            }
        }
    }
    return result;
}

/** Pick both sources' leaders, then display them with a complete remainder. */
export function selectLanguages(
    rows: LanguageRow[],
    sort: CardOptions['sort'] = 'code',
    limit = 10,
    codeAvailable = rows.some(row => row.codeBytes !== null),
    repositoryCounts?: RepositoryLanguageCount[],
): LanguageRow[] {
    const count = Math.min(100, Math.max(1, Math.floor(limit) || 10));
    const byCode = (a: LanguageRow, b: LanguageRow) =>
        (b.codeBytes ?? -1) - (a.codeBytes ?? -1)
        || b.seconds - a.seconds || a.name.localeCompare(b.name);
    const byTime = (a: LanguageRow, b: LanguageRow) =>
        b.seconds - a.seconds || byCode(a, b);
    const candidates = rows.filter(row =>
        !['other', 'others'].includes(row.name.trim().toLowerCase()));
    const selected = alternateRanks(
        [...candidates].sort(byCode), [...candidates].sort(byTime),
    ).slice(0, count - 1);
    const included = new Set(selected);
    const remainder = rows.filter(row => !included.has(row));
    if (sort !== 'alternating') {
        selected.sort(sort === 'name'
            ? (a, b) => a.name.localeCompare(b.name)
            : sort === 'code' ? byCode : byTime);
    }
    if (remainder.length) {
        selected.push({
            name: 'Others', color: '#8791a3',
            seconds: remainder.reduce((sum, row) => sum + row.seconds, 0),
            timePercent: remainder.reduce((sum, row) => sum + row.timePercent, 0),
            codeBytes: codeAvailable ? remainder.reduce(
                (sum, row) => sum + (row.codeBytes ?? 0), 0,
            ) : null,
            codePercent: codeAvailable ? remainder.reduce(
                (sum, row) => sum + (row.codePercent ?? 0), 0,
            ) : null,
            repositoryCount: repositoriesUsing(
                repositoryCounts, remainder.map(row => row.name),
            ),
        });
    }
    return selected;
}

/** Balance displayed percentages at their precision; preserve raw measures. */
export function displayLanguages(rows: LanguageRow[], digits: 1 | 2): LanguageRow[] {
    const result = rows.map(row => ({ ...row }));
    const other = rows.findIndex(row => row.name === 'Others');
    if (other < 0) return result;
    const scale = 10 ** digits;
    const target = 100 * scale;
    const named = rows.map((_, index) => index).filter(index => index !== other);
    for (const field of ['timePercent', 'codePercent'] as const) {
        const values = rows.map(row => row[field]);
        if (values.some(value => value === null)) continue;
        const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
        // Missing, empty or incomplete data must not be made to look complete.
        if (Math.abs(total - 100) > 0.000001) continue;
        const exact = values.map(value => (value ?? 0) * scale);
        const units = exact.map(value => Math.round(value));
        let used = named.reduce((sum, index) => sum + units[index], 0);
        // Rare rounding overflow: remove units from the most rounded-up row.
        while (used > target) {
            const index = named.reduce((best, current) =>
                units[current] - exact[current] > units[best] - exact[best]
                    ? current : best);
            units[index]--;
            used--;
        }
        units[other] = target - used;
        result.forEach((row, index) => { row[field] = units[index] / scale; });
    }
    return result;
}

export function githubBytesAvailable(github: GitHubData | null): boolean {
    return github !== null && github.languageCoverage !== 'unavailable'
        && typeof github.totalBytes === 'number' && Number.isFinite(github.totalBytes);
}

/** Sum explicit language families before ranking; keep both denominators. */
export function joinLanguages(
    snapshot: StatsSnapshot,
    sort: CardOptions['sort'] = 'alternating',
): LanguageRow[] {
    const github = snapshot.github.data;
    const codeAvailable = githubBytesAvailable(github);
    const totalBytes = codeAvailable ? github!.totalBytes! : 0;
    const totalSeconds = snapshot.wakatime.data?.totalSeconds ?? 0;
    const membership = github?.repositoryLanguageCounts;
    const groupCounts = new Map<string, number>();
    // One pass, not one full repository-set scan per language row.
    for (const group of membership ?? []) {
        for (const key of new Set(group.languages.map(canonical))) {
            groupCounts.set(key, (groupCounts.get(key) ?? 0) + group.repositories);
        }
    }
    const repositoryCount = (key: string) => membership === undefined
        ? null : groupCounts.get(key) ?? 0;
    const code = new Map<string, { name: string; bytes: number; color: string }>();
    for (const language of codeAvailable ? github!.languages : []) {
        const key = canonical(language.name);
        const previous = code.get(key);
        code.set(key, {
            name: GROUP_NAMES[key] ?? language.name,
            bytes: finite(language.bytes) + (previous?.bytes ?? 0),
            color: safeColor(language.color, language.name),
        });
    }
    const result = new Map<string, LanguageRow>();
    for (const language of snapshot.wakatime.data?.languages ?? []) {
        const key = canonical(language.name);
        const match = key === 'other' ? undefined : code.get(key);
        const knownCode = codeAvailable && key !== 'other';
        const previous = result.get(key);
        const bytes = match?.bytes ?? 0;
        result.set(key, {
            name: GROUP_NAMES[key] ?? previous?.name ?? language.name,
            color: safeColor(match?.color, language.name),
            seconds: finite(language.seconds) + (previous?.seconds ?? 0),
            timePercent: (totalSeconds > 0
                ? 100 * finite(language.seconds) / totalSeconds : 0)
                + (previous?.timePercent ?? 0),
            codeBytes: knownCode ? bytes : null,
            codePercent: knownCode ? (
                totalBytes > 0 ? 100 * bytes / totalBytes : 0
            ) : null,
            repositoryCount: repositoryCount(key),
        });
    }
    for (const [key, language] of code) {
        if (!result.has(key) && key !== 'other') {
            result.set(key, {
                name: language.name,
                color: language.color,
                seconds: 0,
                timePercent: 0,
                codeBytes: language.bytes,
                codePercent: totalBytes > 0 ? 100 * language.bytes / totalBytes : 0,
                repositoryCount: repositoryCount(key),
            });
        }
    }
    const rows = [...result.values()];
    const byCode = (a: LanguageRow, b: LanguageRow) =>
        (b.codeBytes ?? -1) - (a.codeBytes ?? -1)
        || b.seconds - a.seconds || a.name.localeCompare(b.name);
    const byTime = (a: LanguageRow, b: LanguageRow) =>
        b.seconds - a.seconds || byCode(a, b);
    if (sort === 'alternating') {
        return alternateRanks([...rows].sort(byCode), [...rows].sort(byTime));
    }
    return rows.sort((a, b) => {
        if (sort === 'name') {
            return a.name.localeCompare(b.name);
        }
        if (sort === 'code') {
            return byCode(a, b);
        }
        return byTime(a, b);
    });
}

function number(value: number | undefined): string {
    return value === undefined || !Number.isFinite(value) || value < 0
        ? '—' : Math.round(value).toLocaleString('en-US');
}

function metricNumber(value: string): string {
    return value.length <= 8 ? value : new Intl.NumberFormat('en-US', {
        notation: 'compact', maximumFractionDigits: 1,
    }).format(Number(value.replaceAll(',', '')));
}

function duration(seconds: number): string {
    const minutes = Math.floor(finite(seconds) / 60);
    const hours = Math.floor(minutes / 60);
    return `${hours.toLocaleString('en-US')}h ${minutes % 60}m`;
}

function codeSize(bytes: number | null): string {
    if (bytes === null) return '—';
    const value = Number.isFinite(bytes) && bytes >= 0 ? bytes : 0;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(units.length - 1,
        Math.floor(Math.log10(Math.max(1, value)) / 3));
    return `${Number((value / 1000 ** index).toFixed(1))} ${units[index]}`;
}

/** Full track = this source's largest share, rounded up in 10% steps. */
export function languageScale(values: Array<number | null>): number | null {
    const available = values.filter((value): value is number =>
        value !== null && Number.isFinite(value) && value >= 0);
    if (!available.length) return null;
    const maximum = Math.min(100, Math.max(...available));
    if (maximum === 0) return 0;
    const units = maximum / 10;
    return Math.max(10,
        Math.ceil(units - Number.EPSILON * Math.max(1, units)) * 10);
}

/** Age of the last successful refresh when this static card was generated. */
export function refreshAge(lastSuccessAt: string | null, at: string): string {
    const difference = Date.parse(at) - Date.parse(lastSuccessAt ?? '');
    if (!Number.isFinite(difference)) return 'not refreshed';
    const minutes = Math.max(0, Math.floor(difference / 60_000));
    if (minutes === 0) return 'just now';
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    const parts = [];
    if (hours) parts.push(`${number(hours)} hr`);
    if (remainder) parts.push(`${remainder} min${remainder === 1 ? '' : 's'}`);
    return parts.join(', ') + ' ago';
}

function date(value: string | null): string {
    if (!value) {
        return 'no successful snapshot yet';
    }
    const instant = new Date(value);
    if (Number.isNaN(instant.valueOf())) {
        return 'timestamp unavailable';
    }
    return instant.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

const RANGE_LABELS = {
    all_time: 'ALL TIME',
    last_7_days: 'LAST 7 DAYS',
    last_30_days: 'LAST 30 DAYS',
};

/** Describe the saved data's span, using rounded years/months/days. */
export function timeRangeLabel(snapshot: StatsSnapshot): string {
    const source = snapshot.wakatime;
    const data = source.data;
    const since = data?.rangeLabel?.match(/^since\s+(.+)$/i)?.[1];
    const start = Date.parse(data?.start ?? (since ? `${since} UTC` : ''));
    const end = Date.parse(data?.end ?? source.lastSuccessAt ?? '');
    let days = Number.isFinite(start) && Number.isFinite(end) && end >= start
        ? Math.max(1, (end - start) / 86_400_000
            + (data?.end && /^\d{4}-\d{2}-\d{2}$/.test(data.end) ? 1 : 0))
        : snapshot.range === 'last_7_days' ? 7
            : snapshot.range === 'last_30_days' ? 30 : null;
    if (days === null) return 'Recent activity';
    days = Math.max(1, Math.round(days));
    const months = Math.round(days / (365.2425 / 12));
    const unit = months >= 12 ? 'year' : days >= 28 ? 'month' : 'day';
    const value = unit === 'year' ? Math.max(1, Math.round(days / 365.2425))
        : unit === 'month' ? Math.max(1, months) : days;
    return `Recent ${value} ${unit}${value === 1 ? '' : 's'}`;
}

function sourceLine<T>(name: string, source: SourceSnapshot<T>): string {
    const state = source.status === 'fresh' ? 'fresh'
        : source.data ? source.lastError ? 'saved data · refresh unavailable'
            : 'saved data · refresh due' : 'unavailable';
    return `${name} · ${state} · ${date(source.lastSuccessAt)}`;
}

const AI_LABELS: Record<AIService, string> = {
    openrouter: 'OpenRouter', codex: 'Codex', anthropic: 'Anthropic API',
};

function tokenTotal(value: number | null | undefined): string {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? new Intl.NumberFormat('en-US', {
            notation: 'compact', maximumFractionDigits: 1,
        }).format(value) : '—';
}

function usageDays(value: number | null | undefined): string {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? `${number(value)} ${value === 1 ? 'day' : 'days'}` : '—';
}

function taskDuration(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
    const totalMinutes = Math.round(value / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? `${number(hours)}h${minutes ? minutes + 'm' : ''}` : `${minutes}m`;
}

/** Native summaries retain the provider's own scope and missing-data semantics. */
function usageMetrics(service: AIService, data: AIUsageData | null) {
    const summary = data?.summary;
    const tokens = (key: string, label: string, value: number | null | undefined) => ({
        key, label, value: tokenTotal(value),
        exact: typeof value === 'number' ? number(value) + ' tokens' : 'unavailable',
    });
    const days = (key: string, label: string, value: number | null | undefined) => ({
        key, label, value: usageDays(value), exact: usageDays(value),
    });
    const total = tokens('totalTokens', 'Total tokens', data?.totalTokens);
    if (service === 'codex') return [
        total,
        tokens('peakDailyTokens', 'Peak tokens', summary?.peakDailyTokens),
        { key: 'longestRunningTurnSec', label: 'Longest task',
            value: taskDuration(summary?.longestRunningTurnSec),
            exact: typeof summary?.longestRunningTurnSec === 'number'
                ? number(summary.longestRunningTurnSec) + ' seconds' : 'unavailable' },
        days('longestStreakDays', 'Longest streak', summary?.longestStreakDays),
        days('currentStreakDays', 'Current streak', summary?.currentStreakDays),
    ];
    if (service === 'openrouter') return [
        total,
        tokens('averageDailyTokens', 'Tokens/day', summary?.averageDailyTokens),
        tokens('averageWeeklyTokens', 'Tokens/week', summary?.averageWeeklyTokens),
        { key: 'totalPrompts', label: 'Total prompts',
            value: tokenTotal(data?.totalPrompts),
            exact: typeof data?.totalPrompts === 'number'
                ? number(data.totalPrompts) + ' requests' : 'unavailable' },
        days('longestStreakDays', 'Longest streak', summary?.longestStreakDays),
    ];
    return [total];
}

function usagePeriod(service: AIService, data: AIUsageData | null): string {
    return service === 'codex' && data?.period === 'Lifetime tokens'
        ? 'Lifetime' : data?.period ?? 'Not available yet';
}

/** Keep complete service labels together while fitting the footer width. */
function refreshLines(labels: string[], maximumWidth: number): string[] {
    const lines: string[] = [];
    let line = '';
    for (const label of labels) {
        const next = line ? line + ' | ' + label : label;
        if (line && next.length * 5.4 > maximumWidth) {
            lines.push(line);
            line = label;
        } else {
            line = next;
        }
    }
    if (line) lines.push(line);
    return lines;
}

export function renderCard(snapshot: StatsSnapshot, options: CardOptions): string {
    const sourceView = ['github', 'wakatime', 'codex', 'openrouter'].includes(options.view);
    const partial = snapshot.selectedSources
        && (!snapshot.selectedSources.includes('github')
            || !snapshot.selectedSources.includes('wakatime'));
    if (sourceView || partial) {
        const hidden = { data: null, lastSuccessAt: null, lastAttemptAt: null,
            lastError: null, retryAt: null, status: 'unavailable' as const, enabled: false };
        const focused = !sourceView ? snapshot : { ...snapshot,
            github: options.view === 'github' ? snapshot.github : hidden,
            wakatime: options.view === 'wakatime' ? snapshot.wakatime : hidden,
        };
        const selected = selectLanguages(joinLanguages(focused), options.sort,
            options.limit, githubBytesAvailable(focused.github.data),
            focused.github.data?.repositoryLanguageCounts);
        return renderSourceCard(snapshot, options, {
            rows: displayLanguages(selected, 1),
            codeScale: languageScale(selected.map(row => row.codePercent)),
            timeScale: focused.wakatime.data
                ? languageScale(selected.map(row => row.timePercent)) : null,
        });
    }
    const font = { large: 27, medium: 13, small: 11 } as const;
    const cardPadding = 32;
    const cardRight = 880 - cardPadding;
    const light = options.theme === 'light';
    const transparent = options.theme === 'transparent';
    const lightPalette = {
        bg: '#ffffff', fg: '#17222e', muted: '#667588', line: '#e3e8ee',
        track: '#edf1f5', time: '#138768', code: '#4979c9', panel: '#f8fafc',
    };
    const darkPalette = {
        bg: '#121920', fg: '#eef3f8', muted: '#97a8ba', line: '#2b3743',
        track: '#25313e', time: '#9de6c4', code: '#86acfa', panel: '#18222d',
    };
    const palette = transparent ? {
        bg: 'none', fg: 'var(--fg)', muted: 'var(--muted)', line: 'var(--line)',
        track: 'var(--track)', time: 'var(--time)', code: 'var(--code)', panel: 'var(--panel)',
    } : light ? lightPalette : darkPalette;
    const cssVariables = (colors: typeof lightPalette): string => Object.entries(colors)
        .map(([key, value]) => `--${key}:${value}`).join(';');
    const transparentStyles = transparent
        ? `:root{${cssVariables(lightPalette)}}@media(prefers-color-scheme:dark){:root{${cssVariables(darkPalette)}}}`
        : '';
    const allRows = joinLanguages(snapshot);
    const selected = selectLanguages(
        allRows, options.sort, options.limit, githubBytesAvailable(snapshot.github.data),
        snapshot.github.data?.repositoryLanguageCounts,
    );
    const rows = displayLanguages(selected, 1);
    const codeScale = languageScale(selected.map(row => row.codePercent));
    const timeScale = snapshot.wakatime.data
        ? languageScale(selected.map(row => row.timePercent)) : null;
    const activity = options.view === 'activity';
    const aiSources = (['codex', 'openrouter', 'anthropic'] as const)
        .flatMap(service => {
            const source = snapshot.aiUsage?.[service];
            return source ? [{ service, source, label: AI_LABELS[service] }] : [];
        });
    const empty = rows.length === 0;
    const bodyHeight = activity ? 448 : Math.max(96, rows.length * 39 + 24);
    const metricRowHeight = 64;
    // All section dividers have 20px of content padding. A hidden profile
    // retains a compact rank lane, within the normal top card padding.
    const sectionPadding = 20;
    const usageHeadingGap = 12;
    const usageSectionHeight = 110 + usageHeadingGap;
    // Leave the same 20px content gap below the rank when the profile is hidden.
    const hiddenHeaderHeight = options.header === false ? 54 : 0;
    // Add breathing room below the visible profile without moving its aligned
    // avatar/rank or changing outer padding and subsequent section spacing.
    const profileSpacing = options.header === false ? 0 : 8;
    const contentOffset = 48 - hiddenHeaderHeight + profileSpacing;
    const summaryBottom = 256 - hiddenHeaderHeight + profileSpacing;
    const summaryDividerY = summaryBottom + sectionPadding;
    const tableBottom = 257 + contentOffset + bodyHeight + 6;
    const usageHeight = !activity ? aiSources.length * usageSectionHeight : 0;
    const footerY = tableBottom + usageHeight;
    const github = snapshot.github.data;
    const activitySource = githubActivitySource(snapshot);
    const githubActivity = activitySource.data;
    const waka = snapshot.wakatime.data;
    const username = github?.username ?? waka?.username
        ?? githubActivity?.username ?? 'Your profile';
    const title = `${username} · coding footprint`;
    const allVisible = github?.visibility === 'all';
    const activityAllVisible = githubActivity?.visibility === 'all';
    // Reserve the other half of the header for the right-aligned rank row.
    const fullName = profileLine(github?.name ?? username, 13);
    const profileDescription = github?.bio?.trim()
        || github?.profileStatus?.trim() || '';
    const rank = profileRank(github, githubActivity);
    // Include the 3px ring in the outer padding; the body is translated -20px.
    const avatarX = cardPadding + 1.5;
    const avatarY = cardPadding + 20 + 1.5;
    const avatarCenterX = avatarX + 34;
    const avatarCenterY = avatarY + 34;
    // Reference rank ring: a complete dim rim plus 100 - percentile progress.
    const avatarRankRing = '<g data-avatar-rank-ring="true">'
        + '<title>' + (rank ? xml(`Rank progress: ${(100 - rank.percentile).toFixed(2)}%`)
            : 'Rank data unavailable') + '</title>'
        + `<circle data-avatar-rank-rim="true" cx="${avatarCenterX}" cy="${avatarCenterY}" r="34" `
        + `fill="none" stroke="${palette.time}" stroke-width="3" opacity="0.2"/>`
        + (rank ? `<circle data-avatar-rank-progress="true" cx="${avatarCenterX}" cy="${avatarCenterY}" r="34" `
            + `fill="none" stroke="${palette.time}" stroke-width="3" opacity="0.8" `
            + 'pathLength="100" stroke-dasharray="100" '
            + `stroke-dashoffset="${rank.percentile.toFixed(6)}" `
            // Flat ends preserve the visible gap even for very high ranks.
            + `stroke-linecap="butt" transform="rotate(-90 ${avatarCenterX} ${avatarCenterY})"/>` : '')
        + '</g>';
    const avatarRankStyles = rank && options.header !== false
        ? '@keyframes avatarRankProgress{from{stroke-dashoffset:100}'
            + `to{stroke-dashoffset:${rank.percentile.toFixed(6)}}}`
            + '[data-avatar-rank-progress]{animation:avatarRankProgress 1s ease-in-out both}'
            + '@media(prefers-reduced-motion:reduce){'
            + '[data-avatar-rank-progress]{animation:none}}'
        : '';
    const metrics = [
        {
            id: 'coding-time',
            value: waka ? number(Math.floor(waka.totalSeconds / 3600)) : '—',
            label: 'CODING HOURS',
        },
        {
            id: 'calendar-contributions',
            value: number(githubActivity?.allTimeContributions),
            label: 'CALENDAR CONTRIBS.',
        },
        {
            id: 'repositories',
            value: number(allVisible ? github?.repositories : github?.publicRepositories),
            label: 'REPOSITORIES',
        },
        {
            id: 'commits-indexed', value: number(githubActivity?.commits),
            label: 'COMMITS',
        },
        {
            id: 'pull-requests', value: number(github?.pullRequests),
            label: 'PULL REQUESTS',
        },
        {
            id: 'issues', value: number(github?.issues),
            label: 'ISSUES',
        },
        {
            id: 'followers', value: number(github?.followers),
            label: 'FOLLOWERS',
        },
        {
            id: 'stars',
            value: number(github?.stars), label: 'STARS RECEIVED',
        },
    ];
    const text = (
        x: number, y: number, value: unknown, size: number = font.small,
        fill = palette.fg, extra = '',
    ) => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${xml(value)}</text>`;
    const avatar = github?.avatarDataUri;
    const embeddedAvatar = typeof avatar === 'string'
        && /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(avatar);
    const profileHeader = '<g data-profile-header="true">'
        + '<defs><clipPath id="avatar-clip">'
        + `<circle cx="${avatarCenterX}" cy="${avatarCenterY}" r="34"/></clipPath></defs>`
        + (embeddedAvatar
            ? `<image data-github-avatar="true" x="${avatarX}" y="${avatarY}" width="68" height="68" `
                + `href="${xml(avatar)}" clip-path="url(#avatar-clip)" `
                + 'preserveAspectRatio="xMidYMid slice"/>'
            : `<circle cx="${avatarCenterX}" cy="${avatarCenterY}" r="34" fill="${palette.panel}"/>`
                + text(avatarCenterX, avatarCenterY, username.slice(0, 1).toUpperCase(), font.large,
                    palette.muted, 'text-anchor="middle" dominant-baseline="central"'))
        + avatarRankRing
        + '<g data-profile-text="true">'
        + '<title>' + xml(github?.name ?? username) + '</title>'
        + `<text data-profile-name="true" x="116" y="${avatarCenterY - (profileDescription ? 10 : 0)}" `
        + `dominant-baseline="central" font-size="${font.large}" `
        + `fill="${palette.fg}" font-weight="650">${xml(fullName)}</text>`
        + '<g data-profile-description="true"><title>' + xml(profileDescription) + '</title>'
        + text(116, avatarCenterY + (font.large + 8) / 2,
            profileLine(profileDescription), font.small, palette.muted,
            'dominant-baseline="central"') + '</g></g></g>';
    const badgeUsername = username.length > 24 ? username.slice(0, 23) + '…' : username;
    const footerLabel = '@' + badgeUsername + (rank ? ' · Top '
        + `${rank.percentile < 0.01 ? '<0.01' : rank.percentile.toFixed(2)}% · ${rank.level}` : '');
    // Align intrinsic SVG bounds, including icons, without estimating text
    // widths. The full username remains in the accessible title.
    const alignRight = 'transform-box:fill-box;transform:translateX(-100%)';
    const rankY = cardPadding + 20 + 11;
    // One GitHub label covers both repository data and personal activity.
    // Use the oldest displayed dataset, as the focused source cards do.
    const githubTimes = [snapshot.github.lastSuccessAt,
        ...(githubActivity ? [activitySource.lastSuccessAt] : [])]
        .filter((value): value is string => !!value && Number.isFinite(Date.parse(value)));
    const githubAt = githubTimes.length ? githubTimes.reduce((oldest, value) =>
        Date.parse(value) < Date.parse(oldest) ? value : oldest) : null;
    const refreshLabels = [
        `GitHub: ${refreshAge(githubAt, snapshot.generatedAt)}`,
        `WakaTime: ${refreshAge(snapshot.wakatime.lastSuccessAt, snapshot.generatedAt)}`,
        ...aiSources.map(({ label, source }) => `${label}: `
            + refreshAge(source.lastSuccessAt, snapshot.generatedAt)),
    ];
    const compactRefresh = refreshLabels.join(' | ').length * 5.4 > 542;
    const displayedRefresh = compactRefresh ? refreshLabels.map(label => label
        .replace(/(\d+) hr/g, '$1h').replace(/(\d+) mins?/g, '$1m')
        .replace(/, /g, ' ')) : refreshLabels;
    const refreshX = 32;
    const refreshY = footerY + 30;
    const lines = refreshLines(displayedRefresh, 542);
    const creditY = refreshY;
    const height = footerY + cardPadding + 13 + (lines.length - 1) * 20;
    const upperRank = `<g transform="translate(${cardRight} 0)">`
        + `<g data-profile-${rank ? 'rank' : 'identity'}="true" `
        + `data-rank-placement="top-right" style="${alignRight}">`
        + '<title>' + xml('@' + username) + (rank ? '. Estimated percentile from the '
        + 'GitHub Stats Extended weighted model: commits, PRs, issues, recent '
        + 'review contributions, owned stars and followers.' : '. GitHub profile.')
        + '</title>'
        + (rank ? ''
        + `<svg data-rank-icon="true" x="0" y="${rankY - 11}" `
        + `width="14" height="14" viewBox="0 0 16 16" fill="${palette.time}" `
        + `aria-hidden="true"><path d="${TROPHY_ICON}"/></svg>` : '')
        + text(rank ? 20 : 0, rankY, footerLabel,
            font.small, rank ? palette.time : palette.muted) + '</g></g>';
    const metricMarkup = metrics.map((metric, index) => {
        const x = 32 + index % 4 * 211;
        const y = 166 - hiddenHeaderHeight + profileSpacing
            + Math.floor(index / 4) * metricRowHeight;
        const valueX = x + 48;
        const iconSize = 38;
        // Include the label baseline and its descenders in the text block.
        const iconY = y + (27 - font.large - iconSize) / 2;
        return `<g data-summary-metric="${metric.id}">`
            + '<title>' + xml(`${metric.label}: ${metric.value}`) + '</title>'
            + `<svg data-summary-icon="${metric.id}" x="${x}" y="${iconY}" `
            + `width="${iconSize}" height="${iconSize}" viewBox="0 0 16 16" aria-hidden="true" `
            + `fill="${palette.muted}"><path d="${METRIC_ICONS[metric.id]}"/></svg>`
            + text(valueX, y, metricNumber(metric.value), font.large, palette.fg, 'font-weight="650"')
            + text(valueX, y + 23, metric.label, font.small, palette.muted, 'letter-spacing="0.5"')
            + '</g>';
    }).join('');
    let body = '';
    if (activity) {
        const scope = !githubActivity ? 'PERSONAL ACTIVITY'
            : activityAllVisible ? 'TOKEN-VISIBLE ACTIVITY' : 'PUBLIC ACTIVITY';
        body = text(32, 257, `GITHUB · ${scope}`, font.small, palette.muted, 'letter-spacing="1.2"');
        body += ACTIVITY_METRICS.map((metric, index) => {
            const x = 32 + index % 4 * 211;
            const y = 303 + Math.floor(index / 4) * 83;
            const value = number(metric.source === 'github'
                ? github?.[metric.key] : githubActivity?.[metric.key]);
            const label = metric.source === 'github' && !allVisible
                && ['pullRequests', 'issues'].includes(metric.key)
                ? 'Public ' + metric.label : metric.label;
            return '<g><title>' + xml(`${label}: ${value}. ${metric.definition} `
                + `Period: ${ACTIVITY_PERIODS[metric.period]}.`)
                + '</title>'
                + text(x, y, metricNumber(value), font.large, palette.fg, 'font-weight="600"')
                + text(x, y + 22, label, font.small, palette.fg)
                + text(x, y + 40, ACTIVITY_PERIODS[metric.period], font.small, palette.muted)
                + '</g>';
        }).join('');
        const periods = githubActivity
            ? `Lifetime: ${day(githubActivity.allTimeFrom)}–${day(githubActivity.allTimeTo)}. `
                + `Recent year: ${day(githubActivity.recentFrom)}–${day(githubActivity.recentTo)}.`
            : 'GitHub activity has no successful snapshot yet. A dash means unavailable, not zero.';
        body += text(32, 637, periods, font.small, palette.muted);
        body += text(32, 659, 'Reviewed/commented items exclude self-authored items; each distinct item counts once.', font.small, palette.muted);
        body += text(32, 681, !githubActivity
            ? 'Activity scope unavailable. Existing authorship and repository metrics retain their own source scope.'
            : activityAllVisible
            ? 'Public + private aggregates visible to the token, including organizations and external repositories.'
            : 'Public aggregates, including organizations and external repositories. GitHub eligibility rules apply.',
        font.small, palette.muted);
    } else if (empty) {
        body = text(32, 285, 'Waiting for the first successful source snapshot.', font.medium)
            + text(32, 311, 'Existing saved data will appear here whenever a source is temporarily unavailable.', font.small, palette.muted);
    } else {
        const codeTrackWidth = 523 - 225;
        const timeTrackWidth = cardRight - 558;
        body = text(32, 258, 'LANGUAGE', font.small, palette.muted, 'letter-spacing="1.1"')
            + '<g data-language-scale="code" data-scale-percent="'
            + (codeScale ?? '') + '">'
            + text(225, 258, 'GITHUB · CODE BYTES · SCALE '
                + (codeScale === null ? '—' : `${codeScale}%`),
            font.small, palette.code, 'letter-spacing="0.5"') + '</g>'
            + '<g data-wakatime-column="true"><title>WakaTime · '
            + xml(timeRangeLabel(snapshot)) + '</title>'
            + '<g data-language-scale="time" data-scale-percent="'
            + (timeScale ?? '') + '">'
            + text(558, 258, 'WAKATIME · CODE TIME · SCALE '
                + (timeScale === null ? '—' : `${timeScale}%`),
            font.small, palette.time, 'letter-spacing="0.5"') + '</g></g>';
        body += rows.map((row, index) => {
            const y = 289 + index * 39;
            const name = row.name.length > 23 ? row.name.slice(0, 22) + '…' : row.name;
            // Use unrounded source shares for geometry; labels still sum to100.
            const timeWidth = timeScale
                ? Math.min(1, selected[index].timePercent / timeScale) * timeTrackWidth : 0;
            const codeWidth = codeScale
                ? Math.min(1, (selected[index].codePercent ?? 0) / codeScale) * codeTrackWidth : 0;
            const repos = row.repositoryCount;
            const repoLabel = repos === null || repos === undefined ? '— repos'
                : `${number(repos)} ${repos === 1 ? 'repo' : 'repos'}`;
            return `<g data-language-row="${xml(row.name)}"><title>`
                + `${xml(row.name)}: ${xml(repoLabel)}; `
                + `WakaTime ${row.timePercent.toFixed(2)}%; `
                + `GitHub ${row.codePercent === null ? 'not comparable' : row.codePercent.toFixed(2) + '%'}</title>`
                + `<svg data-language-icon="${xml(row.name)}" x="31" y="${y - 11}" `
                + `width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" `
                + `fill="${row.color}"><path fill-rule="${row.name === 'SQL' ? 'evenodd' : 'nonzero'}" `
                + `d="${xml(languageIcon(row.name, LANGUAGE_ICONS))}"/></svg>`
                + text(64, y, name, font.medium, palette.fg, 'font-weight="500"')
                + text(64, y + 14, repoLabel, font.small, palette.muted,
                    'data-repository-count="true"')
                + `<rect x="225" y="${y - 10}" width="${codeTrackWidth}" height="7" rx="3.5" fill="${palette.track}"/>`
                + `<rect data-code-bar="true" x="225" y="${y - 10}" width="${codeWidth.toFixed(2)}" height="7" rx="3.5" fill="${palette.code}"/>`
                + text(523, y + 14, row.codePercent === null ? '—' : `${row.codePercent.toFixed(1)}%`, font.small, palette.code, 'text-anchor="end" data-code-percent="true"')
                + text(225, y + 14, codeSize(row.codeBytes), font.small,
                    palette.muted, 'data-code-value="true"')
                + `<rect x="558" y="${y - 10}" width="${timeTrackWidth}" height="7" rx="3.5" fill="${palette.track}"/>`
                + `<rect data-time-bar="true" x="558" y="${y - 10}" width="${timeWidth.toFixed(2)}" height="7" rx="3.5" fill="${palette.time}"/>`
                + text(cardRight, y + 14, waka ? `${row.timePercent.toFixed(1)}%` : '—', font.small, palette.time, 'text-anchor="end" data-time-percent="true"')
                + text(558, y + 14, waka ? duration(row.seconds) : '—',
                    font.small, palette.muted, 'data-time-value="true"')
                + '</g>';
        }).join('');
    }
    const rangeEnd = waka?.end ? ` · through ${waka.end.slice(0, 10)}`
        : waka?.rangeLabel ? ` · ${waka.rangeLabel}` : '';
    const through = waka && !waka.includesToday ? ' · today excluded by source' : '';
    const usageMarkup = usageHeight ? '<g data-ai-usage-summary="true">'
        + aiSources.map(({ service, source, label }, index) => {
            const top = tableBottom + index * usageSectionHeight;
            const values = usageMetrics(service, source.data);
            const period = usagePeriod(service, source.data);
            const width = 816 / values.length;
            const total = source.data?.totalTokens;
            const exact = total === null || total === undefined ? 'unavailable'
                : number(total) + ' tokens';
            return `<g data-token-service="${service}" data-usage-status="${source.status}" `
                + `data-section="usage-${service}" data-section-top="${top}" `
                + `data-section-bottom="${top + usageSectionHeight}" `
                + `data-section-padding="${sectionPadding}">`
                + '<title>' + xml(`${label}: ${exact}. `
                    + `${period}. `
                    + `${source.data?.scope ?? ''} ${sourceLine(label, source)}.`)
                + '</title>'
                + `<path d="M32 ${top}H848" stroke="${palette.line}"/>`
                + `<svg data-token-icon="true" x="32" y="${top + 17}" `
                + `data-provider-icon="${service}" width="16" height="16" `
                + `viewBox="0 0 24 24" fill="${palette.muted}" `
                + `fill-rule="evenodd" aria-hidden="true">`
                + `<path d="${PROVIDER_ICONS[service]}"/></svg>`
                + text(54, top + 30, label, font.medium,
                    palette.fg, 'data-token-label="true"')
                + text(148, top + 30, period, font.small,
                    palette.muted, 'data-token-period="true"')
                + values.map((metric, metricIndex) => {
                    const x = 32 + (metricIndex + 0.5) * width;
                    return `<g data-usage-metric="${metric.key}">`
                        + '<title>' + xml(`${metric.label}: ${metric.exact}`) + '</title>'
                        + (metricIndex ? `<path d="M${32 + metricIndex * width} ${top + 42 + usageHeadingGap}`
                            + `v48" stroke="${palette.line}"/>` : '')
                        + text(x, top + 64 + usageHeadingGap, metric.value, font.large, palette.fg,
                            'font-weight="650" text-anchor="middle" '
                            + (metric.key === 'totalTokens' ? 'data-token-total="true"' : ''))
                        + text(x, top + 87 + usageHeadingGap, metric.label, font.medium, palette.muted,
                            'text-anchor="middle" data-usage-label="true"')
                        + '</g>';
                }).join('')
                + '</g>';
        }).join('') + '</g>' : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="880" height="${height}" `
        + `viewBox="0 0 880 ${height}" data-card-padding="${cardPadding}" `
        + 'role="img" aria-labelledby="title desc">'
        + `<title id="title">${xml(title)}</title>`
        + '<desc id="desc">WakaTime time shares and GitHub repository language byte shares have separate denominators. '
        + 'Each column independently rounds its largest displayed share up to a 10% scale step. '
        + 'Scale labels state the true percentage represented by a full track. '
        + 'Repository counts use the headline repository scope and deduplicate merged languages; '
        + 'a repository may appear in several groups. A dash means a saved snapshot lacks counts. '
        + xml(`${sourceLine('GitHub', snapshot.github)}. ${sourceLine('WakaTime', snapshot.wakatime)}.`)
        + xml(` WakaTime ${RANGE_LABELS[snapshot.range].toLowerCase()}${rangeEnd}${through}. `
            + 'Time share and code share have separate denominators. '
            + 'GitHub counts repository bytes, not individual authorship.')
        + xml(` ${sourceLine('GitHub activity', activitySource)}. `)
        + xml(aiSources.map(({ label, source }) => sourceLine(label, source)
            + '. Token totals use each service\'s stated period and accounting rules; '
            + 'they are not added across services.').join(' '))
        + (activity ? xml(`Activity scope: ${githubActivity?.scope ?? 'unavailable'}. `
            + `Repository byte scope: ${github?.scope ?? 'unavailable'}. `
            + 'Private repository names are never included. '
            + ACTIVITY_METRICS.map((metric) => `${metric.label}: ${metric.definition}`).join(' ')) : '')
        + '</desc><style>' + transparentStyles
        + 'text{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif}'
        + '.numeric{font-variant-numeric:tabular-nums}' + avatarRankStyles + '</style>'
        + `<rect x=".5" y=".5" width="879" height="${height - 1}" rx="22" `
        + `fill="${transparent ? 'none' : palette.bg}" stroke="${palette.line}"/>`
        + '<g transform="translate(0 -20)">'
        + (options.header === false ? '' : profileHeader)
        + upperRank
        + `<g data-section="summary" data-section-top="${147 - hiddenHeaderHeight + profileSpacing}" `
        + `data-section-bottom="${summaryBottom}" data-section-padding="${sectionPadding}">`
        + metricMarkup + '</g>'
        + `<path d="M32 ${summaryDividerY}H848" stroke="${palette.line}"/>`
        + `<g data-section="${activity ? 'activity' : 'languages'}" `
        + `data-section-top="${summaryDividerY}" data-section-bottom="${tableBottom}" `
        + `data-section-padding="${sectionPadding}" `
        + `transform="translate(0 ${contentOffset})">${body}</g>`
        + usageMarkup
        + `<path d="M32 ${footerY}H848" stroke="${palette.line}"/>`
        + `<g data-section="footer" data-section-top="${footerY}" `
        + `data-section-padding="${sectionPadding}">`
        + `<g data-refresh-times="true" data-refresh-format="${compactRefresh ? 'compact' : 'full'}">`
        + '<title>' + xml(refreshLabels.join(' | ')) + '</title>'
        + lines.map((line, index) => `<g data-refresh-line="${index}">`
            + `<svg x="${refreshX}" y="${refreshY - 11 + index * 20}" width="14" height="14" `
            + `viewBox="0 0 16 16" fill="${palette.muted}" aria-hidden="true"><path d="${CLOCK_ICON}"/></svg>`
            + text(refreshX + 20, refreshY + index * 20, line,
                font.small, palette.muted) + '</g>').join('')
        + `</g><g transform="translate(${cardRight} 0)">`
        + '<a data-project-credit="true" href="https://github.com/Leask/CodeStats" '
        + `target="_blank" rel="noopener noreferrer" style="${alignRight}">`
        + `<svg x="0" y="${creditY - 11}" width="14" height="14" viewBox="0 0 16 16" `
        + `fill="${palette.muted}" aria-hidden="true"><path d="${GITHUB_ICON}"/></svg>`
        + `<text x="20" y="${creditY}" font-size="${font.small}" `
        + `fill="${palette.muted}">Power by github.com/Leask/`
        + `<tspan fill="${palette.time}" font-weight="650">CodeStats</tspan></text>`
        + '</a></g></g></g>'
        + '</svg>';
}

/** Card builder; no remote scripts, fonts, or fake sample data. */
export function renderPage(defaultRange: Range = 'all_time'): string {
    const docs = 'https://github.com/Leask/CodeStats/blob/main/docs/';
    const sourceIcon = (path: string, size = 16) =>
        `<svg class="source-icon" viewBox="0 0 ${size} ${size}" `
        + `aria-hidden="true" fill="currentColor"><path d="${path}"/></svg>`;
    const optionalPlaceholders = (['codex', 'openrouter'] as const).map(service =>
        `<div class="source-state" data-source-provider="${service}">`
        + '<div class="source-head"><span class="source-name">'
        + sourceIcon(PROVIDER_ICONS[service], 24) + AI_LABELS[service] + '</span>'
        + `<span class="badge" id="${service}-status">Loading</span></div>`
        + '<small>Reading source configuration.</small></div>',
    ).join('');
    return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>CodeStats · Build your card</title>
<style>
:root{color-scheme:dark;--bg:#0e141a;--panel:#151d26;--line:#2a3542;
--text:#edf2f8;--muted:#94a5b7;--green:#a3e5c6;--blue:#8aaff4}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);
font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
button,input,select,textarea{font:inherit}button,a,input,select,summary{outline-offset:4px}
button{cursor:pointer}a{color:var(--green)}.shell{max-width:1300px;margin:auto;padding:0 40px 64px}
nav{height:86px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:11px;font-size:17px;font-weight:650;letter-spacing:-.4px}
.mark{display:flex;gap:3px;align-items:flex-end;width:21px;height:23px}
.mark i{display:block;width:5px;border-radius:2px;background:var(--green);height:14px}
.mark i:nth-child(2){height:23px;background:var(--blue)}.mark i:nth-child(3){height:18px}
.local{font-size:10px;letter-spacing:1.8px;color:var(--muted);border:1px solid var(--line);
padding:7px 10px;border-radius:6px}.hero{padding:52px 0 36px;display:flex;justify-content:space-between;gap:24px}
.eyebrow{color:var(--green);font-size:10px;letter-spacing:2px;text-transform:uppercase;font-weight:650}
h1{font-size:48px;line-height:1.1;letter-spacing:-2px;margin:12px 0 16px;font-weight:600}
.hero p{color:var(--muted);font-size:15px;max-width:670px;margin:0}.identity{text-align:right;align-self:flex-end}
.identity strong{display:block;font-weight:500}.identity small{color:var(--muted)}
.nav-links{display:flex;align-items:center;gap:18px}.nav-links a{font-size:12px;text-decoration:none}
.source-strip{display:flex;flex-wrap:wrap;gap:10px 20px;margin-top:22px;color:#c8d2df;font-size:12px}
.source-strip span,.source-name{display:flex;align-items:center;gap:7px}
.source-icon{width:14px;height:14px;flex:none;color:var(--muted)}
.control-hint{display:block;font-size:10px;line-height:1.5;color:var(--muted);margin-top:6px}
.layout{display:grid;grid-template-columns:228px minmax(0,1fr);gap:28px;align-items:start}
aside{position:sticky;top:24px}.config,.source-panel{border:1px solid var(--line);border-radius:12px;background:var(--panel)}
.config{padding:20px}.section-title{font-size:10px;letter-spacing:1.5px;color:var(--muted);
text-transform:uppercase;font-weight:650;margin:0 0 19px}.control{margin:0 0 18px}
label{display:block;color:#c8d2df;font-size:12px;margin-bottom:7px}select,input[type=url],input[type=text]{width:100%;
border:1px solid #354252;border-radius:6px;background:#101720;color:var(--text);padding:9px 10px}
select{appearance:none;-webkit-appearance:none;padding-right:32px;
background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23c8d2df' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
background-repeat:no-repeat;background-position:right 12px center;background-size:12px 12px}
@media(forced-colors:active){select{appearance:auto;background-image:none;padding-right:10px}}
.source-panel{padding:19px;margin-top:16px}.source-state{padding:0 0 15px;margin:0 0 15px;border-bottom:1px solid var(--line)}
.source-state:last-child,.source-state.last-source{padding:0;margin:0;border:0}.source-head{display:flex;justify-content:space-between;gap:8px;
font-size:12px;align-items:center;flex-wrap:wrap}.source-name{font-weight:600;min-width:0}.badge{font-size:9px;letter-spacing:.5px;text-transform:uppercase;color:var(--green);white-space:nowrap}
.badge.stale,.badge.unavailable,.badge.partial{color:#e2b570}.badge.not-enabled{color:var(--muted)}
.source-state small{color:var(--muted);display:block;font-size:10px;
line-height:1.6;margin-top:5px;overflow-wrap:anywhere}.preview-label{display:flex;align-items:center;
justify-content:space-between;margin:0 0 13px;color:var(--muted);font-size:10px;letter-spacing:1.4px;text-transform:uppercase}
.preview-label a{font-size:10px;text-decoration:none;letter-spacing:.5px}.card-stage{border-radius:18px;min-height:260px;
display:flex;align-items:flex-start;justify-content:center;overflow:hidden}.card-stage img{display:block;width:100%;height:auto}
.card-stage img[hidden]{display:none}
.card-stage.light{background:#fff}.card-stage.transparent{background-color:#1a232d;
background-image:linear-gradient(45deg,#202c38 25%,transparent 25%),linear-gradient(-45deg,#202c38 25%,transparent 25%),
linear-gradient(45deg,transparent 75%,#202c38 75%),linear-gradient(-45deg,transparent 75%,#202c38 75%);
background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0}
.loading{color:var(--muted);padding:68px 30px;text-align:center;width:100%;border:1px solid var(--line);border-radius:18px}
.loading span{display:block;font-size:12px;margin-top:8px}.note{font-size:11px;color:var(--muted);margin:12px 0 24px;line-height:1.7}
details{border:1px solid var(--line);border-radius:10px;margin-top:14px;overflow:hidden;background:var(--panel)}
summary{list-style:none;cursor:pointer;padding:18px 20px;display:flex;align-items:center;justify-content:space-between;
font-size:13px;font-weight:500}summary::-webkit-details-marker{display:none}summary::after{content:'+';color:var(--muted);
font-size:20px;font-weight:300}details[open]>summary::after{content:'−'}summary small{font-weight:400;color:var(--muted);
margin-left:auto;margin-right:20px;font-size:11px}.detail-body{padding:0 20px 20px}.table-wrap{max-height:550px;overflow:auto}
table{border-collapse:collapse;width:100%;font-size:12px}th{color:var(--muted);font-size:10px;text-transform:uppercase;
letter-spacing:.8px;text-align:left;font-weight:500;padding:12px 8px;background:var(--panel);position:sticky;top:0}
td{padding:10px 8px;border-top:1px solid var(--line);font-variant-numeric:tabular-nums}
td:not(:first-child),th:not(:first-child){text-align:right}.language-icon{width:16px;height:16px;display:inline-block;
vertical-align:-3px;margin-right:9px}.detail-note{color:var(--muted);font-size:11px;margin:0 0 12px}
.metric-definitions{font-size:11px;color:var(--muted);margin:16px 0 0}
.metric-definitions dt{color:var(--text);font-weight:500;margin-top:10px}
.metric-definitions dd{margin:2px 0 0}.activity-tables{display:grid;grid-template-columns:2fr 1fr;gap:20px}
.activity-tables h3{font-size:11px;font-weight:500;margin:14px 0 4px}
.source-datasets{border:0;margin:7px 0 0;background:none;border-radius:0}
.source-datasets>summary{padding:3px 0;font-size:10px;color:var(--muted)}
.source-datasets>summary::after{font-size:14px}.source-dataset{padding-top:8px}
.source-dataset-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;color:#c8d2df}
.source-state .source-setup{display:inline-block;font-size:10px;margin-top:7px;text-decoration:none}
.source-legend{font-size:10px;line-height:1.65;color:var(--muted);margin:0 0 16px}
.usage-table th:nth-child(2),.usage-table td:nth-child(2),.usage-table th:last-child,.usage-table td:last-child{text-align:left}
.usage-scopes{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
.usage-scopes strong{font-size:12px;font-weight:500}.usage-scopes p{overflow-wrap:anywhere}
.setup-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.setup-grid h3{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;margin:0 0 7px}
.setup-grid p{font-size:12px;color:var(--muted);margin:0 0 8px;line-height:1.65}
.setup-grid a{font-size:11px}.setup-note{font-size:11px;color:var(--muted);margin:20px 0 0}
.snippet-head{display:flex;justify-content:space-between;align-items:center;gap:18px;margin:14px 0}
.snippet-head p{margin:0;color:var(--muted);font-size:11px}.button{border:1px solid #3e6559;background:#1e382f;
color:#b4ecd2;padding:8px 13px;border-radius:6px;font-size:11px;white-space:nowrap}.button:hover{background:#294a3e}
pre{background:#0d131a;border:1px solid var(--line);border-radius:7px;padding:17px;overflow:auto;margin:0;
font:11px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;color:#bbc9d9;white-space:pre}
.explain{display:grid;grid-template-columns:repeat(3,1fr);gap:26px;padding-top:36px;margin-top:28px;border-top:1px solid var(--line)}
.explain b{display:block;font-size:12px;font-weight:500;margin-bottom:8px}.explain p{margin:0;color:var(--muted);font-size:11px;line-height:1.8}
.error{color:#e2b570}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
footer{margin-top:38px;color:#6e8196;font-size:10px;display:flex;justify-content:space-between}
@media(max-width:950px){.shell{padding:0 24px 40px}.layout{grid-template-columns:190px minmax(0,1fr);gap:18px}
.config,.source-panel{padding:15px}h1{font-size:42px}.identity{display:none}}
@media(max-width:700px){.shell{padding:0 16px 30px}nav{height:68px}.hero{padding:32px 0 27px}h1{font-size:38px}
.hero p{font-size:13px}.layout{display:block}aside{position:static;margin-bottom:23px}.config{display:grid;
grid-template-columns:1fr 1fr;gap:12px}.config .section-title{grid-column:1/-1;margin-bottom:0}.control{margin:0}
.source-panel{display:grid;grid-template-columns:1fr 1fr;gap:18px}.source-panel .section-title{grid-column:1/-1;margin-bottom:0}
.source-state{margin:0;padding:0;border:0}.explain{grid-template-columns:1fr;gap:18px}.local{font-size:8px}
summary{padding:15px}summary small{margin-right:12px}footer{gap:18px}.table-wrap{max-height:400px}
.activity-tables{grid-template-columns:1fr}.source-legend{grid-column:1/-1}
.source-panel #ai-sources{display:contents}}
@media(max-width:500px){.setup-grid,.usage-scopes{grid-template-columns:1fr}.nav-links{gap:10px}
.source-strip{gap:10px 16px}.nav-links .local{display:none}}
@media(max-width:390px){.config{grid-template-columns:1fr}}
.accounts{margin:0 0 16px}.accounts>summary{padding:16px 20px}
.accounts .control{margin-bottom:12px}.accounts input[readonly]{color:var(--muted)}
.profile-error{font-size:11px;color:#e2b570;margin:10px 0 0;overflow-wrap:anywhere}
.source-picker{border:0;padding:0;margin:0 0 18px;min-width:0}
.source-picker legend{font-size:12px;color:#c8d2df;margin-bottom:7px}
.source-picker label{display:flex;align-items:center;gap:8px;margin:6px 0;font-size:11px}
.source-picker input{accent-color:var(--green);margin:0}
@media(max-width:700px){.source-picker{grid-column:1/-1;margin:0;
display:flex;flex-wrap:wrap;gap:0 16px}.source-picker legend{width:100%}}
</style>
</head>
<body>
<div class="shell">
<nav><div class="brand"><span class="mark" aria-hidden="true"><i></i><i></i><i></i></span>CodeStats</div>
<div class="nav-links"><a href="${docs}DEPLOYMENT.md" target="_blank" rel="noopener noreferrer">Setup guide ↗</a><span class="local" id="environment">CARD BUILDER</span></div></nav>
<header class="hero"><div><div class="eyebrow">Four sources. One developer card.</div><h1>Build your card.</h1>
<p>GitHub activity, WakaTime coding hours, Codex and OpenRouter usage.<br>Choose your style, then copy one Markdown snippet.</p>
<div class="source-strip" aria-label="Supported sources"><span>${sourceIcon(GITHUB_ICON)}GitHub</span><span>${sourceIcon(CLOCK_ICON)}WakaTime</span><span>${sourceIcon(PROVIDER_ICONS.codex, 24)}Codex</span><span>${sourceIcon(PROVIDER_ICONS.openrouter, 24)}OpenRouter</span></div></div>
<div class="identity"><strong id="identity">Loading profile</strong><small id="enabled-sources">Four source types · independent snapshots</small></div></header>
<div class="layout">
<aside>
<details class="accounts" id="accounts"><summary>Accounts</summary>
<div class="detail-body"><div class="control"><label for="account-mode">Account mode</label>
<select id="account-mode"><option value="configured">Server configuration</option>
<option value="public">Public IDs</option></select></div>
<div class="control"><label for="github-account">GitHub username</label>
<input id="github-account" type="text" maxlength="64" autocomplete="off" autocapitalize="none" spellcheck="false" readonly></div>
<div class="control"><label for="wakatime-account">WakaTime username</label>
<input id="wakatime-account" type="text" maxlength="64" autocomplete="off" autocapitalize="none" spellcheck="false" readonly></div>
<div class="control"><label for="codex-account">Codex ID</label>
<input id="codex-account" type="text" maxlength="64" autocomplete="off" autocapitalize="none" spellcheck="false" readonly></div>
<p class="detail-note" id="account-help">Tokens stay in server settings. Public usernames use separate, request-driven caches.</p>
<p class="detail-note"><a id="codex-profile-link" hidden target="_blank" rel="noopener noreferrer">Open Codex profile ↗</a></p>
<button class="button" id="apply-profile" type="button">Preview profile</button>
<p class="profile-error" id="profile-error" role="alert" hidden></p></div></details>
<form class="config" id="controls"><h2 class="section-title">Shape your card</h2>
<fieldset class="source-picker"><legend>Sources</legend>
<label><input type="checkbox" id="source-github" value="github" checked> GitHub</label>
<label><input type="checkbox" id="source-wakatime" value="wakatime" checked> WakaTime</label>
<label><input type="checkbox" id="source-codex" value="codex" checked> Codex</label>
<label><input type="checkbox" id="source-openrouter" value="openrouter" checked> OpenRouter</label>
</fieldset>
<div class="control"><label for="range">WakaTime range</label><select id="range" aria-describedby="range-help"><option value="all_time">All time</option>
<option value="last_7_days">Last 7 days</option><option value="last_30_days">Last 30 days</option></select><small class="control-hint" id="range-help">GitHub and AI periods stay independent.</small></div>
<div class="control"><label for="theme">Appearance</label><select id="theme"><option value="transparent">Transparent</option>
<option value="dark">Midnight</option><option value="light">Paper</option></select></div>
<div class="control"><label for="header">Profile header</label><select id="header">
<option value="true">Show</option><option value="false">Hide</option></select></div>
<div class="control"><label for="view">View</label><select id="view"><option value="overview">Overview</option>
<option value="github">GitHub</option><option value="wakatime">WakaTime</option>
<option value="codex">Codex</option><option value="openrouter">OpenRouter</option>
<optgroup label="Expanded details"><option value="languages">Language detail</option>
<option value="activity">GitHub activity</option></optgroup></select></div>
<div class="control"><label for="sort">Language order</label><select id="sort"><option value="code">GitHub code first</option>
<option value="time">Coding time first</option>
<option value="alternating">Selection order</option>
<option value="name">Alphabetical</option></select></div>
</form>
<section class="source-panel" aria-label="Source connections"><h2 class="section-title">Your sources</h2>
<p class="source-legend">Fresh: current snapshot. Stale: saved data. Unavailable: no saved data. Partial: missing GitHub metrics. Each service refreshes independently.</p>
<div class="source-state" data-source-provider="github"><div class="source-head"><span class="source-name">${sourceIcon(GITHUB_ICON)}GitHub</span><span class="badge" id="github-provider-status">Loading</span></div>
<small>Profile, repository code and personal activity.</small>
<details class="source-datasets" id="github-datasets"><summary>Repository &amp; activity status</summary>
<div class="source-dataset"><div class="source-dataset-head"><span>Repositories</span><span class="badge" id="github-status">Loading</span></div><small id="github-time">Waiting for source</small><small id="github-error"></small></div>
<div class="source-dataset"><div class="source-dataset-head"><span>Personal activity</span><span class="badge" id="githubActivity-status">Loading</span></div><small id="githubActivity-time">Waiting for source</small><small id="githubActivity-error"></small></div></details>
<a class="source-setup" href="${docs}DEPLOYMENT.md#github" target="_blank" rel="noopener noreferrer">GitHub setup ↗</a></div>
<div class="source-state" data-source-provider="wakatime"><div class="source-head"><span class="source-name">${sourceIcon(CLOCK_ICON)}WakaTime</span><span class="badge" id="wakatime-status">Loading</span></div>
<small>Coding time for your selected range.</small><small id="wakatime-time">Waiting for source</small><small id="wakatime-error"></small>
<a class="source-setup" href="${docs}DEPLOYMENT.md#wakatime" target="_blank" rel="noopener noreferrer">WakaTime setup ↗</a></div><div id="ai-sources">${optionalPlaceholders}</div></section>
</aside>
<main>
<div class="preview-label"><span>README card</span><a id="json-link" href="/api/stats?range=all_time" target="_blank" rel="noopener">View source JSON ↗</a></div>
<div class="card-stage" id="stage"><div class="loading" id="loading">Fetching your first snapshot<span>Reading your configured GitHub, WakaTime, Codex and OpenRouter sources.</span></div>
<img id="card" alt="CodeStats developer card: GitHub, WakaTime and configured AI usage" hidden></div>
<p class="note" id="range-note">WakaTime measures tracked coding time. GitHub measures current repository language bytes, not personally authored lines.</p>
<details id="language-details"><summary>Language breakdown <small id="language-count">Waiting for data</small></summary>
<div class="detail-body"><p class="detail-note">Related languages are summed first. Nine groups are selected by alternating GitHub and WakaTime ranks, starting with GitHub, then ordered by GitHub code bytes by default. Others includes every remaining group and unclassified time. Byte and time totals are fully represented, with separate denominators. Repo counts use the headline inventory, deduplicate within each group and may overlap across groups. Raw values remain in the source JSON. A dash means unavailable data.</p>
<div class="table-wrap"><table><thead><tr><th>Language</th><th>Repos</th><th>Code bytes</th><th>Code share</th><th>Time</th><th>Time share</th></tr></thead>
<tbody id="language-body"></tbody></table></div></div></details>
<details id="activity-details"><summary>GitHub activity <small id="activity-summary">Waiting for data</small></summary>
<div class="detail-body"><p class="detail-note" id="activity-source">Waiting for GitHub activity source.</p>
<p class="detail-note" id="activity-scope">Personal contributions include organizations and external repositories. Private repository names are never shown.</p>
<p class="detail-note" id="activity-periods">A dash means unavailable, not zero. GitHub activity periods are independent of the WakaTime range.</p>
<div class="activity-tables"><section><h3>Personal activity</h3><div class="table-wrap"><table>
<thead><tr><th>Metric</th><th>Count</th><th>Period</th></tr></thead><tbody id="activity-body"></tbody></table></div></section>
<section><h3>Contribution calendar by year</h3><div class="table-wrap"><table>
<thead><tr><th>Year</th><th>Contributions</th></tr></thead><tbody id="contribution-years"></tbody></table></div></section></div>
<details><summary>How these counts are defined</summary><div class="detail-body">
<p class="detail-note">These counts describe different actions and periods; they are not added together. GitHub search, contribution eligibility, token permissions, and organization access can limit coverage. Language bytes describe current repository content, including other authors.</p>
<dl class="metric-definitions" id="activity-definitions"></dl></div></details></div></details>
<details id="ai-usage-details"><summary>AI usage <small id="ai-usage-summary">Waiting for sources</small></summary>
<div class="detail-body"><p class="detail-note">Codex and OpenRouter keep their own reporting periods. Tokens and requests are different units; provider totals are never added together. A dash means unavailable, not zero.</p>
<div class="table-wrap"><table class="usage-table"><thead><tr><th>Service</th><th>Metric</th><th>Value</th><th>Period</th></tr></thead><tbody id="ai-usage-body"></tbody></table></div>
<div class="usage-scopes" id="ai-usage-scopes"></div></div></details>
<details id="readme-details" open><summary>Add to your GitHub README <small>Copy and paste</small></summary>
<div class="detail-body"><label for="public-url">Public HTTPS URL</label>
<input id="public-url" type="url" value="https://stats.example.com" aria-describedby="url-note">
<p><label><input id="include-details" type="checkbox"> Include expandable language and activity cards</label></p>
<div class="snippet-head"><p id="url-note">Replace this after deployment. Localhost images cannot load on GitHub.</p>
<button class="button" id="copy" type="button">Copy Markdown</button></div><pre id="snippet"></pre></div></details>
<details id="source-setup-details"><summary>Connect your sources <small>Node or Cloudflare Workers</small></summary>
<div class="detail-body"><div class="setup-grid">
<section><h3>${sourceIcon(GITHUB_ICON)}GitHub</h3><p>Your profile, aggregate activity and repository language bytes. A server-side token enables the private data your account can access.</p><a href="${docs}DEPLOYMENT.md#github" target="_blank" rel="noopener noreferrer">Credentials and repository scope ↗</a></section>
<section><h3>${sourceIcon(CLOCK_ICON)}WakaTime</h3><p>Coding time by language. Public statistics need no token; unpublished ranges need read-stats OAuth access. All time is the default.</p><a href="${docs}DEPLOYMENT.md#wakatime" target="_blank" rel="noopener noreferrer">Public and private statistics ↗</a></section>
<section><h3>${sourceIcon(PROVIDER_ICONS.codex, 24)}Codex</h3><p>Lifetime account totals, peak usage, longest task and streaks. Read through your local Codex login, or sync aggregates to your Worker.</p><a href="${docs}AI-USAGE.md#codex" target="_blank" rel="noopener noreferrer">Enable Codex usage ↗</a></section>
<section><h3>${sourceIcon(PROVIDER_ICONS.openrouter, 24)}OpenRouter</h3><p>Tokens, requests, averages and streaks across up to 367 completed UTC days. Requires a Management key, rather than a regular inference key.</p><a href="${docs}AI-USAGE.md#openrouter" target="_blank" rel="noopener noreferrer">Enable OpenRouter analytics ↗</a></section>
</div><p class="setup-note">Configure credentials on your server. The generated Markdown contains only the public card URL. <a href="${docs}DEPLOYMENT.md" target="_blank" rel="noopener noreferrer">Full deployment guide ↗</a></p></div></details>
<section class="explain"><div><b>Four sources, separate measures</b><p>GitHub measures activity and repository code. WakaTime measures coding time. Codex and OpenRouter report their own AI usage. Periods and totals stay separate.</p></div>
<div><b>Freshness, made visible</b><p>Each source keeps its last successful snapshot. If an API is down, saved numbers remain visible with their own timestamp and a stale label.</p></div>
<div><b>Made for your README</b><p>A single SVG works as a GitHub image. Native details sections reveal language and activity cards. The interactive controls live at /build; the homepage serves the image directly.</p></div></section>
</main></div>
<footer><span>CODESTATS · NODE.JS + CLOUDFLARE WORKERS</span><span id="footer-scope">Aggregates. Independently refreshed.</span></footer>
</div>
<script>
(() => {
    'use strict';
    const $ = (id) => document.getElementById(id);
    const controls = ['range', 'theme', 'header', 'view', 'sort'];
    const defaults = { range: ${JSON.stringify(defaultRange)},
        theme: 'transparent', header: 'true',
        view: 'overview', sort: 'code', limit: '10' };
    const query = new URLSearchParams(location.search);
    const services = ['github', 'wakatime', 'codex', 'openrouter'];
    const accountServices = ['github', 'wakatime', 'codex'];
    const normalizeAccount = ${normalizeProfileAccount.toString()};
    let publicMode = accountServices.some(service => query.has(service));
    let appliedAccounts = {};
    let configuredAccounts = {};
    let explicitSources = query.has('sources');
    let selectedSources = explicitSources ? query.get('sources').split(',')
        .map(value => value.trim().toLowerCase()) : services.slice();
    for (const service of accountServices) {
        if (query.has(service)) {
            appliedAccounts[service] = normalizeAccount(service, query.get(service));
        }
    }
    if (publicMode && !explicitSources) selectedSources = Object.keys(appliedAccounts);
    function showAccountMode() {
        const editingPublic = $('account-mode').value === 'public';
        const accounts = editingPublic ? appliedAccounts : configuredAccounts;
        for (const service of accountServices) {
            $(service + '-account').readOnly = !editingPublic;
            $(service + '-account').value = accounts[service] || '';
        }
        $('account-help').textContent = editingPublic
            ? 'Public IDs never use the server owner’s tokens. Codex usage needs account access; OpenRouter needs a server Management key.'
            : 'These accounts and all tokens are managed in server settings. No token is included in the image URL.';
        const codex = accounts.codex;
        $('codex-profile-link').hidden = !codex;
        if (codex) $('codex-profile-link').href = 'https://chatgpt.com/u/'
            + encodeURIComponent(codex);
    }
    function showSourceSelection() {
        for (const service of services) {
            $('source-' + service).checked = selectedSources.includes(service);
        }
    }
    $('account-mode').value = publicMode ? 'public' : 'configured';
    $('accounts').open = publicMode;
    showAccountMode(); showSourceSelection();
    for (const id of controls) {
        const value = query.get(id) || defaults[id];
        if (Array.from($(id).options).some(option => option.value === value)) {
            $(id).value = value;
        }
    }
    let snapshot = null;
    let generation = 0;
    const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
    const number = ${number.toString()};
    const tokenTotal = ${tokenTotal.toString()};
    const usageDays = ${usageDays.toString()};
    const taskDuration = ${taskDuration.toString()};
    const usageMetrics = ${usageMetrics.toString()};
    const usagePeriod = ${usagePeriod.toString()};
    const usageLabels = ${JSON.stringify(AI_LABELS)};
    const providerIcons = ${JSON.stringify(PROVIDER_ICONS)};
    const docs = ${JSON.stringify(docs)};
    const languageIcons = ${JSON.stringify(LANGUAGE_ICONS)};
    const languageIcon = ${languageIcon.toString()};
    const codeSize = ${codeSize.toString()};
    const activityMetrics = ${JSON.stringify(ACTIVITY_METRICS)};
    const activityPeriods = ${JSON.stringify(ACTIVITY_PERIODS)};
    const activitySource = () => snapshot.githubActivity || {
        data: null, status: 'unavailable', lastSuccessAt: null, lastError: null,
    };
    const count = (value) => Number.isFinite(value) && value >= 0 ? fmt.format(value) : '—';
    const day = (value) => value && !isNaN(Date.parse(value))
        ? new Date(value).toISOString().slice(0, 10) : 'date unavailable';
    const duration = (seconds) => fmt.format(Math.floor(seconds / 3600)) + 'h ' + Math.floor(seconds / 60) % 60 + 'm';
    const percentage = (value) => value === null ? '—' : value.toFixed(2) + '%';
    const date = (value) => value && !isNaN(Date.parse(value)) ? new Date(value).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'No successful snapshot yet';
    const params = (theme, view) => {
        const values = new URLSearchParams({
            range: $('range').value,
            theme: theme || $('theme').value,
            header: $('header').value,
            view: view || $('view').value,
            limit: '10', sort: $('sort').value,
        });
        if (publicMode) {
            for (const service of accountServices) {
                if (appliedAccounts[service]) values.set(service, appliedAccounts[service]);
            }
        }
        if (explicitSources) values.set('sources', selectedSources.join(','));
        return values;
    };
    const tableRows = () => {
        return snapshot ? snapshot.languageRows || [] : [];
    };
    function updateTable() {
        const rows = tableRows();
        $('language-count').textContent = rows.length + ' rows · full totals';
        $('language-body').replaceChildren();
        for (const row of rows) {
            const tr = document.createElement('tr');
            const name = document.createElement('td');
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.setAttribute('class', 'language-icon');
            icon.setAttribute('viewBox', '0 0 24 24');
            icon.setAttribute('aria-hidden', 'true');
            icon.setAttribute('fill', row.color);
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('fill-rule', row.name === 'SQL' ? 'evenodd' : 'nonzero');
            path.setAttribute('d', languageIcon(row.name, languageIcons));
            icon.append(path);
            name.append(icon, document.createTextNode(row.name)); tr.append(name);
            for (const value of [count(row.repositoryCount), codeSize(row.codeBytes),
                percentage(row.codePercent),
                snapshot.wakatime.data ? duration(row.seconds) : '—',
                snapshot.wakatime.data ? percentage(row.timePercent) : '—']) {
                const td = document.createElement('td'); td.textContent = value; tr.append(td);
            }
            $('language-body').append(tr);
        }
    }
    function updateActivity() {
        const source = activitySource();
        const data = source.data;
        const all = data && data.visibility === 'all';
        const state = source.status === 'fresh' ? 'fresh'
            : data ? source.lastError ? 'saved data · refresh unavailable'
                : 'saved data · refresh due' : 'unavailable';
        $('activity-summary').textContent = state;
        $('activity-source').textContent = 'GitHub activity · ' + state + ' · ' + date(source.lastSuccessAt)
            + '. Repository code and profile metrics have a separate GitHub snapshot.';
        $('activity-scope').textContent = (!data
            ? 'GitHub activity scope is unavailable. Organization and external-repository coverage depends on GitHub access. '
            : all
            ? 'Public + private aggregates visible to the token, including organizations and external repositories. '
            : 'Public aggregates, including organizations and external repositories. ')
            + 'Private repository names are never shown.' + (data ? ' Source scope: ' + data.scope : '');
        $('activity-periods').textContent = (data
            ? 'Lifetime: ' + day(data.allTimeFrom) + '–' + day(data.allTimeTo)
                + '. Recent year: ' + day(data.recentFrom) + '–' + day(data.recentTo) + '. '
            : '') + 'A dash means unavailable, not zero. GitHub activity periods are independent of the WakaTime range.';
        $('activity-body').replaceChildren();
        $('activity-definitions').replaceChildren();
        for (const metric of activityMetrics) {
            const metricData = metric.source === 'github' ? snapshot.github.data : data;
            const tr = document.createElement('tr');
            for (const value of [metric.label, count(metricData ? metricData[metric.key] : undefined), activityPeriods[metric.period]]) {
                const td = document.createElement('td'); td.textContent = value; tr.append(td);
            }
            $('activity-body').append(tr);
            const dt = document.createElement('dt'); dt.textContent = metric.label + ' · ' + activityPeriods[metric.period];
            const dd = document.createElement('dd'); dd.textContent = metric.definition;
            $('activity-definitions').append(dt, dd);
        }
        $('contribution-years').replaceChildren();
        for (const row of data ? data.contributionsByYear.slice().sort((a, b) => b.year - a.year) : []) {
            const tr = document.createElement('tr');
            const year = Number.isInteger(row.year) && row.year >= 0 ? String(row.year) : '—';
            for (const value of [year, count(row.contributions)]) {
                const td = document.createElement('td'); td.textContent = value; tr.append(td);
            }
            $('contribution-years').append(tr);
        }
        if (!data || !data.contributionsByYear.length) {
            const tr = document.createElement('tr'); const td = document.createElement('td');
            td.colSpan = 2; td.textContent = data ? 'No calendar years returned.' : 'No successful activity snapshot yet.';
            tr.append(td); $('contribution-years').append(tr);
        }
    }
    function updateSnippet() {
        let base;
        try {
            const parsed = new URL($('public-url').value.trim());
            if (parsed.protocol !== 'https:' || parsed.username || parsed.password
                || parsed.search || parsed.hash) throw new Error();
            base = parsed.origin;
            $('copy').disabled = false;
        } catch (_) {
            $('snippet').textContent = 'Enter a valid public HTTPS URL.';
            $('copy').disabled = true;
            return;
        }
        const project = 'https://github.com/Leask/CodeStats';
        const url = (view) => {
            const selected = params(null, view);
            for (const [key, value] of Object.entries(defaults)) {
                if (selected.get(key) === value) selected.delete(key);
            }
            return base + '/' + (selected.size ? '?' + selected : '');
        };
        const markdown = (view, alt) => '[![' + alt + '](' + url(view) + ')](' + project + ')';
        let snippet = markdown($('view').value, 'CodeStats');
        if ($('include-details').checked) {
            snippet += '\n\n<details>\n<summary>Languages · 9 groups + Others</summary>\n\n'
                + markdown('languages', 'CodeStats languages') + '\n\n</details>'
                + '\n\n<details>\n<summary>GitHub activity</summary>\n\n'
                + markdown('activity', 'CodeStats GitHub activity') + '\n\n</details>';
        }
        $('snippet').textContent = snippet;
    }
    function updateCard() {
        const image = $('card');
        $('stage').className = 'card-stage ' + $('theme').value;
        image.src = '/card.svg?' + params() + '&preview=' + Date.now();
        image.hidden = false;
        $('json-link').href = '/api/stats?' + params();
        updateTable(); updateSnippet();
    }
    function updateAIUsage() {
        $('ai-usage-body').replaceChildren();
        $('ai-usage-scopes').replaceChildren();
        const services = ['codex', 'openrouter', 'anthropic']
            .filter(service => snapshot.aiUsage && snapshot.aiUsage[service]);
        $('ai-usage-summary').textContent = services.length
            ? services.length + ' selected services · independent periods' : 'Not enabled';
        for (const service of services) {
            const source = snapshot.aiUsage[service];
            const data = source.data;
            for (const metric of usageMetrics(service, data)) {
                const tr = document.createElement('tr');
                tr.dataset.usageDetail = service;
                tr.dataset.usageMetric = metric.key;
                for (const value of [usageLabels[service], metric.label,
                    metric.exact === 'unavailable' ? '—' : metric.exact,
                    data ? usagePeriod(service, data) : 'Unavailable']) {
                    const td = document.createElement('td');
                    td.textContent = value;
                    tr.append(td);
                }
                $('ai-usage-body').append(tr);
            }
            const section = document.createElement('section');
            const title = document.createElement('strong');
            title.textContent = usageLabels[service] + ' · ' + source.status;
            const scope = document.createElement('p');
            scope.className = 'detail-note';
            scope.textContent = data ? data.scope : source.lastError
                || 'No successful usage snapshot yet.';
            const refreshed = document.createElement('p');
            refreshed.className = 'detail-note';
            refreshed.textContent = 'Last successful snapshot: ' + date(source.lastSuccessAt);
            section.append(title, scope, refreshed);
            $('ai-usage-scopes').append(section);
        }
        if (!services.length) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 4;
            td.textContent = 'Enable Codex or OpenRouter to add AI usage to your card.';
            tr.append(td); $('ai-usage-body').append(tr);
        }
    }
    function updateSources() {
        const selected = snapshot.selectedSources || services;
        if (!explicitSources) {
            selectedSources = selected.slice(); showSourceSelection();
        }
        if (snapshot.profile && snapshot.profile.mode === 'configured') {
            configuredAccounts = snapshot.profile.accounts;
            if ($('account-mode').value === 'configured') showAccountMode();
        }
        for (const name of ['github', 'githubActivity', 'wakatime']) {
            const source = name === 'githubActivity' ? activitySource() : snapshot[name];
            const enabled = selected.includes(name === 'githubActivity' ? 'github' : name);
            $(name + '-status').textContent = enabled ? source.status : 'Not selected';
            $(name + '-status').className = 'badge ' + (enabled ? source.status : 'not-enabled');
            $(name + '-time').textContent = enabled ? date(source.lastSuccessAt) : '';
            $(name + '-error').textContent = source.lastError || '';
        }
        const githubSources = [snapshot.github, activitySource()];
        const githubState = !selected.includes('github') ? 'not-enabled'
            : snapshot.github.data && snapshot.github.data.languageCoverage === 'unavailable' ? 'partial'
            : githubSources.every(source => !source.data) ? 'unavailable'
            : githubSources.some(source => !source.data) ? 'partial'
            : githubSources.some(source => source.status !== 'fresh') ? 'stale' : 'fresh';
        $('github-provider-status').textContent = githubState === 'not-enabled' ? 'Not selected' : githubState;
        $('github-provider-status').className = 'badge ' + githubState;
        $('github-datasets').open = githubState !== 'fresh';
        const aiPanels = [];
        for (const [service, label] of [
            ['codex', 'Codex'], ['openrouter', 'OpenRouter'],
            ['anthropic', 'Anthropic API'],
        ]) {
            const source = snapshot.aiUsage && snapshot.aiUsage[service];
            if (!source && service === 'anthropic') continue;
            const panel = document.createElement('div');
            panel.className = 'source-state';
            panel.dataset.sourceProvider = service;
            if (source) panel.dataset.usageSource = service;
            const head = document.createElement('div');
            head.className = 'source-head';
            const name = document.createElement('span');
            name.className = 'source-name';
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.setAttribute('class', 'source-icon');
            icon.setAttribute('viewBox', '0 0 24 24');
            icon.setAttribute('aria-hidden', 'true');
            icon.setAttribute('fill', 'currentColor');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', providerIcons[service]);
            icon.append(path);
            name.append(icon, document.createTextNode(label));
            const badge = document.createElement('span');
            badge.id = service + '-status';
            badge.className = 'badge ' + (source ? source.status : 'not-enabled');
            badge.textContent = source ? source.status
                : selected.includes(service) ? 'Not enabled' : 'Not selected';
            head.append(name, badge);
            const refreshed = document.createElement('small');
            refreshed.id = service + '-time';
            refreshed.textContent = source ? date(source.lastSuccessAt)
                : service === 'codex' ? 'Local Codex login or aggregate sync.'
                : 'OpenRouter Management key required.';
            const period = document.createElement('small');
            period.textContent = source && source.data ? usagePeriod(service, source.data) : '';
            const error = document.createElement('small');
            error.id = service + '-error';
            error.textContent = source && source.lastError || '';
            const setup = document.createElement('a');
            setup.className = 'source-setup';
            setup.href = docs + 'AI-USAGE.md#'
                + (service === 'anthropic' ? 'advanced-anthropic-api' : service);
            setup.target = '_blank';
            setup.rel = 'noopener noreferrer';
            setup.textContent = source ? 'Setup & metrics ↗' : 'Enable ' + label + ' ↗';
            panel.append(head, refreshed, period, error, setup);
            aiPanels.push(panel);
        }
        $('ai-sources').replaceChildren(...aiPanels);
        const enabled = selected.filter(service => service === 'github'
            ? snapshot.github.data : service === 'wakatime' ? snapshot.wakatime.data
            : snapshot.aiUsage && snapshot.aiUsage[service] && snapshot.aiUsage[service].data).length;
        const extensions = snapshot.aiUsage && snapshot.aiUsage.anthropic ? ' · Anthropic extension' : '';
        $('enabled-sources').textContent = selected.length + ' sources selected · '
            + enabled + ' with saved data' + extensions;
        const github = snapshot.github.data;
        const waka = snapshot.wakatime.data;
        const accounts = snapshot.profile && snapshot.profile.accounts || {};
        $('identity').textContent = '@' + (github ? github.username : waka ? waka.username
            : accounts.codex || accounts.github || accounts.wakatime || 'profile');
        const all = github && github.visibility === 'all';
        let note = 'GitHub code bytes and WakaTime hours use separate totals. '
            + 'Each bar column rounds its scale upward in 10% steps; labels show true source shares.';
        if (github && github.collectionVersion >= 4) {
            note += all ? ' Public + private repositories in the configured scope.'
                : ' Public repositories in the configured scope.';
            note += github.includeForks ? ' Forks included.' : ' Forks excluded.';
        }
        if (github && github.collectionVersion >= 5) {
            note += ' Stars count owned repositories only.';
        }
        if (github && github.languageCoverage === 'unavailable') {
            note += ' Anonymous GitHub supplies public profile, owned repositories and search counts; language bytes, calendar and review metrics need a server token.';
        }
        if (waka && waka.end) note += ' WakaTime through ' + waka.end.slice(0, 10) + '.';
        else if (waka && waka.rangeLabel) note += ' WakaTime: ' + waka.rangeLabel + '.';
        if (waka && !waka.includesToday) note += ' Today is excluded by the source.';
        if (!waka) note += ' This WakaTime range is unavailable; no other range is substituted.';
        const staleSources = [snapshot.github, activitySource(), snapshot.wakatime,
            ...Object.values(snapshot.aiUsage || {})].filter(source => source.status === 'stale');
        if (staleSources.some((source) => source.lastError)) note += ' Saved data remains visible after an unsuccessful source refresh.';
        else if (staleSources.length) note += ' Saved data remains visible while a refresh is due.';
        $('range-note').textContent = note + ' WakaTime range changes do not change GitHub or AI reporting periods.';
        $('footer-scope').textContent = all || activitySource().data && activitySource().data.visibility === 'all'
            ? 'Public + private aggregates. Independently refreshed.' : 'Public aggregates. Independently refreshed.';
        updateActivity(); updateAIUsage();
    }
    async function load() {
        const current = ++generation;
        $('card').hidden = true;
        $('loading').hidden = false;
        $('loading').classList.remove('error');
        $('loading').replaceChildren(document.createTextNode('Loading your snapshot…'));
        let data;
        try {
            const response = await fetch('/api/stats?' + params());
            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }
            try { data = await response.json(); }
            catch (_) { throw new Error('invalid JSON response'); }
        } catch (error) {
            if (current !== generation) return;
            const detail = error instanceof Error
                && /^(HTTP \d{3}|invalid JSON response)$/.test(error.message)
                ? error.message : 'network request failed';
            $('loading').textContent = 'Could not load /api/stats (' + detail
                + '). Check Worker runtime settings and storage bindings.';
            $('loading').classList.add('error');
            return;
        }
        if (current !== generation) return;
        snapshot = data;
        try {
            updateSources(); updateCard(); $('loading').hidden = true;
        } catch (error) {
            $('loading').textContent = 'The card builder could not render the data. '
                + 'Open /api/stats for source status; Markdown remains available.';
            $('loading').classList.add('error');
            console.error('CodeStats builder rendering failed', error);
        }
    }
    for (const id of controls) $(id).addEventListener('change', () =>
        ['range', 'sort'].includes(id) ? load() : updateCard());
    $('account-mode').addEventListener('change', showAccountMode);
    $('apply-profile').addEventListener('click', () => {
        try {
            const nextPublic = $('account-mode').value === 'public';
            const accounts = {};
            if (nextPublic) {
                for (const service of accountServices) {
                    const value = $(service + '-account').value.trim();
                    if (value) accounts[service] = normalizeAccount(service, value);
                }
                if (!Object.keys(accounts).length) throw new Error('Enter at least one public username or ID.');
            }
            publicMode = nextPublic; appliedAccounts = accounts;
            if (!explicitSources) selectedSources = nextPublic
                ? Object.keys(accounts) : services.slice();
            showAccountMode(); showSourceSelection();
            $('profile-error').hidden = true;
            for (const id of ['language-body', 'activity-body', 'contribution-years',
                'ai-usage-body', 'ai-usage-scopes', 'activity-definitions']) $(id).replaceChildren();
            updateSnippet(); load();
        } catch (error) {
            $('profile-error').textContent = error.message;
            $('profile-error').hidden = false;
        }
    });
    for (const service of services) $('source-' + service).addEventListener('change', () => {
        const next = services.filter(name => $('source-' + name).checked);
        if (!next.length) {
            $('source-' + service).checked = true;
            return;
        }
        explicitSources = true; selectedSources = next;
        updateSnippet(); load();
    });
    $('controls').addEventListener('submit', (event) => event.preventDefault());
    $('public-url').addEventListener('input', updateSnippet);
    $('include-details').addEventListener('change', updateSnippet);
    $('copy').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText($('snippet').textContent);
            $('copy').textContent = 'Copied'; setTimeout(() => { $('copy').textContent = 'Copy Markdown'; }, 1600);
        } catch (_) { $('copy').textContent = 'Select and copy the code'; }
    });
    $('card').addEventListener('error', () => {
        $('loading').hidden = false;
        $('loading').textContent = 'The SVG could not be rendered. Source details remain available below.';
    });
    if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
        $('public-url').value = location.origin;
    }
    updateSnippet(); load();
})();
</script>
</body>
</html>`;
}
