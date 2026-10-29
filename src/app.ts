import {
    displayLanguages, githubBytesAvailable, joinLanguages, renderCard, renderPage, selectLanguages,
} from './render';
import { RANGES } from './types';
import type { CardOptions, Range, Settings, StatsSnapshot } from './types';
import { CODEX_IMPORT_PATH, importCodexRequest } from './usage-import';
import { codexUsageEnabled, resolveProfile } from './profile';
import type { ProfileSelection } from './profile';
import type { ReadOptions } from './cache';

function rangeFrom(url: URL, env: Settings): Range {
    const value = url.searchParams.get('range')
        ?? (env.DEFAULT_RANGE?.trim() || 'all_time');
    if (!RANGES.includes(value as Range)) {
        throw new Error('Invalid range; use all_time, last_7_days or last_30_days.');
    }
    return value as Range;
}

function cardOptions(url: URL): CardOptions {
    const theme = url.searchParams.get('theme') ?? 'transparent';
    const view = url.searchParams.get('view') ?? 'overview';
    const sort = url.searchParams.get('sort') ?? 'code';
    const header = url.searchParams.get('header') ?? 'true';
    if (!['dark', 'light', 'transparent'].includes(theme)
        || !['overview', 'languages', 'activity', 'github', 'wakatime',
            'codex', 'openrouter', 'anthropic'].includes(view)
        || !['alternating', 'time', 'code', 'name'].includes(sort)) {
        throw new Error('Invalid theme, view or sort option.');
    }
    if (!['true', 'false'].includes(header)) {
        throw new Error('Header must be true or false.');
    }
    const requested = Number(url.searchParams.get('limit') ?? 10);
    if (!Number.isInteger(requested) || requested < 1 || requested > 100) {
        throw new Error('Limit must be an integer from 1 to 100.');
    }
    return {
        theme: theme as CardOptions['theme'],
        view: view as CardOptions['view'],
        sort: sort as CardOptions['sort'], limit: requested,
        header: header === 'true',
    };
}

/** Shared HTTP behavior for the Node and Worker adapters. */
export function createHandler<Config extends Settings>(
    readSnapshot: (env: Config, range: Range, selection: ProfileSelection,
        options: ReadOptions) => Promise<StatsSnapshot>,
    saveCodex?: (env: Config, payload: unknown) => Promise<void>,
) {
    return {
        async fetch(request: Request, env: Config): Promise<Response> {
            const url = new URL(request.url);
            if (url.pathname === CODEX_IMPORT_PATH && saveCodex) {
                if (url.search) {
                    return new Response('Codex imports target the configured account; '
                        + 'query selectors are not supported.', { status: 400 });
                }
                return importCodexRequest(request, env,
                    payload => saveCodex(env, payload));
            }
            if (!['GET', 'HEAD'].includes(request.method)) {
                return new Response('Method not allowed', {
                    status: 405, headers: { Allow: 'GET, HEAD' },
                });
            }
            let response: Response;
            if (['/build', '/build/'].includes(url.pathname)) {
                try { resolveProfile(url, env); }
                catch (error) {
                    return new Response((error as Error).message, { status: 400 });
                }
                const defaultRange = RANGES.includes(env.DEFAULT_RANGE as Range)
                    ? env.DEFAULT_RANGE as Range : 'all_time';
                response = new Response(renderPage(defaultRange), {
                    headers: {
                        'Content-Type': 'text/html; charset=utf-8',
                        'Cache-Control': 'no-store',
                        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; "
                            + "style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
                            + "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
                    },
                });
            } else if (url.pathname === '/health') {
                response = Response.json({
                    service: 'CodeStats', runtime: 'ready',
                    configuration: {
                        githubTokenConfigured: Boolean(env.GITHUB_TOKEN?.trim()),
                        wakatimeTokenConfigured: Boolean(env.WAKATIME_TOKEN?.trim()),
                        codexUsageEnabled: codexUsageEnabled(env),
                        openrouterTokenConfigured: Boolean(env.OPENROUTER_API_KEY?.trim()),
                        anthropicTokenConfigured: Boolean(env.ANTHROPIC_ADMIN_KEY?.trim()),
                    },
                }, { headers: { 'Cache-Control': 'no-store' } });
            } else if (url.pathname === '/favicon.svg') {
                response = new Response(
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
                    + '<rect width="32" height="32" rx="7" fill="#121920"/>'
                    + '<path d="M8 23V13m8 10V7m8 16V10" stroke="#9de6c4" '
                    + 'stroke-width="4" stroke-linecap="round"/></svg>',
                    { headers: { 'Content-Type': 'image/svg+xml',
                        'Cache-Control': 'public, max-age=86400' } },
                );
            } else if (['/', '/api/stats', '/card.svg'].includes(url.pathname)) {
                let range: Range;
                let options: CardOptions;
                let selection: ProfileSelection;
                try {
                    range = rangeFrom(url, env);
                    options = cardOptions(url);
                    selection = resolveProfile(url, env);
                } catch (error) {
                    return new Response((error as Error).message, { status: 400 });
                }
                let data: StatsSnapshot;
                try {
                    data = await readSnapshot(env, range, selection, {
                        sources: selection.mode === 'public' || url.searchParams.has('sources')
                            ? selection.sources : undefined,
                    });
                    const selected = new Set<string>(selection.sources);
                    const disabled = () => ({ data: null, lastSuccessAt: null,
                        lastAttemptAt: null, lastError: null, retryAt: null,
                        status: 'unavailable' as const, enabled: false });
                    const aiUsage = Object.fromEntries(Object.entries(data.aiUsage ?? {})
                        .filter(([service]) => selected.has(service)));
                    data = { ...data,
                        github: selected.has('github') ? data.github : disabled(),
                        githubActivity: selected.has('github') ? data.githubActivity : undefined,
                        wakatime: selected.has('wakatime') ? data.wakatime : disabled(),
                        aiUsage: Object.keys(aiUsage).length ? aiUsage : undefined,
                        selectedSources: [...selection.sources],
                        profile: { mode: selection.mode, accounts: {
                            ...selection.accounts,
                            ...(selection.mode === 'configured' && !selection.accounts.wakatime
                                && data.wakatime.data?.username
                                ? { wakatime: data.wakatime.data.username } : {}),
                        } },
                    };
                    if (selection.mode === 'public') {
                        const unavailable = (message: string) => ({ ...disabled(),
                            enabled: true, lastError: message });
                        if (data.github.data && (data.github.data.visibility !== 'public'
                            || data.github.data.username.toLowerCase() !== selection.accounts.github)) {
                            data.github = unavailable('Public GitHub identity or visibility did not match.');
                            data.githubActivity = undefined;
                        }
                        if (data.githubActivity?.data && (
                            data.githubActivity.data.visibility !== 'public'
                            || data.githubActivity.data.username.toLowerCase()
                                !== selection.accounts.github)) {
                            data.githubActivity = unavailable(
                                'Public GitHub activity identity or visibility did not match.',
                            );
                        }
                        if (data.wakatime.data && (data.wakatime.data.accessMode === 'oauth'
                            || data.wakatime.data.username.toLowerCase()
                                !== selection.accounts.wakatime)) {
                            data.wakatime = unavailable('Public WakaTime identity did not match.');
                        }
                        for (const service of ['codex', 'openrouter', 'anthropic'] as const) {
                            if (data.aiUsage?.[service]) {
                                data.aiUsage[service] = unavailable(service === 'codex'
                                    ? 'Codex usage requires access to that account; a public ID is not authorization.'
                                    : service === 'openrouter'
                                    ? 'OpenRouter usage requires a configured account Management key.'
                                    : 'Anthropic API usage requires a configured organization Admin key.');
                            }
                        }
                    }
                } catch {
                    // Never expose native exceptions or claim a saved copy exists.
                    response = Response.json({ error: {
                        code: 'snapshot_unavailable',
                        message: 'Statistics storage is unavailable. Check the '
                            + 'Worker binding, migration and runtime configuration.',
                    } }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
                    return request.method === 'HEAD'
                        ? new Response(null, response) : response;
                }
                if (url.pathname === '/api/stats') {
                    // Publish counts, never the internal membership histogram.
                    const { repositoryLanguageCounts, ...github } = data.github.data ?? {};
                    const languageRows = displayLanguages(selectLanguages(
                        joinLanguages(data), options.sort, options.limit,
                        githubBytesAvailable(data.github.data), repositoryLanguageCounts,
                    ), 2);
                    response = Response.json({
                        ...data,
                        github: {
                            ...data.github,
                            data: data.github.data ? github : null,
                        },
                        languageRows,
                    }, {
                        headers: { 'Cache-Control': 'no-store' },
                    });
                } else {
                    const svg = renderCard(data, options);
                    const digest = await crypto.subtle.digest(
                        'SHA-256', new TextEncoder().encode(svg),
                    );
                    const etag = '"' + Array.from(new Uint8Array(digest))
                        .map(value => value.toString(16).padStart(2, '0')).join('') + '"';
                    const headers = {
                        'Content-Type': 'image/svg+xml; charset=utf-8',
                        'Cache-Control': 'public, max-age=300, stale-if-error=86400',
                        'X-Content-Type-Options': 'nosniff', ETag: etag,
                        'X-Stats-GitHub': data.github.status,
                        'X-Stats-GitHub-Activity': data.githubActivity?.status
                            ?? 'unavailable',
                        'X-Stats-WakaTime': data.wakatime.status,
                    };
                    response = request.headers.get('If-None-Match') === etag
                        ? new Response(null, { status: 304, headers })
                        : new Response(svg, { headers });
                }
            } else {
                response = new Response('Not found', { status: 404 });
            }
            if (request.method === 'HEAD') {
                return new Response(null, {
                    status: response.status, headers: response.headers,
                });
            }
            return response;
        },
    };
}
