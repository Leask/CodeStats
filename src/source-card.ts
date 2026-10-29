import type {
    AIUsageData, CardOptions, GitHubData, LanguageRow, SourceSnapshot,
    StatsSnapshot,
} from './types';
import { CLOCK_ICON, GITHUB_ICON, METRIC_ICONS } from './ui-icons';
import { PROVIDER_ICONS } from './provider-icons';
import { LANGUAGE_ICONS, languageIcon } from './language-icons';
import { PRIMARY_SOURCES } from './profile';
import type { PrimarySource } from './profile';

type Provider = PrimarySource;
type UsageProvider = Exclude<Provider, 'github' | 'wakatime'>;
type DisplaySnapshot = StatsSnapshot & {
    selectedSources?: Provider[];
    profile?: {
        mode: 'configured' | 'public';
        accounts: { github?: string; wakatime?: string; codex?: string };
    };
};
type DisplayGitHub = GitHubData & { languageCoverage?: string };
interface Context {
    rows: LanguageRow[];
    codeScale: number | null;
    timeScale: number | null;
}
interface Metric {
    key: string;
    label: string;
    value: string;
    exact?: string;
    icon?: string;
}

const PROVIDERS: readonly Provider[] = PRIMARY_SOURCES;
const LABELS: Record<Provider, string> = {
    github: 'GitHub', wakatime: 'WakaTime', codex: 'Codex', openrouter: 'OpenRouter',
    anthropic: 'Anthropic API',
};
const LIGHT = {
    bg: '#ffffff', fg: '#17222e', muted: '#667588', line: '#e3e8ee',
    track: '#edf1f5', time: '#138768', code: '#4979c9', panel: '#f8fafc',
};
const DARK = {
    bg: '#121920', fg: '#eef3f8', muted: '#97a8ba', line: '#2b3743',
    track: '#25313e', time: '#9de6c4', code: '#86acfa', panel: '#18222d',
};

function xml(value: unknown): string {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;',
        '"': '&quot;', "'": '&apos;',
    })[char]!);
}

function valid(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function count(value: unknown, compact = false): string {
    if (!valid(value)) return '—';
    const result = Math.round(value).toLocaleString('en-US');
    return compact || result.length > 8
        ? new Intl.NumberFormat('en-US', {
            notation: 'compact', maximumFractionDigits: 1,
        }).format(value) : result;
}

function duration(value: unknown): string {
    if (!valid(value)) return '—';
    const minutes = Math.round(value / 60);
    const hours = Math.floor(minutes / 60);
    return hours ? count(hours) + 'h' + (minutes % 60 ? minutes % 60 + 'm' : '')
        : minutes + 'm';
}

function clip(value: string, maximum = 60): string {
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

function age(at: string | null | undefined, now: string): string {
    const difference = Date.parse(now) - Date.parse(at ?? '');
    if (!Number.isFinite(difference)) return 'not refreshed';
    const minutes = Math.max(0, Math.floor(difference / 60_000));
    if (!minutes) return 'just now';
    const hours = Math.floor(minutes / 60);
    return (hours ? hours + 'h' : '')
        + (hours && minutes % 60 ? ' ' : '')
        + (minutes % 60 ? minutes % 60 + 'm' : '') + ' ago';
}

function bytes(value: number | null): string {
    if (!valid(value)) return '—';
    const exponent = Math.min(4, Math.floor(Math.log10(Math.max(1, value)) / 3));
    return Number((value / 1000 ** exponent).toFixed(1))
        + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][exponent];
}

function period(provider: Provider, data: AIUsageData | null): string {
    return provider === 'codex' && data?.period === 'Lifetime tokens'
        ? 'Lifetime' : data?.period ?? 'Unavailable';
}

function usageMetrics(provider: UsageProvider, data: AIUsageData | null): Metric[] {
    const summary = data?.summary;
    const tokens = (key: string, label: string, value: unknown): Metric => ({
        key, label, value: count(value, true),
        exact: valid(value) ? Math.round(value).toLocaleString('en-US')
            + ' tokens' : 'unavailable',
    });
    const days = (key: string, label: string, value: unknown): Metric => ({
        key, label, value: valid(value) ? count(value) + ' days' : '—',
    });
    const total = tokens('totalTokens', 'Total tokens', data?.totalTokens);
    if (provider === 'anthropic') return [total];
    return provider === 'codex' ? [
        total, tokens('peakDailyTokens', 'Peak tokens', summary?.peakDailyTokens),
        { key: 'longestRunningTurnSec', label: 'Longest task',
            value: duration(summary?.longestRunningTurnSec),
            exact: valid(summary?.longestRunningTurnSec)
                ? Math.round(summary.longestRunningTurnSec).toLocaleString('en-US')
                    + ' seconds' : 'unavailable' },
        days('longestStreakDays', 'Longest streak', summary?.longestStreakDays),
        days('currentStreakDays', 'Current streak', summary?.currentStreakDays),
    ] : [
        total, tokens('averageDailyTokens', 'Tokens/day', summary?.averageDailyTokens),
        tokens('averageWeeklyTokens', 'Tokens/week', summary?.averageWeeklyTokens),
        { key: 'totalPrompts', label: 'Total prompts', value: count(data?.totalPrompts, true),
            exact: valid(data?.totalPrompts)
                ? Math.round(data.totalPrompts).toLocaleString('en-US') + ' requests'
                : 'unavailable' },
        days('longestStreakDays', 'Longest streak', summary?.longestStreakDays),
    ];
}

/** Provider-only and partial cards never read identities from hidden services. */
export function renderSourceCard(
    snapshot: StatsSnapshot, options: CardOptions, context: Context,
): string {
    const input: DisplaySnapshot = snapshot;
    const view: string = options.view;
    const requested = PROVIDERS.find(provider => provider === view);
    const selected = requested ? [requested] : input.selectedSources ?? [
        'github', 'wakatime',
        ...(['codex', 'openrouter', 'anthropic'] as const)
            .filter(provider => snapshot.aiUsage?.[provider]),
    ];
    const active = PROVIDERS.filter(provider => selected.includes(provider));
    const publicMode = input.profile?.mode === 'public';
    const github: DisplayGitHub | null = active.includes('github') ? snapshot.github.data : null;
    const activity = active.includes('github') ? snapshot.githubActivity?.data : null;
    const waka = active.includes('wakatime') ? snapshot.wakatime.data : null;
    const githubTimes = [snapshot.github.lastSuccessAt,
        ...(activity ? [snapshot.githubActivity?.lastSuccessAt] : [])]
        .filter((value): value is string => !!value && Number.isFinite(Date.parse(value)));
    const githubAt = githubTimes.length ? githubTimes.reduce((oldest, value) =>
        Date.parse(value) < Date.parse(oldest) ? value : oldest) : null;
    const githubStatus = snapshot.github.status === 'stale'
        || (activity && snapshot.githubActivity?.status === 'stale')
        ? 'stale' : snapshot.github.status;
    const colors = options.theme === 'light' ? LIGHT : DARK;
    const transparent = options.theme === 'transparent';
    const palette = transparent ? Object.fromEntries(Object.keys(DARK)
        .map(key => [key, `var(--${key})`])) as typeof DARK : colors;
    const variables = (values: typeof DARK) => Object.entries(values)
        .map(([key, value]) => `--${key}:${value}`).join(';');
    const css = transparent ? `:root{${variables(LIGHT)}}`
        + `@media(prefers-color-scheme:dark){:root{${variables(DARK)}}}` : '';
    const text = (x: number, y: number, value: unknown, size = 11,
        fill = palette.fg, extra = '') => `<text x="${x}" y="${y}" `
        + `font-size="${size}" fill="${fill}" ${extra}>${xml(value)}</text>`;
    const icon = (provider: Provider, x: number, y: number, size = 16) => {
        const path = provider === 'github' ? GITHUB_ICON
            : provider === 'wakatime' ? CLOCK_ICON : PROVIDER_ICONS[provider];
        const box = provider === 'github' || provider === 'wakatime' ? 16 : 24;
        return `<svg data-provider-icon="${provider}" x="${x}" y="${y}" `
            + `width="${size}" height="${size}" viewBox="0 0 ${box} ${box}" `
            + `fill="${palette.muted}" fill-rule="evenodd" aria-hidden="true">`
            + `<path d="${path}"/></svg>`;
    };
    const usageSource = (provider: UsageProvider): SourceSnapshot<AIUsageData> => {
        const source = snapshot.aiUsage?.[provider];
        if (publicMode || !source) return {
            data: null, lastSuccessAt: null, lastAttemptAt: null, retryAt: null,
            status: 'unavailable', lastError: publicMode
                ? provider === 'codex'
                    ? 'Public Codex profiles require sign-in to display usage statistics.'
                    : provider === 'openrouter'
                    ? 'OpenRouter usage requires an account-specific Management key.'
                    : 'Anthropic API usage requires an organization Admin key.'
                : `${LABELS[provider]} usage is not enabled for this profile.`,
        };
        return source;
    };
    const account = (provider: Provider): string => provider === 'github'
        ? github?.username ?? input.profile?.accounts.github ?? ''
        : provider === 'wakatime' ? waka?.username ?? input.profile?.accounts.wakatime ?? ''
        : provider === 'codex' ? input.profile?.accounts.codex ?? '' : '';
    const identity = active.find(provider => account(provider)) ?? active[0];
    const heading = identity === 'github' ? github?.name || account(identity) || 'GitHub'
        : identity && account(identity) ? '@' + account(identity)
        : active.length === 1 ? LABELS[active[0]]
        : active.length ? 'Developer activity' : 'CodeStats';
    let cursor = 32;
    let body = '';
    if (options.header !== false && active.length) {
        const avatar = identity === 'github' ? github?.avatarDataUri : null;
        const embedded = typeof avatar === 'string' && avatar.length <= 250_000
            && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(avatar);
        body += '<g data-source-header="true"><title>' + xml(heading) + '</title>';
        if (embedded) body += '<defs><clipPath id="source-avatar-clip">'
            + '<circle cx="67.5" cy="67.5" r="34"/></clipPath></defs>'
            + `<image x="33.5" y="33.5" width="68" height="68" href="${xml(avatar)}" `
            + 'clip-path="url(#source-avatar-clip)" preserveAspectRatio="xMidYMid slice"/>'
            + `<circle cx="67.5" cy="67.5" r="34" stroke="${palette.time}" `
            + 'stroke-width="3" fill="none"/>';
        else if (identity) body += icon(identity, 32, 32, 60);
        const x = embedded ? 116 : 108;
        body += text(x, 65, clip(heading, 24), 27, palette.fg, 'font-weight="650"')
            + text(x, 88, clip(active.map(provider => LABELS[provider]
                + (account(provider) ? ' · @' + account(provider) : '')).join(' | '), 62),
            11, palette.muted) + '</g>';
        cursor = 120;
    }
    const sectionTitle = (provider: Provider, detail = '') => {
        const id = account(provider);
        return icon(provider, 32, cursor, 16)
            + text(54, cursor + 13, LABELS[provider] + (id ? ' · @' + clip(id, 24) : ''),
                13, palette.fg, 'font-weight="500"')
            + (detail ? text(848, cursor + 13, clip(detail, 40), 11, palette.muted,
                'text-anchor="end"') : '');
    };
    const message = (value: string) => {
        body += text(32, cursor + 41, clip(value, 70), 11, palette.muted);
        cursor += 66;
    };
    const grid = (metrics: Metric[], columns: number, headingGap = 0) => {
        const top = cursor + 31 + headingGap;
        const width = 816 / columns;
        body += metrics.map((metric, index) => {
            const x = 32 + (index % columns) * width;
            const y = top + Math.floor(index / columns) * 64;
            const center = metric.icon ? x + 48 : x + width / 2;
            const anchor = metric.icon ? '' : 'text-anchor="middle"';
            return `<g data-source-metric="${metric.key}"><title>`
                + xml(`${metric.label}: ${metric.exact ?? metric.value}`) + '</title>'
                + (metric.icon ? `<svg x="${x}" y="${y + 2}" width="38" height="38" `
                    + `viewBox="0 0 16 16" fill="${palette.muted}" aria-hidden="true">`
                    + `<path d="${METRIC_ICONS[metric.icon]}"/></svg>` : '')
                + text(center, y + 21, metric.value, 27, palette.fg,
                    anchor + ' font-weight="650"')
                + text(center, y + 44, metric.label, 11, palette.muted, anchor)
                + '</g>';
        }).join('');
        cursor = top + Math.ceil(metrics.length / columns) * 64 + 2;
    };
    const divider = () => {
        body += `<path d="M32 ${cursor}H848" stroke="${palette.line}"/>`;
        cursor += 20;
    };
    for (const provider of active.filter(value => value === 'github' || value === 'wakatime')) {
        const source = provider === 'github' ? snapshot.github : snapshot.wakatime;
        const status = provider === 'github' ? githubStatus : source.status;
        const range = provider === 'wakatime' && waka
            ? ({ all_time: 'All time', last_7_days: 'Last 7 days',
                last_30_days: 'Last 30 days', last_year: 'Last year' }[waka.range]
                ?? waka.rangeLabel ?? waka.range) : '';
        const detail = range ? range + (status === 'stale' ? ' · saved data' : '')
            : status === 'stale' ? 'Saved data' : status;
        body += `<g data-source-section="${provider}" data-source-status="${status}">`
            + sectionTitle(provider, detail);
        if (provider === 'github' && github) grid([
            { key: 'repositories', label: 'REPOSITORIES', icon: 'repositories',
                value: count(github.visibility === 'all' ? github.repositories : github.publicRepositories) },
            { key: 'commits', label: 'COMMITS', icon: 'commits-indexed', value: count(activity?.commits) },
            { key: 'calendar', label: 'CALENDAR CONTRIBS.', icon: 'calendar-contributions',
                value: count(activity?.allTimeContributions) },
            { key: 'pullRequests', label: 'PULL REQUESTS', icon: 'pull-requests', value: count(github.pullRequests) },
            { key: 'issues', label: 'ISSUES', icon: 'issues', value: count(github.issues) },
            { key: 'followers', label: 'FOLLOWERS', icon: 'followers', value: count(github.followers) },
            { key: 'stars', label: 'STARS RECEIVED', icon: 'stars', value: count(github.stars) },
        ], 4);
        else if (provider === 'wakatime' && waka) grid([
            { key: 'codingHours', label: 'CODING HOURS', value: count(Math.floor(waka.totalSeconds / 3600)) },
            { key: 'dailyAverage', label: 'DAILY AVERAGE', value: duration(waka.dailyAverageSeconds) },
            { key: 'languages', label: 'LANGUAGES', value: count(waka.languages
                .filter(row => !/^others?$/i.test(row.name)).length) },
        ], 3);
        else message(source.lastError || `${LABELS[provider]} has no successful snapshot yet.`);
        body += '</g>';
        divider();
    }
    const hasCode = !!github && valid(github.totalBytes)
        && github.languageCoverage !== 'unavailable';
    const hasTime = !!waka;
    if (active.includes('github') && github && !hasCode) {
        body += '<g data-language-unavailable="github">';
        body += text(32, cursor + 11, publicMode
            ? 'Public GitHub profile mode does not include repository language bytes.'
            : 'GitHub language bytes are unavailable for this snapshot.', 11, palette.muted);
        cursor += 35;
        body += '</g>';
    }
    const rows = context.rows.slice(0, 100);
    if ((hasCode || hasTime) && rows.length) {
        const both = hasCode && hasTime;
        const columns = [
            ...(hasCode ? [{ key: 'code', label: 'GITHUB · CODE BYTES', x: both ? 225 : 300,
                end: both ? 523 : 848, scale: context.codeScale,
                color: palette.code }] : []),
            ...(hasTime ? [{ key: 'time', label: 'WAKATIME · CODE TIME', x: both ? 558 : 300,
                end: 848, scale: context.timeScale,
                color: palette.time }] : []),
        ].map(column => ({ ...column, width: column.end - column.x }));
        body += '<g data-source-languages="true">'
            + text(32, cursor + 11, 'LANGUAGE', 11, palette.muted);
        for (const column of columns) body += text(column.x, cursor + 11,
            column.label + ' · SCALE ' + (column.scale === null ? '—' : column.scale + '%'),
            11, column.color, `data-language-scale="${column.key}"`);
        const top = cursor + 30;
        rows.forEach((row, index) => {
            const y = top + index * 44;
            const color = /^#[a-f\d]{3,8}$/i.test(row.color) ? row.color : palette.code;
            const repos = hasCode && valid(row.repositoryCount);
            body += `<g data-language-row="${xml(row.name)}">`
                + `<svg x="32" y="${y + 3}" width="24" height="24" viewBox="0 0 24 24" `
                + `fill="${color}" aria-hidden="true"><path d="${languageIcon(row.name, LANGUAGE_ICONS)}"/></svg>`
                + text(68, y + (repos ? 15 : 22), clip(row.name, both ? 11 : 16), 13);
            if (repos) body += text(68, y + 29, count(row.repositoryCount) + ' repos', 11, palette.muted);
            for (const column of columns) {
                const percent = column.key === 'code' ? row.codePercent : row.timePercent;
                const width = valid(percent) && column.scale
                    ? Math.max(0, Math.min(1, percent / column.scale)) * column.width : 0;
                body += `<rect x="${column.x}" y="${y + 4}" width="${column.width}" height="7" `
                    + `rx="3.5" fill="${palette.track}"/>`
                    + `<rect data-${column.key}-bar="true" x="${column.x}" y="${y + 4}" `
                    + `width="${width.toFixed(2)}" height="7" rx="3.5" fill="${column.color}"/>`
                    + text(column.end, y + 29, valid(percent) ? percent.toFixed(1) + '%' : '—',
                        11, column.color, `text-anchor="end" data-${column.key}-percent="true"`)
                    + text(column.x, y + 29, column.key === 'code' ? bytes(row.codeBytes)
                        : duration(row.seconds), 11, palette.muted,
                    `data-${column.key}-value="true"`);
            }
            body += '</g>';
        });
        cursor = top + rows.length * 44 + 6;
        body += '</g>';
        divider();
    }
    for (const provider of active.filter((value): value is UsageProvider =>
        value === 'codex' || value === 'openrouter' || value === 'anthropic')) {
        const source = usageSource(provider);
        body += `<g data-source-section="${provider}" data-usage-status="${source.status}">`
            + sectionTitle(provider, period(provider, source.data)
                + (source.status === 'stale' ? ' · saved data' : ''));
        if (source.data) {
            const metrics = usageMetrics(provider, source.data);
            grid(metrics, metrics.length, 8);
        } else message(source.lastError || 'No successful usage observation yet.');
        const id = account(provider);
        if (provider === 'codex' && /^[A-Za-z0-9._-]{1,64}$/.test(id)
            && /[A-Za-z0-9]/.test(id)) {
            body += `<a data-codex-profile="true" href="https://chatgpt.com/u/${encodeURIComponent(id)}" `
                + 'target="_blank" rel="noopener noreferrer">'
                + text(32, cursor - 8, 'View @' + clip(id, 24) + ' on ChatGPT ↗', 11, palette.time) + '</a>';
            cursor += 12;
        }
        body += '</g>';
        divider();
    }
    if (!active.length) {
        body += text(32, cursor + 11, 'Select a source to build your card.', 13);
        body += text(32, cursor + 34,
            'Choose GitHub, WakaTime, Codex, OpenRouter or Anthropic API in /build.', 11, palette.muted);
        cursor += 65;
    }
    const refresh = active.map(provider => {
        const at = provider === 'github' ? githubAt
            : provider === 'wakatime' ? snapshot.wakatime.lastSuccessAt
            : usageSource(provider).lastSuccessAt;
        return { provider, label: LABELS[provider] + ': ' + age(at, snapshot.generatedAt) };
    });
    const lines: typeof refresh[] = [[]];
    for (const entry of refresh) {
        const line = lines[lines.length - 1];
        if (line.length && line.map(item => item.label).join(' | ').length
            + entry.label.length > 85) lines.push([entry]);
        else line.push(entry);
    }
    const footer = cursor;
    body += '<g data-source-footer="true">';
    lines.forEach((line, index) => {
        if (!line.length) return;
        const y = footer + 11 + index * 20;
        body += `<svg x="32" y="${y - 11}" width="14" height="14" viewBox="0 0 16 16" `
            + `fill="${palette.muted}" aria-hidden="true"><path d="${CLOCK_ICON}"/></svg>`
            + '<g>' + line.map(entry => `<title data-refresh-source="${entry.provider}">`
                + xml(entry.label) + '</title>').join('')
            + text(52, y, line.map(entry => entry.label).join(' | '), 11, palette.muted) + '</g>';
    });
    body += '<g transform="translate(848 0)"><a data-project-credit="true" '
        + 'style="transform-box:fill-box;transform:translateX(-100%)" '
        + 'href="https://github.com/Leask/CodeStats" target="_blank" rel="noopener noreferrer">'
        + `<svg x="0" y="${footer}" width="14" height="14" viewBox="0 0 16 16" `
        + `fill="${palette.muted}" aria-hidden="true"><path d="${GITHUB_ICON}"/></svg>`
        + `<text x="20" y="${footer + 11}" font-size="11" fill="${palette.muted}">`
        + `Power by github.com/Leask/<tspan fill="${palette.time}" font-weight="650">CodeStats</tspan>`
        + '</text></a></g></g>';
    const height = footer + 14 + (lines.length - 1) * 20 + 32;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="880" height="${height}" `
        + `viewBox="0 0 880 ${height}" data-source-card="true" data-card-padding="32" `
        + `role="img" aria-labelledby="source-title source-desc">`
        + `<title id="source-title">${xml(heading)} · CodeStats</title>`
        + '<desc id="source-desc">Selected providers only. Missing values are unknown, not zero. '
        + 'Each language column uses its own full-source percentage and stated scale. '
        + 'AI periods and accounting remain separate.</desc>'
        + '<style>' + css
        + 'text{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif}'
        + '</style>'
        + `<rect x=".5" y=".5" width="879" height="${height - 1}" rx="22" `
        + `fill="${transparent ? 'none' : palette.bg}" stroke="${palette.line}"/>`
        + body + '</svg>';
}
