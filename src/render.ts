import type {
    CardOptions,
    LanguageRow,
    Range,
    SourceSnapshot,
    StatsSnapshot,
} from './types';
import { LANGUAGE_ICONS, languageIcon } from './language-icons';
import { CLOCK_ICON, GITHUB_ICON, METRIC_ICONS } from './ui-icons';
import { profileRank } from './rank';

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

function shortened(value: string, maximum: number): string {
    return value.length > maximum ? value.slice(0, maximum - 1) + '…' : value;
}

function profileLine(value: string): string {
    let units = 0;
    let result = '';
    for (const char of value) {
        units += /[^\u0000-\u00ff]/.test(char) ? 1 : 0.62;
        if (units > 55) return result + '…';
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
    sort: CardOptions['sort'] = 'time',
    limit = 10,
    codeAvailable = rows.some(row => row.codeBytes !== null),
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

/** Sum explicit language families before ranking; keep both denominators. */
export function joinLanguages(
    snapshot: StatsSnapshot,
    sort: CardOptions['sort'] = 'alternating',
): LanguageRow[] {
    const github = snapshot.github.data;
    const totalSeconds = snapshot.wakatime.data?.totalSeconds ?? 0;
    const code = new Map<string, { name: string; bytes: number; color: string }>();
    for (const language of github?.languages ?? []) {
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
        const knownCode = github !== null && key !== 'other';
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
                github.totalBytes > 0 ? 100 * bytes / github.totalBytes : 0
            ) : null,
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
                codePercent: github && github.totalBytes > 0
                    ? 100 * language.bytes / github.totalBytes : 0,
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

function duration(seconds: number): string {
    const minutes = Math.floor(finite(seconds) / 60);
    const hours = Math.floor(minutes / 60);
    return `${hours.toLocaleString('en-US')}h ${minutes % 60}m`;
}

function codeSize(bytes: number | null): string {
    if (bytes === null) return '—';
    const value = finite(bytes);
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(units.length - 1,
        Math.floor(Math.log10(Math.max(1, value)) / 3));
    return `${Number((value / 1000 ** index).toFixed(1))} ${units[index]}`;
}

/** Age of the last successful refresh when this static card was generated. */
export function refreshAge(lastSuccessAt: string | null, at: string): string {
    const difference = Date.parse(at) - Date.parse(lastSuccessAt ?? '');
    if (!Number.isFinite(difference)) return 'not refreshed';
    const minutes = Math.max(0, Math.floor(difference / 60_000));
    const remainder = minutes % 60;
    return `${number(Math.floor(minutes / 60))} hr, ${remainder} `
        + `min${remainder === 1 ? '' : 's'} ago`;
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

export function renderCard(snapshot: StatsSnapshot, options: CardOptions): string {
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
    const rows = displayLanguages(selectLanguages(
        allRows, options.sort, options.limit, snapshot.github.data !== null,
    ), 1);
    const activity = options.view === 'activity';
    const empty = rows.length === 0;
    const bodyHeight = activity ? 448 : Math.max(96, rows.length * 39 + 24);
    const metricRowHeight = 64;
    const hiddenHeaderHeight = options.header === false ? 100 : 0;
    const contentOffset = 61 - hiddenHeaderHeight;
    const footerY = 257 + contentOffset + bodyHeight;
    const height = footerY + 40;
    const github = snapshot.github.data;
    const activitySource = githubActivitySource(snapshot);
    const githubActivity = activitySource.data;
    const waka = snapshot.wakatime.data;
    const username = github?.username ?? waka?.username
        ?? githubActivity?.username ?? 'Your profile';
    const title = `${username} · coding footprint`;
    const allVisible = github?.visibility === 'all';
    const activityAllVisible = githubActivity?.visibility === 'all';
    const fullName = shortened(github?.name ?? username, 36);
    const profileDescription = github?.bio?.trim()
        || github?.profileStatus?.trim() || '';
    const rank = profileRank(github, githubActivity);
    const metrics = [
        {
            id: 'coding-time',
            value: waka ? number(Math.floor(waka.totalSeconds / 3600)) : '—',
            label: 'CODING HOURS',
        },
        {
            id: 'calendar-contributions',
            value: number(githubActivity?.allTimeContributions),
            label: 'CALENDAR CONTRIBUTIONS',
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
        x: number, y: number, value: unknown, size = 12,
        fill = palette.fg, extra = '',
    ) => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${xml(value)}</text>`;
    const avatar = github?.avatarDataUri;
    const embeddedAvatar = typeof avatar === 'string'
        && /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(avatar);
    const nameUnits = [...fullName].reduce((sum, char) =>
        sum + (/[^\u0000-\u00ff]/.test(char) ? 1 : 0.62), 0);
    const nameSize = Math.min(26, 680 / (nameUnits + (username.length + 1) * 0.42));
    const profileHeader = '<g data-profile-header="true">'
        + '<defs><clipPath id="avatar-clip">'
        + '<circle cx="66" cy="78" r="34"/></clipPath></defs>'
        + (embeddedAvatar
            ? `<image data-github-avatar="true" x="32" y="44" width="68" height="68" `
                + `href="${xml(avatar)}" clip-path="url(#avatar-clip)" `
                + 'preserveAspectRatio="xMidYMid slice"/>'
            : `<circle cx="66" cy="78" r="34" fill="${palette.panel}"/>`
                + text(66, 89, username.slice(0, 1).toUpperCase(), 30,
                    palette.muted, 'text-anchor="middle"'))
        + `<text data-profile-name="true" x="116" y="66" font-size="${nameSize.toFixed(2)}" `
        + `fill="${palette.fg}" font-weight="650">${xml(fullName)}`
        + `<tspan dx="12" font-size="${(nameSize * 0.68).toFixed(2)}" `
        + `fill="${palette.muted}" font-weight="400">@${xml(username)}</tspan></text>`
        + '<g data-profile-description="true"><title>' + xml(profileDescription) + '</title>'
        + text(116, 87, profileLine(profileDescription), 12, palette.muted) + '</g>'
        + '<g data-profile-rank="true"><title>Estimated percentile from the '
        + 'GitHub Stats Extended weighted model: commits, PRs, issues, recent '
        + 'review contributions, owned stars and followers.</title>'
        + (rank ? text(116, 108, 'Top '
            + `${rank.percentile < 0.01 ? '<0.01' : rank.percentile.toFixed(2)}% · ${rank.level}`,
        12, palette.time) : '') + '</g></g>';
    const metricMarkup = metrics.map((metric, index) => {
        const x = 32 + index % 4 * 211;
        const y = 166 - hiddenHeaderHeight
            + Math.floor(index / 4) * metricRowHeight;
        const valueX = x + 42;
        const size = Math.min(29, Math.floor(142 / (metric.value.length * 0.62)));
        const iconSize = 36;
        // Include the label baseline and its descenders in the text block.
        const iconY = y + (26 - size - iconSize) / 2;
        return `<g data-summary-metric="${metric.id}">`
            + `<svg data-summary-icon="${metric.id}" x="${x}" y="${iconY}" `
            + `width="${iconSize}" height="${iconSize}" viewBox="0 0 16 16" aria-hidden="true" `
            + `fill="${palette.muted}"><path d="${METRIC_ICONS[metric.id]}"/></svg>`
            + text(valueX, y, metric.value, size, palette.fg, 'font-weight="650"')
            + text(valueX, y + 23, metric.label, 10, palette.muted, 'letter-spacing="1"')
            + '</g>';
    }).join('');
    let body = '';
    if (activity) {
        const scope = !githubActivity ? 'PERSONAL ACTIVITY'
            : activityAllVisible ? 'TOKEN-VISIBLE ACTIVITY' : 'PUBLIC ACTIVITY';
        body = text(32, 257, `GITHUB · ${scope}`, 10, palette.muted, 'letter-spacing="1.2"');
        body += ACTIVITY_METRICS.map((metric, index) => {
            const x = 32 + index % 4 * 211;
            const y = 303 + Math.floor(index / 4) * 83;
            const value = number(metric.source === 'github'
                ? github?.[metric.key] : githubActivity?.[metric.key]);
            const label = metric.source === 'github' && !allVisible
                && ['pullRequests', 'issues'].includes(metric.key)
                ? 'Public ' + metric.label : metric.label;
            const size = Math.min(28, Math.floor(184 / (value.length * 0.62)));
            return '<g><title>' + xml(`${label}: ${value}. ${metric.definition} `
                + `Period: ${ACTIVITY_PERIODS[metric.period]}.`)
                + '</title>'
                + text(x, y, value, size, palette.fg, 'font-weight="600"')
                + text(x, y + 22, label, 12, palette.fg)
                + text(x, y + 40, ACTIVITY_PERIODS[metric.period], 10, palette.muted)
                + '</g>';
        }).join('');
        const periods = githubActivity
            ? `Lifetime: ${day(githubActivity.allTimeFrom)}–${day(githubActivity.allTimeTo)}. `
                + `Recent year: ${day(githubActivity.recentFrom)}–${day(githubActivity.recentTo)}.`
            : 'GitHub activity has no successful snapshot yet. A dash means unavailable, not zero.';
        body += text(32, 637, periods, 11, palette.muted);
        body += text(32, 659, 'Reviewed/commented items exclude self-authored items; each distinct item counts once.', 11, palette.muted);
        body += text(32, 681, !githubActivity
            ? 'Activity scope unavailable. Existing authorship and repository metrics retain their own source scope.'
            : activityAllVisible
            ? 'Public + private aggregates visible to the token, including organizations and external repositories.'
            : 'Public aggregates, including organizations and external repositories. GitHub eligibility rules apply.',
        10, palette.muted);
    } else if (empty) {
        body = text(32, 285, 'Waiting for the first successful source snapshot.', 16)
            + text(32, 311, 'Existing saved data will appear here whenever a source is temporarily unavailable.', 12, palette.muted);
    } else {
        body = text(32, 258, 'LANGUAGE', 10, palette.muted, 'letter-spacing="1.1"')
            + text(225, 258, 'GITHUB · CODE BYTES', 10, palette.code, 'letter-spacing="1"')
            + text(558, 258, timeRangeLabel(snapshot).toUpperCase(), 10, palette.time, 'letter-spacing="1"');
        body += rows.map((row, index) => {
            const y = 289 + index * 39;
            const name = row.name.length > 23 ? row.name.slice(0, 22) + '…' : row.name;
            const timeWidth = Math.min(100, row.timePercent) * 2.10;
            const codeWidth = Math.min(100, row.codePercent ?? 0) * 2.49;
            return `<g><title>${xml(row.name)}: WakaTime ${row.timePercent.toFixed(2)}%; `
                + `GitHub ${row.codePercent === null ? 'not comparable' : row.codePercent.toFixed(2) + '%'}</title>`
                + `<svg data-language-icon="${xml(row.name)}" x="32" y="${y - 10}" `
                + `width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" `
                + `fill="${row.color}"><path fill-rule="${row.name === 'SQL' ? 'evenodd' : 'nonzero'}" `
                + `d="${xml(languageIcon(row.name, LANGUAGE_ICONS))}"/></svg>`
                + text(64, y, name, 13, palette.fg, 'font-weight="500"')
                + text(64, y + 14, `${codeSize(row.codeBytes)} · `
                    + (waka ? duration(row.seconds) : '—'), 10, palette.muted)
                + `<rect x="225" y="${y - 10}" width="249" height="7" rx="3.5" fill="${palette.track}"/>`
                + `<rect x="225" y="${y - 10}" width="${codeWidth.toFixed(2)}" height="7" rx="3.5" fill="${palette.code}"/>`
                + text(523, y, row.codePercent === null ? '—' : `${row.codePercent.toFixed(1)}%`, 11, palette.code, 'text-anchor="end"')
                + `<rect x="558" y="${y - 10}" width="210" height="7" rx="3.5" fill="${palette.track}"/>`
                + `<rect x="558" y="${y - 10}" width="${timeWidth.toFixed(2)}" height="7" rx="3.5" fill="${palette.time}"/>`
                + text(841, y, waka ? `${row.timePercent.toFixed(1)}%` : '—', 11, palette.time, 'text-anchor="end"')
                + '</g>';
        }).join('');
    }
    const rangeEnd = waka?.end ? ` · through ${waka.end.slice(0, 10)}`
        : waka?.rangeLabel ? ` · ${waka.rangeLabel}` : '';
    const through = waka && !waka.includesToday ? ' · today excluded by source' : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="880" height="${height}" `
        + `viewBox="0 0 880 ${height}" role="img" aria-labelledby="title desc">`
        + `<title id="title">${xml(title)}</title>`
        + '<desc id="desc">WakaTime time shares and GitHub repository language byte shares have separate denominators. '
        + xml(`${sourceLine('GitHub', snapshot.github)}. ${sourceLine('WakaTime', snapshot.wakatime)}.`)
        + xml(` WakaTime ${RANGE_LABELS[snapshot.range].toLowerCase()}${rangeEnd}${through}. `
            + 'Time share and code share have separate denominators. '
            + 'GitHub counts repository bytes, not individual authorship.')
        + xml(` ${sourceLine('GitHub activity', activitySource)}. `)
        + (activity ? xml(`Activity scope: ${githubActivity?.scope ?? 'unavailable'}. `
            + `Repository byte scope: ${github?.scope ?? 'unavailable'}. `
            + 'Private repository names are never included. '
            + ACTIVITY_METRICS.map((metric) => `${metric.label}: ${metric.definition}`).join(' ')) : '')
        + '</desc><style>' + transparentStyles
        + 'text{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif}'
        + '.numeric{font-variant-numeric:tabular-nums}</style>'
        + `<rect x=".5" y=".5" width="879" height="${height - 1}" rx="22" `
        + `fill="${transparent ? 'none' : palette.bg}" stroke="${palette.line}"/>`
        + '<g transform="translate(0 -20)">'
        + (options.header === false ? '' : profileHeader)
        + metricMarkup
        + `<path d="M32 ${217 + contentOffset}H848" stroke="${palette.line}"/>`
        + `<g transform="translate(0 ${contentOffset})">${body}</g>`
        + `<path d="M32 ${footerY}H848" stroke="${palette.line}"/>`
        + `<g data-refresh-times="true"><svg x="32" y="${footerY + 18}" width="14" height="14" `
        + `viewBox="0 0 16 16" fill="${palette.muted}" aria-hidden="true"><path d="${CLOCK_ICON}"/></svg>`
        + text(52, footerY + 29, `GitHub: ${refreshAge(snapshot.github.lastSuccessAt, snapshot.generatedAt)} | `
            + `WakaTime: ${refreshAge(snapshot.wakatime.lastSuccessAt, snapshot.generatedAt)}`, 10, palette.muted)
        + '</g><a data-project-credit="true" href="https://github.com/Leask/CodeStats" '
        + 'target="_blank" rel="noopener noreferrer">'
        + `<svg x="638" y="${footerY + 18}" width="14" height="14" viewBox="0 0 16 16" `
        + `fill="${palette.muted}" aria-hidden="true"><path d="${GITHUB_ICON}"/></svg>`
        + `<text x="848" y="${footerY + 29}" font-size="10" `
        + `fill="${palette.muted}" text-anchor="end">Power by github.com/Leask/`
        + `<tspan fill="${palette.time}" font-weight="650">CodeStats</tspan></text>`
        + '</a></g>'
        + '</svg>';
}

/** Card builder; no remote scripts, fonts, or fake sample data. */
export function renderPage(defaultRange: Range = 'all_time'): string {
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
.layout{display:grid;grid-template-columns:228px minmax(0,1fr);gap:28px;align-items:start}
aside{position:sticky;top:24px}.config,.source-panel{border:1px solid var(--line);border-radius:12px;background:var(--panel)}
.config{padding:20px}.section-title{font-size:10px;letter-spacing:1.5px;color:var(--muted);
text-transform:uppercase;font-weight:650;margin:0 0 19px}.control{margin:0 0 18px}
label{display:block;color:#c8d2df;font-size:12px;margin-bottom:7px}select,input[type=url]{width:100%;
border:1px solid #354252;border-radius:6px;background:#101720;color:var(--text);padding:9px 10px}
.source-panel{padding:19px;margin-top:16px}.source-state{padding:0 0 15px;margin:0 0 15px;border-bottom:1px solid var(--line)}
.source-state:last-child{padding:0;margin:0;border:0}.source-head{display:flex;justify-content:space-between;gap:8px;
font-size:12px}.badge{font-size:9px;letter-spacing:.5px;text-transform:uppercase;color:var(--green)}
.badge.stale,.badge.unavailable{color:#e2b570}.source-state small{color:var(--muted);display:block;font-size:10px;
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
.activity-tables{grid-template-columns:1fr}.source-panel{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="shell">
<nav><div class="brand"><span class="mark" aria-hidden="true"><i></i><i></i><i></i></span>CodeStats</div>
<span class="local" id="environment">CARD BUILDER</span></nav>
<header class="hero"><div><div class="eyebrow">The unified developer card</div><h1>Build your card.</h1>
<p>Your coding hours and GitHub languages, side by side.<br>Choose the appearance, then copy your README Markdown.</p></div>
<div class="identity"><strong id="identity">Loading profile</strong><small>WakaTime × GitHub</small></div></header>
<div class="layout">
<aside>
<form class="config" id="controls"><h2 class="section-title">Shape your card</h2>
<div class="control"><label for="range">Time range</label><select id="range"><option value="all_time">All time</option>
<option value="last_7_days">Last 7 days</option><option value="last_30_days">Last 30 days</option></select></div>
<div class="control"><label for="theme">Appearance</label><select id="theme"><option value="transparent">Transparent</option>
<option value="dark">Midnight</option><option value="light">Paper</option></select></div>
<div class="control"><label for="header">Profile header</label><select id="header">
<option value="true">Show</option><option value="false">Hide</option></select></div>
<div class="control"><label for="view">View</label><select id="view"><option value="overview">Overview</option>
<option value="languages">Language detail</option><option value="activity">GitHub activity</option></select></div>
<div class="control"><label for="sort">Language order</label><select id="sort"><option value="time">Coding time first</option>
<option value="alternating">Selection order</option>
<option value="code">GitHub code first</option><option value="name">Alphabetical</option></select></div>
</form>
<section class="source-panel"><h2 class="section-title">Two upstream services</h2><p class="detail-note">GitHub has two cached datasets; WakaTime has one.</p>
<div class="source-state"><div class="source-head"><span>GitHub · repositories</span><span class="badge" id="github-status">Loading</span></div>
<small id="github-time">Waiting for source</small><small id="github-error"></small></div>
<div class="source-state"><div class="source-head"><span>GitHub · activity</span><span class="badge" id="githubActivity-status">Loading</span></div>
<small id="githubActivity-time">Waiting for source</small><small id="githubActivity-error"></small></div>
<div class="source-state"><div class="source-head"><span>WakaTime</span><span class="badge" id="wakatime-status">Loading</span></div>
<small id="wakatime-time">Waiting for source</small><small id="wakatime-error"></small></div></section>
</aside>
<main>
<div class="preview-label"><span>README card</span><a id="json-link" href="/api/stats?range=all_time" target="_blank" rel="noopener">View source JSON ↗</a></div>
<div class="card-stage" id="stage"><div class="loading" id="loading">Fetching your first snapshot<span>Connecting GitHub and WakaTime.</span></div>
<img id="card" alt="Unified WakaTime and GitHub profile statistics" hidden></div>
<p class="note" id="range-note">WakaTime measures tracked coding time. GitHub measures current repository language bytes, not personally authored lines.</p>
<details id="language-details"><summary>Language breakdown <small id="language-count">Waiting for data</small></summary>
<div class="detail-body"><p class="detail-note">Related languages are summed first. Nine groups are selected by alternating GitHub and WakaTime ranks, starting with GitHub, then ordered by coding time by default. Others includes every remaining group and unclassified time. Both source totals are fully represented, with separate denominators. Raw values remain in the source JSON. A dash means unavailable data.</p>
<div class="table-wrap"><table><thead><tr><th>Language</th><th>Code share</th><th>Time</th><th>Time share</th></tr></thead>
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
<details id="readme-details" open><summary>Add to your GitHub README <small>Copy and paste</small></summary>
<div class="detail-body"><label for="public-url">Public HTTPS URL</label>
<input id="public-url" type="url" value="https://stats.example.com" aria-describedby="url-note">
<p><label><input id="include-details" type="checkbox"> Include expandable language and activity cards</label></p>
<div class="snippet-head"><p id="url-note">Replace this after deployment. Localhost images cannot load on GitHub.</p>
<button class="button" id="copy" type="button">Copy Markdown</button></div><pre id="snippet"></pre></div></details>
<section class="explain"><div><b>Two honest percentages</b><p>Time share is WakaTime's tracked activity, including Other. Code share is GitHub's language bytes. Neither is an individual authorship or skill score.</p></div>
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
        view: 'overview', sort: 'time', limit: '10' };
    const query = new URLSearchParams(location.search);
    for (const id of controls) {
        const value = query.get(id) || defaults[id];
        if (Array.from($(id).options).some(option => option.value === value)) {
            $(id).value = value;
        }
    }
    let snapshot = null;
    let generation = 0;
    const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
    const aliases = ${JSON.stringify(ALIASES)};
    const groupNames = ${JSON.stringify(GROUP_NAMES)};
    const alternateRanks = ${alternateRanks.toString()};
    const selectLanguages = ${selectLanguages.toString()};
    const displayLanguages = ${displayLanguages.toString()};
    const languageIcons = ${JSON.stringify(LANGUAGE_ICONS)};
    const languageIcon = ${languageIcon.toString()};
    const colors = ${JSON.stringify(COLORS)};
    const activityMetrics = ${JSON.stringify(ACTIVITY_METRICS)};
    const activityPeriods = ${JSON.stringify(ACTIVITY_PERIODS)};
    const activitySource = () => snapshot.githubActivity || {
        data: null, status: 'unavailable', lastSuccessAt: null, lastError: null,
    };
    const count = (value) => Number.isFinite(value) && value >= 0 ? fmt.format(value) : '—';
    const day = (value) => value && !isNaN(Date.parse(value))
        ? new Date(value).toISOString().slice(0, 10) : 'date unavailable';
    const normalize = (name) => aliases[name.trim().toLowerCase()] || name.trim().toLowerCase();
    const safeColor = (color, name) => groupNames[normalize(name)] && colors[normalize(name)]
        ? colors[normalize(name)] : /^#[0-9a-f]{6}$/i.test(color || '')
        ? color : colors[normalize(name)] || '#9ebcf0';
    const duration = (seconds) => fmt.format(Math.floor(seconds / 3600)) + 'h ' + Math.floor(seconds / 60) % 60 + 'm';
    const percentage = (value) => value === null ? '—' : value.toFixed(2) + '%';
    const date = (value) => value && !isNaN(Date.parse(value)) ? new Date(value).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'No successful snapshot yet';
    const params = (theme, view) => new URLSearchParams({
        range: $('range').value,
        theme: theme || $('theme').value,
        header: $('header').value,
        view: view || $('view').value,
        limit: '10',
        sort: $('sort').value,
    });
    const tableRows = () => {
        if (!snapshot) return [];
        const github = snapshot.github.data;
        const code = new Map();
        for (const item of github ? github.languages : []) {
            const key = normalize(item.name);
            const old = code.get(key);
            code.set(key, { name: groupNames[key] || item.name, bytes: item.bytes + (old ? old.bytes : 0), color: item.color });
        }
        const rows = new Map();
        const totalSeconds = snapshot.wakatime.data ? snapshot.wakatime.data.totalSeconds : 0;
        for (const item of snapshot.wakatime.data ? snapshot.wakatime.data.languages : []) {
            const key = normalize(item.name);
            const match = key === 'other' ? null : code.get(key);
            const previous = rows.get(key);
            rows.set(key, { name: groupNames[key] || (previous ? previous.name : item.name),
                seconds: item.seconds + (previous ? previous.seconds : 0),
                timePercent: (totalSeconds > 0 ? 100 * item.seconds / totalSeconds : 0)
                    + (previous ? previous.timePercent : 0),
                codeBytes: github && key !== 'other' ? (match ? match.bytes : 0) : null,
                codePercent: github && key !== 'other' ? (github.totalBytes ? (match ? match.bytes : 0) / github.totalBytes * 100 : 0) : null,
                color: safeColor(match ? match.color : null, item.name) });
        }
        for (const [key, item] of code) {
            if (!rows.has(key) && key !== 'other') rows.set(key, { name: item.name, seconds: 0,
                timePercent: 0, codeBytes: item.bytes, codePercent: github.totalBytes ? item.bytes / github.totalBytes * 100 : 0, color: safeColor(item.color, item.name) });
        }
        const values = Array.from(rows.values());
        return displayLanguages(
            selectLanguages(values, $('sort').value, 10, github !== null), 2,
        );
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
            for (const value of [percentage(row.codePercent),
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
            + '. Authorship and repository metrics use the separate GitHub source timestamp.';
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
        image.src = '/card.svg?' + params();
        image.hidden = false;
        $('json-link').href = '/api/stats?range=' + encodeURIComponent($('range').value);
        updateTable(); updateSnippet();
    }
    function updateSources() {
        for (const name of ['github', 'githubActivity', 'wakatime']) {
            const source = name === 'githubActivity' ? activitySource() : snapshot[name];
            $(name + '-status').textContent = source.status;
            $(name + '-status').className = 'badge ' + source.status;
            $(name + '-time').textContent = date(source.lastSuccessAt);
            $(name + '-error').textContent = source.lastError || '';
        }
        const github = snapshot.github.data;
        const waka = snapshot.wakatime.data;
        $('identity').textContent = '@' + (github ? github.username : waka ? waka.username : 'profile');
        const all = github && github.visibility === 'all';
        let note = 'WakaTime time share includes Other. GitHub language share uses current repository bytes.';
        if (github && github.collectionVersion >= 4) {
            note += all ? ' Public + private repositories in the configured scope.'
                : ' Public repositories in the configured scope.';
            note += github.includeForks ? ' Forks included.' : ' Forks excluded.';
        }
        if (github && github.collectionVersion >= 5) {
            note += ' Stars count owned repositories only.';
        }
        if (waka && waka.end) note += ' WakaTime through ' + waka.end.slice(0, 10) + '.';
        else if (waka && waka.rangeLabel) note += ' WakaTime: ' + waka.rangeLabel + '.';
        if (waka && !waka.includesToday) note += ' Today is excluded by the source.';
        if (!waka) note += ' This WakaTime range is unavailable; no other range is substituted.';
        const staleSources = [snapshot.github, snapshot.wakatime].filter((source) => source.status === 'stale');
        if (staleSources.some((source) => source.lastError)) note += ' Saved data remains visible after an unsuccessful source refresh.';
        else if (staleSources.length) note += ' Saved data remains visible while a refresh is due.';
        $('range-note').textContent = note;
        $('footer-scope').textContent = all || activitySource().data && activitySource().data.visibility === 'all'
            ? 'Public + private aggregates. Independently refreshed.' : 'Public aggregates. Independently refreshed.';
        updateActivity();
    }
    async function load() {
        const current = ++generation;
        $('loading').hidden = false;
        $('loading').classList.remove('error');
        $('loading').replaceChildren(document.createTextNode('Loading your snapshot…'));
        let data;
        try {
            const response = await fetch('/api/stats?range=' + encodeURIComponent($('range').value));
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
    for (const id of controls) $(id).addEventListener('change', () => id === 'range' ? load() : updateCard());
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
