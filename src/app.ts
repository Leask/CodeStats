import { renderCard, renderPage } from './render';
import { RANGES } from './types';
import type { CardOptions, Range, Settings, StatsSnapshot } from './types';

function rangeFrom(url: URL, env: Settings): Range {
    const value = url.searchParams.get('range') ?? env.DEFAULT_RANGE;
    if (!RANGES.includes(value as Range)) {
        throw new Error('Invalid range; use all_time, last_7_days or last_30_days.');
    }
    return value as Range;
}

function cardOptions(url: URL): CardOptions {
    const theme = url.searchParams.get('theme') ?? 'transparent';
    const view = url.searchParams.get('view') ?? 'overview';
    const sort = url.searchParams.get('sort') ?? 'time';
    const header = url.searchParams.get('header') ?? 'true';
    if (!['dark', 'light', 'transparent'].includes(theme)
        || !['overview', 'languages', 'activity'].includes(view)
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
    readSnapshot: (env: Config, range: Range) => Promise<StatsSnapshot>,
) {
    return {
        async fetch(request: Request, env: Config): Promise<Response> {
            const url = new URL(request.url);
            if (!['GET', 'HEAD'].includes(request.method)) {
                return new Response('Method not allowed', {
                    status: 405, headers: { Allow: 'GET, HEAD' },
                });
            }
            let response: Response;
            if (['/build', '/build/'].includes(url.pathname)) {
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
                try {
                    range = rangeFrom(url, env);
                    options = cardOptions(url);
                } catch (error) {
                    return new Response((error as Error).message, { status: 400 });
                }
                let data: StatsSnapshot;
                try {
                    data = await readSnapshot(env, range);
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
                    response = Response.json(data, {
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
