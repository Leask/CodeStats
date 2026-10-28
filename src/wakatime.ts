import { UpstreamError } from './errors';
import { RANGES } from './types';
import type { Fetcher, Range, Settings, WakaData } from './types';

type JsonObject = Record<string, unknown>;
type WakaSettings = Pick<Settings, 'WAKATIME_USERNAME' | 'WAKATIME_TOKEN'>;
type Owner = { username: string; identities: string[] };

const ORIGIN = 'https://api.wakatime.com';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const UUID = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

/** Only deliberate public unavailability may use an owner-bound fallback. */
class PublicUnavailable extends UpstreamError {}

function identifier(value: unknown): string {
    if (typeof value !== 'string'
        || !/^[a-z\d][a-z\d_-]{0,63}$/i.test(value)
        || /^waka_tok_/i.test(value)
        || /^waka_/i.test(value) && UUID.test(value.slice(5))) {
        throw new UpstreamError('WakaTime username is invalid.');
    }
    return value;
}

function object(value: unknown): JsonObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new UpstreamError('WakaTime returned incomplete data.');
    }
    return value as JsonObject;
}

function cooldown(headers: Headers): number | undefined {
    const now = Date.now();
    const retry = headers.get('retry-after');
    const reset = headers.get('x-ratelimit-reset');
    const delay = retry === null ? NaN : /^\d+$/.test(retry)
        ? Number(retry) : (Date.parse(retry) - now) / 1000;
    const resetDelay = reset === null ? NaN : Number(reset) - now / 1000;
    const delays = [delay, resetDelay].filter(value => Number.isFinite(value)
        && value > 0);
    return delays.length ? Math.min(86400, Math.ceil(Math.max(...delays)))
        : undefined;
}

function createClient(fetcher: Fetcher) {
    const signal = AbortSignal.timeout(36_000);
    let requests = 0;
    return async (path: string, token?: string): Promise<unknown> => {
        if (++requests > 3 || signal.aborted) {
            throw new UpstreamError('WakaTime request budget exceeded.');
        }
        const url = new URL(path, ORIGIN);
        if (url.origin !== ORIGIN || url.username || url.password || url.hash) {
            throw new UpstreamError('WakaTime request origin is invalid.');
        }
        let response: Response;
        try {
            response = await fetcher(url.toString(), {
                headers: {
                    Accept: 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                redirect: 'manual',
                signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
            });
        } catch {
            throw new UpstreamError('WakaTime request failed or timed out.');
        }
        const limited = response.status === 429 || (response.status === 403
            && (response.headers.has('retry-after')
                || response.headers.get('x-ratelimit-remaining') === '0'));
        if (limited) {
            await response.body?.cancel();
            throw new UpstreamError('WakaTime rate limit reached.', cooldown(response.headers));
        }
        if (response.status === 202) {
            await response.body?.cancel();
            throw new PublicUnavailable('WakaTime is still calculating this range.');
        }
        if ([400, 401, 403, 404].includes(response.status)) {
            await response.body?.cancel();
            throw new PublicUnavailable('WakaTime range is not public or authorized; '
                + 'publish this range or configure a server-side OAuth token.');
        }
        if (!response.ok) {
            await response.body?.cancel();
            throw new UpstreamError(`WakaTime API returned HTTP ${response.status}.`);
        }
        const reader = response.body?.getReader();
        if (!reader || Number(response.headers.get('content-length')) > MAX_BODY_BYTES) {
            await reader?.cancel();
            throw new PublicUnavailable('WakaTime response is incomplete or too large.');
        }
        let bytes = 0;
        let body = '';
        const decoder = new TextDecoder();
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                bytes += value.length;
                if (bytes > MAX_BODY_BYTES) {
                    await reader.cancel();
                    throw new PublicUnavailable('WakaTime response is too large.');
                }
                body += decoder.decode(value, { stream: true });
            }
            body += decoder.decode();
            return JSON.parse(body) as unknown;
        } catch (error) {
            if (error instanceof PublicUnavailable) throw error;
            if (error instanceof SyntaxError) {
                throw new PublicUnavailable('WakaTime returned invalid JSON.');
            }
            throw new UpstreamError('WakaTime response failed or timed out.');
        }
    };
}

type WakaClient = ReturnType<typeof createClient>;

async function resolveOwner(client: WakaClient, token: string): Promise<Owner> {
    const data = object(object(await client('/api/v1/users/current', token)).data);
    const identities = ['username', 'user_id', 'id']
        .filter(key => data[key] !== null && data[key] !== undefined)
        .filter(key => key !== 'username' || data[key] !== '')
        .map(key => identifier(data[key]));
    if (!identities.length) {
        throw new UpstreamError('WakaTime OAuth owner identity is unavailable.');
    }
    return { username: identities[0], identities };
}

/** Resolve token-only deployments before assigning their persistent cache identity. */
export async function resolveWakaTimeUsername(
    env: WakaSettings, fetcher: Fetcher = fetch,
): Promise<string> {
    if (env.WAKATIME_USERNAME) return identifier(env.WAKATIME_USERNAME);
    const token = env.WAKATIME_TOKEN?.trim();
    if (!token) throw new UpstreamError('WakaTime username or OAuth token is required.');
    return (await resolveOwner(createClient(fetcher), token)).username;
}

function validateIdentity(data: JsonObject, username: string, owner?: Owner): void {
    const expected = new Set((owner?.identities ?? [username])
        .map(value => value.toLowerCase()));
    for (const key of ['username', 'user_id']) {
        if (data[key] === undefined || data[key] === null) continue;
        const actual = identifier(data[key]);
        // Public UUID URLs may identify an account whose username differs.
        const comparable = owner || key === 'username' && !UUID.test(username)
            || key !== 'username' && UUID.test(username);
        if (comparable && !expected.has(actual.toLowerCase())) {
            throw new UpstreamError('WakaTime statistics account identity changed.');
        }
    }
}

function number(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new UpstreamError('WakaTime returned an invalid statistic.');
    }
    return value;
}

function timestamp(value: unknown): string | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
        throw new UpstreamError('WakaTime returned an invalid date.');
    }
    return value;
}

/** The denominator includes Other; never recompute shares from excluded totals. */
function statistics(value: unknown, username: string, range: Range,
    accessMode: 'public' | 'oauth', owner?: Owner): WakaData {
    const envelope = object(value);
    const data = envelope.data as JsonObject | undefined;
    if (!data || typeof data !== 'object' || Array.isArray(data)
        || !Array.isArray(data.languages) || data.is_up_to_date !== true
        || data.is_stuck === true
        || (data.percent_calculated !== undefined
            && data.percent_calculated !== 100)) {
        throw new UpstreamError('WakaTime returned incomplete or pending statistics.');
    }
    validateIdentity(data, username, owner);
    if (data.range !== undefined && data.range !== range) {
        throw new UpstreamError('WakaTime returned statistics for a different range.');
    }
    if (data.status !== undefined && data.status !== 'ok') {
        throw new UpstreamError('WakaTime returned an unsuccessful statistics status.');
    }
    if (typeof data.is_including_today !== 'boolean') {
        throw new UpstreamError('WakaTime omitted its statistics cutoff.');
    }
    const names = new Set<string>();
    const languages = data.languages.map((value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new UpstreamError('WakaTime returned an invalid language row.');
        }
        const row = value as JsonObject;
        if (typeof row.name !== 'string' || !row.name || row.name.length > 256
            || names.has(row.name)) {
            throw new UpstreamError('WakaTime language names are incomplete or repeated.');
        }
        names.add(row.name);
        const percent = number(row.percent);
        if (percent > 100) {
            throw new UpstreamError('WakaTime returned an invalid language percentage.');
        }
        return {
            name: row.name,
            seconds: number(row.total_seconds),
            percent,
        };
    });
    const totalSeconds = number(data.total_seconds_including_other_language);
    const sumSeconds = languages.reduce((sum, row) => sum + row.seconds, 0);
    // The API rounds row seconds independently. Permit rounding, not truncation.
    if (Math.abs(sumSeconds - totalSeconds) > Math.max(2, languages.length)) {
        throw new UpstreamError('WakaTime language totals are incomplete.');
    }
    for (const row of languages) {
        const expected = totalSeconds ? row.seconds / totalSeconds * 100 : 0;
        if (Math.abs(row.percent - expected) > 0.03) {
            throw new UpstreamError('WakaTime language percentage denominator changed.');
        }
    }
    return {
        username, accessMode,
        range,
        rangeLabel: typeof data.human_readable_range === 'string'
            && data.human_readable_range.length <= 256
            ? data.human_readable_range : null,
        totalSeconds,
        dailyAverageSeconds: number(data.daily_average_including_other_language),
        start: timestamp(data.start),
        end: timestamp(data.end),
        includesToday: data.is_including_today,
        languages,
    };
}

/** Public data wins; OAuth is a same-range fallback bound to the token's owner. */
export async function fetchWakaTime(
    env: WakaSettings, range: Range, fetcher: Fetcher = fetch,
): Promise<WakaData> {
    if (!RANGES.includes(range)) {
        throw new UpstreamError('Unsupported WakaTime range.');
    }
    const client = createClient(fetcher);
    const token = env.WAKATIME_TOKEN?.trim();
    let owner: Owner | undefined;
    let username: string;
    if (env.WAKATIME_USERNAME) {
        username = identifier(env.WAKATIME_USERNAME);
    } else {
        if (!token) throw new UpstreamError('WakaTime username or OAuth token is required.');
        owner = await resolveOwner(client, token);
        username = owner.username;
    }
    const path = `/api/v1/users/${encodeURIComponent(username)}/stats/${range}`;
    let value: unknown;
    try {
        value = await client(path);
    } catch (error) {
        if (!(error instanceof PublicUnavailable) || !token) throw error;
        value = undefined;
    }
    if (value !== undefined) {
        try {
            return statistics(value, username, range, 'public');
        } catch (error) {
            if (!(error instanceof UpstreamError) || !token) throw error;
        }
    }
    owner ??= await resolveOwner(client, token!);
    if (!owner.identities.some(value => value.toLowerCase() === username.toLowerCase())) {
        throw new UpstreamError('WakaTime OAuth token belongs to a different account.');
    }
    return statistics(await client(path, token), username, range, 'oauth', owner);
}
