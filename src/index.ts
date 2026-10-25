import { SnapshotCache } from './cache';
import { DurableObject } from 'cloudflare:workers';
import { fetchGitHub } from './github';
import { renderCard, renderPage } from './render';
import { fetchWakaTime } from './wakatime';
import { RANGES } from './types';
import type { CardOptions, Env, Range, StatsSnapshot } from './types';

function seconds(value: string, fallback: number, minimum: number): number {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, number) : fallback;
}

function rangeFrom(url: URL, env: Env): Range {
    const value = url.searchParams.get('range') ?? env.DEFAULT_RANGE;
    if (!RANGES.includes(value as Range)) {
        throw new Error('Invalid range; use all_time, last_7_days or last_30_days.');
    }
    return value as Range;
}

function cardOptions(url: URL): CardOptions {
    const theme = url.searchParams.get('theme') ?? 'dark';
    const view = url.searchParams.get('view') ?? 'overview';
    const sort = url.searchParams.get('sort') ?? 'time';
    if (!['dark', 'light', 'transparent'].includes(theme)
        || !['overview', 'languages', 'activity'].includes(view)
        || !['time', 'code', 'name'].includes(sort)) {
        throw new Error('Invalid theme, view or sort option.');
    }
    const requested = Number(url.searchParams.get('limit') ?? 8);
    if (!Number.isInteger(requested) || requested < 1 || requested > 100) {
        throw new Error('Limit must be an integer from 1 to 100.');
    }
    return {
        theme: theme as CardOptions['theme'],
        view: view as CardOptions['view'],
        sort: sort as CardOptions['sort'], limit: requested,
    };
}

/** One globally coordinated, persistent cache per configured public profile. */
export class SnapshotStore extends DurableObject<Env> {
    private readonly cache: SnapshotCache;

    constructor(private readonly state: DurableObjectState, env: Env) {
        super(state, env);
        this.cache = new SnapshotCache(state.storage, {
            github: () => fetchGitHub(env),
            wakatime: range => fetchWakaTime(env, range),
        }, {
            freshSeconds: seconds(env.FRESH_SECONDS, 21600, 60),
            retrySeconds: seconds(env.RETRY_SECONDS, 900, 60),
        });
    }

    async fetch(request: Request): Promise<Response> {
        const range = new URL(request.url).searchParams.get('range') as Range;
        if (!RANGES.includes(range)) {
            return new Response('Invalid range', { status: 400 });
        }
        const value = await this.cache.read(range,
            promise => this.state.waitUntil(promise));
        return Response.json(value);
    }
}

async function snapshot(env: Env, range: Range): Promise<StatsSnapshot> {
    const identity = [
        'public-v1', env.GITHUB_USERNAME.toLowerCase(),
        env.WAKATIME_USERNAME.toLowerCase(),
    ].join(':');
    const id = env.SNAPSHOTS.idFromName(identity);
    const response = await env.SNAPSHOTS.get(id).fetch(
        'https://snapshot.internal/?range=' + range,
    );
    if (!response.ok) {
        throw new Error('Snapshot unavailable');
    }
    return response.json<StatsSnapshot>();
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        if (!['GET', 'HEAD'].includes(request.method)) {
            return new Response('Method not allowed', {
                status: 405, headers: { Allow: 'GET, HEAD' },
            });
        }
        let response: Response;
        if (url.pathname === '/') {
            response = new Response(renderPage(), {
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Cache-Control': 'no-store',
                    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; "
                        + "style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
                        + "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
                },
            });
        } else if (url.pathname === '/health') {
            response = Response.json({ service: 'CodeStats', runtime: 'ready' });
        } else if (url.pathname === '/favicon.svg') {
            response = new Response(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
                + '<rect width="32" height="32" rx="7" fill="#121920"/>'
                + '<path d="M8 23V13m8 10V7m8 16V10" stroke="#9de6c4" '
                + 'stroke-width="4" stroke-linecap="round"/></svg>',
                { headers: { 'Content-Type': 'image/svg+xml',
                    'Cache-Control': 'public, max-age=86400' } },
            );
        } else if (['/api/stats', '/card.svg'].includes(url.pathname)) {
            let range: Range;
            let options: CardOptions;
            try {
                range = rangeFrom(url, env);
                options = cardOptions(url);
            } catch (error) {
                return new Response((error as Error).message, { status: 400 });
            }
            const data = await snapshot(env, range);
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
} satisfies ExportedHandler<Env>;
