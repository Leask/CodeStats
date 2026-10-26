import { UpstreamError } from './errors';
import type { Env, Fetcher } from './types';

export type JsonObject = Record<string, unknown>;

export function object(value: unknown): JsonObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new UpstreamError('GitHub returned incomplete data.');
    }
    return value as JsonObject;
}

export function text(value: unknown): string {
    if (typeof value !== 'string' || !value || value.length > 256) {
        throw new UpstreamError('GitHub returned invalid text.');
    }
    return value;
}

export function count(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)
        || value < 0) {
        throw new UpstreamError('GitHub returned an invalid count.');
    }
    return value;
}

export function page(connection: JsonObject): string | null {
    const info = object(connection.pageInfo);
    if (typeof info.hasNextPage !== 'boolean') {
        throw new UpstreamError('GitHub pagination is incomplete.');
    }
    return info.hasNextPage ? text(info.endCursor) : null;
}

function cooldown(headers: Headers): number | undefined {
    const now = Date.now();
    const retry = headers.get('retry-after');
    const reset = headers.get('x-ratelimit-reset');
    const delay = retry === null ? NaN : /^\d+$/.test(retry)
        ? Number(retry) : (Date.parse(retry) - now) / 1000;
    const resetDelay = reset === null ? NaN : Number(reset) - now / 1000;
    const valid = [delay, resetDelay].filter(x => Number.isFinite(x) && x > 0);
    return valid.length ? Math.min(86400, Math.ceil(Math.max(...valid)))
        : undefined;
}

/** Fixed official origin, finite budget, no credential-bearing error bodies. */
export function createGitHubClient(
    env: Pick<Env, 'GITHUB_USERNAME' | 'GITHUB_TOKEN'>,
    fetcher: Fetcher = fetch,
    options: {
        timeoutMs?: number;
        maxRequests?: number;
        requiredScopes?: string[];
    } = {},
) {
    const login = env.GITHUB_USERNAME;
    if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login)) {
        throw new UpstreamError('GitHub username is invalid.');
    }
    if (!env.GITHUB_TOKEN?.trim()) {
        throw new UpstreamError('Configure a server-side GITHUB_TOKEN for GitHub stats.');
    }
    const signal = AbortSignal.timeout(options.timeoutMs ?? 20_000);
    let requests = 0;
    const request = async (
        path: string, body?: JsonObject,
    ): Promise<JsonObject> => {
        if (++requests > (options.maxRequests ?? 128)) {
            throw new UpstreamError('GitHub request budget exceeded; saved data retained.');
        }
        const url = new URL(path, 'https://api.github.com');
        if (url.origin !== 'https://api.github.com') {
            throw new UpstreamError('GitHub request origin is invalid.');
        }
        let response: Response;
        try {
            response = await fetcher(url.toString(), {
                method: body ? 'POST' : 'GET', redirect: 'manual', signal,
                headers: {
                    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
                    'User-Agent': 'CodeStats',
                    Accept: 'application/vnd.github+json',
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
        } catch {
            throw new UpstreamError('GitHub request failed or timed out.');
        }
        if (response.headers.get('x-github-sso')) {
            throw new UpstreamError('GitHub SSO authorization is incomplete; saved data retained.');
        }
        if (!response.ok) {
            throw new UpstreamError(
                `GitHub API returned HTTP ${response.status}.`,
                [403, 429].includes(response.status)
                    ? cooldown(response.headers) : undefined,
            );
        }
        if (options.requiredScopes?.length) {
            const scopes = new Set((response.headers.get('x-oauth-scopes') ?? '')
                .split(',').map(x => x.trim()));
            if (scopes.has('user')) {
                scopes.add('read:user');
            }
            if (scopes.has('admin:org') || scopes.has('write:org')) {
                scopes.add('read:org');
            }
            if (options.requiredScopes.some(scope => !scopes.has(scope))) {
                throw new UpstreamError('GitHub token needs classic PAT scopes '
                    + 'repo, read:user and read:org for complete private coverage.');
            }
        }
        let value: JsonObject;
        try {
            value = object(await response.json());
        } catch {
            throw new UpstreamError('GitHub returned invalid JSON.');
        }
        if (value.errors !== undefined
            && (!Array.isArray(value.errors) || value.errors.length > 0)) {
            throw new UpstreamError(
                'GitHub GraphQL returned partial or failed data.',
                cooldown(response.headers),
            );
        }
        return value;
    };
    return {
        login,
        get: (path: string) => request(path),
        query: async (query: string, variables: JsonObject = {}) => object(
            (await request('/graphql', { query, variables })).data,
        ),
    };
}
