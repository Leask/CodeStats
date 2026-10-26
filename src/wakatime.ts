import { UpstreamError } from './errors';
import { RANGES } from './types';
import type { Env, Fetcher, Range, WakaData } from './types';

type JsonObject = Record<string, unknown>;

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
export async function fetchWakaTime(
    env: Pick<Env, 'WAKATIME_USERNAME' | 'WAKATIME_TOKEN'>,
    range: Range,
    fetcher: Fetcher = fetch,
): Promise<WakaData> {
    if (!RANGES.includes(range)) {
        throw new UpstreamError('Unsupported WakaTime range.');
    }
    if (!/^[a-z\d][a-z\d_-]{0,63}$/i.test(env.WAKATIME_USERNAME)) {
        throw new UpstreamError('WakaTime username is invalid.');
    }
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (env.WAKATIME_TOKEN?.trim()) {
        headers.Authorization = `Bearer ${env.WAKATIME_TOKEN}`;
    }
    const url = 'https://api.wakatime.com/api/v1/users/'
        + `${encodeURIComponent(env.WAKATIME_USERNAME)}/stats/${range}`;
    let response: Response;
    try {
        response = await fetcher(url, {
            headers,
            redirect: 'manual',
            signal: AbortSignal.timeout(12_000),
        });
    } catch {
        throw new UpstreamError('WakaTime request failed or timed out.');
    }
    if (response.status === 400 || response.status === 401
        || response.status === 403 || response.status === 404) {
        throw new UpstreamError('WakaTime range is not public or authorized; '
            + 'publish this range or configure a server-side OAuth token.');
    }
    if (response.status === 202) {
        throw new UpstreamError('WakaTime is still calculating this range.');
    }
    if (!response.ok) {
        throw new UpstreamError(`WakaTime API returned HTTP ${response.status}.`);
    }
    let envelope: JsonObject;
    try {
        envelope = await response.json() as JsonObject;
    } catch {
        throw new UpstreamError('WakaTime returned invalid JSON.');
    }
    const data = envelope?.data as JsonObject | undefined;
    if (!data || typeof data !== 'object' || Array.isArray(data)
        || !Array.isArray(data.languages) || data.is_up_to_date !== true
        || data.is_stuck === true
        || (data.percent_calculated !== undefined
            && data.percent_calculated !== 100)) {
        throw new UpstreamError('WakaTime returned incomplete or pending statistics.');
    }
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
        username: env.WAKATIME_USERNAME,
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
