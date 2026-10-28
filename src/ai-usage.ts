import { UpstreamError } from './errors';
import type { Fetcher } from './types';

export interface AIUsageData {
    service: 'openrouter' | 'anthropic' | 'codex';
    label: string;
    totalTokens: number | null;
    period: string;
    since: string | null;
    until: string | null;
    scope: string;
}

export interface AIUsageEnv {
    OPENROUTER_API_KEY?: string;
    OPENROUTER_USAGE_SINCE?: string;
    ANTHROPIC_ADMIN_KEY?: string;
    ANTHROPIC_USAGE_SINCE?: string;
}

type JsonObject = Record<string, unknown>;
type Clock = number | (() => number);
const DAY_MS = 86_400_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_PAGES = 32;

function object(value: unknown, label: string): JsonObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new UpstreamError(`${label} returned incomplete usage data.`);
    }
    return value as JsonObject;
}

function count(value: unknown, label: string, strings = false): number {
    const numeric = strings && typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value) : value;
    if (typeof numeric !== 'number' || !Number.isSafeInteger(numeric)
        || numeric < 0) {
        throw new UpstreamError(`${label} returned an invalid token count.`);
    }
    return numeric;
}

function add(left: number, right: number, label: string): number {
    return count(left + right, label);
}

function window(since: string | undefined, now: Clock, daily = false) {
    const current = typeof now === 'function' ? now() : now;
    if (!Number.isFinite(current) || current < Date.UTC(2000, 0, 1)
        || current > Date.UTC(2200, 0, 1)) {
        throw new UpstreamError('AI usage collection time is invalid.');
    }
    const configured = since?.trim();
    const until = configured && !daily ? Math.floor(current / 1000) * 1000
        : Math.floor(current / DAY_MS) * DAY_MS;
    let from = until - 30 * DAY_MS;
    if (configured) {
        if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/
            .test(configured)) {
            throw new UpstreamError('AI usage start must be a UTC date or timestamp.');
        }
        from = Date.parse(configured);
        if (!Number.isFinite(from) || from < Date.UTC(2000, 0, 1)
            || from >= until
            || new Date(from).toISOString().slice(0, 10)
                !== configured.slice(0, 10)) {
            throw new UpstreamError('AI usage start date is invalid.');
        }
        if (daily && from % DAY_MS !== 0) {
            throw new UpstreamError('Anthropic usage start must be UTC midnight.');
        }
    }
    return {
        since: new Date(from).toISOString(),
        until: new Date(until).toISOString(),
        period: configured ? `Since ${new Date(from).toISOString().slice(0, 10)}`
            : 'Last 30 days',
    };
}

function retryAfter(headers: Headers): number | undefined {
    const value = headers.get('retry-after');
    if (value === null || !/^\d+$/.test(value)) {
        return undefined;
    }
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) && seconds > 0
        ? Math.min(seconds, 86_400) : undefined;
}

/** Shared deadline includes response streaming; never expose upstream bodies. */
function client(label: string, fetcher: Fetcher) {
    const signal = AbortSignal.timeout(45_000);
    return async (url: string, init: RequestInit): Promise<JsonObject> => {
        let response: Response;
        try {
            signal.throwIfAborted();
            response = await fetcher(url, { ...init, redirect: 'manual', signal });
        } catch {
            throw new UpstreamError(`${label} usage request failed or timed out.`);
        }
        if (!response.ok) {
            // Do not parse errors; an upstream may echo a credential or filter.
            void response.body?.cancel().catch(() => undefined);
            throw new UpstreamError(response.status === 403
                ? `${label}: ${label === 'OpenRouter' ? 'Management' : 'Admin'} key required.`
                : `${label} usage API returned HTTP ${response.status}.`,
            response.status === 429 ? retryAfter(response.headers) : undefined);
        }
        const length = response.headers.get('content-length');
        if (length !== null && Number(length) > MAX_BODY_BYTES) {
            void response.body?.cancel().catch(() => undefined);
            throw new UpstreamError(`${label} usage response is too large.`);
        }
        const reader = response.body?.getReader();
        if (!reader) {
            throw new UpstreamError(`${label} returned incomplete usage data.`);
        }
        let abort: (() => void) | undefined;
        const aborted = new Promise<never>((_, reject) => {
            abort = () => reject(new Error('Usage deadline exceeded.'));
            signal.addEventListener('abort', abort, { once: true });
        });
        try {
            const chunks: Uint8Array[] = [];
            let size = 0;
            for (;;) {
                signal.throwIfAborted();
                const part = await Promise.race([reader.read(), aborted]);
                if (part.done) {
                    break;
                }
                size += part.value.byteLength;
                if (size > MAX_BODY_BYTES) {
                    throw new Error('Usage response exceeded size limit.');
                }
                chunks.push(part.value);
            }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
            }
            return object(JSON.parse(new TextDecoder('utf-8', {
                fatal: true, ignoreBOM: false,
            })
                .decode(bytes)), label);
        } catch {
            void reader.cancel().catch(() => undefined);
            throw new UpstreamError(`${label} returned invalid or incomplete usage data.`);
        } finally {
            if (abort) {
                signal.removeEventListener('abort', abort);
            }
            reader.releaseLock();
        }
    };
}

/** One server-side aggregate, never a scan of individual generations. */
export async function fetchOpenRouterUsage(
    env: AIUsageEnv,
    fetcher: Fetcher = fetch,
    now: Clock = Date.now,
): Promise<AIUsageData> {
    if (!env.OPENROUTER_API_KEY?.trim()) {
        throw new UpstreamError('Configure an OpenRouter Management key for usage.');
    }
    const range = window(env.OPENROUTER_USAGE_SINCE, now);
    const request = client('OpenRouter', fetcher);
    const envelope = await request('https://openrouter.ai/api/v1/analytics/query', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
            Accept: 'application/json', 'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            metrics: ['tokens_total'],
            time_range: { start: range.since, end: range.until },
        }),
    });
    const data = object(envelope.data, 'OpenRouter');
    const metadata = object(data.metadata, 'OpenRouter');
    if (!Array.isArray(data.data) || data.data.length !== 1
        || metadata.truncated !== false || metadata.row_count !== 1
        || (data.warnings !== undefined
            && (!Array.isArray(data.warnings) || data.warnings.length > 0))) {
        throw new UpstreamError('OpenRouter returned partial usage statistics.');
    }
    const totalTokens = count(object(data.data[0], 'OpenRouter').tokens_total,
        'OpenRouter', true);
    return {
        service: 'openrouter', label: 'OpenRouter', totalTokens, ...range,
        scope: 'Account-wide API tokens across all keys and workspaces; '
            + 'the configured reporting interval only.',
    };
}

/** Organization-wide daily buckets, with bounded pagination and no filters. */
export async function fetchAnthropicUsage(
    env: AIUsageEnv,
    fetcher: Fetcher = fetch,
    now: Clock = Date.now,
): Promise<AIUsageData> {
    if (!env.ANTHROPIC_ADMIN_KEY?.trim()) {
        throw new UpstreamError('Configure an Anthropic Admin key for usage.');
    }
    const range = window(env.ANTHROPIC_USAGE_SINCE, now, true);
    const request = client('Anthropic', fetcher);
    const pages = new Set<string>();
    const buckets = new Set<string>();
    let page: string | undefined;
    let totalTokens = 0;
    for (let index = 0; index < MAX_PAGES; index++) {
        const url = new URL('https://api.anthropic.com/v1/organizations/usage_report/messages');
        url.search = new URLSearchParams({
            starting_at: range.since, ending_at: range.until,
            bucket_width: '1d', limit: '31', ...(page ? { page } : {}),
        }).toString();
        const data = await request(url.toString(), {
            headers: {
                'x-api-key': env.ANTHROPIC_ADMIN_KEY,
                'anthropic-version': '2023-06-01', Accept: 'application/json',
            },
        });
        if (!Array.isArray(data.data) || data.data.length > 31
            || typeof data.has_more !== 'boolean') {
            throw new UpstreamError('Anthropic returned incomplete usage pagination.');
        }
        for (const value of data.data) {
            const bucket = object(value, 'Anthropic');
            if (typeof bucket.starting_at !== 'string'
                || typeof bucket.ending_at !== 'string'
                || !Number.isFinite(Date.parse(bucket.starting_at))
                || !Number.isFinite(Date.parse(bucket.ending_at))
                || Date.parse(bucket.starting_at) >= Date.parse(bucket.ending_at)
                || Date.parse(bucket.starting_at) < Date.parse(range.since)
                || Date.parse(bucket.ending_at) > Date.parse(range.until)
                || buckets.has(new Date(bucket.starting_at).toISOString())
                || !Array.isArray(bucket.results)) {
                throw new UpstreamError('Anthropic returned invalid or repeated usage buckets.');
            }
            buckets.add(new Date(bucket.starting_at).toISOString());
            for (const value of bucket.results) {
                const row = object(value, 'Anthropic');
                const creation = object(row.cache_creation, 'Anthropic');
                for (const tokens of [row.uncached_input_tokens,
                    row.cache_read_input_tokens, row.output_tokens,
                    creation.ephemeral_5m_input_tokens,
                    creation.ephemeral_1h_input_tokens]) {
                    totalTokens = add(totalTokens, count(tokens, 'Anthropic'),
                        'Anthropic');
                }
            }
        }
        if (!data.has_more) {
            if (data.next_page !== null) {
                throw new UpstreamError('Anthropic returned inconsistent usage pagination.');
            }
            return {
                service: 'anthropic', label: 'Anthropic API', totalTokens, ...range,
                scope: 'Organization-wide Claude API tokens, including uncached '
                    + 'input, cache reads, cache creation and output; excludes '
                    + 'Claude subscriptions and usage through other platforms.',
            };
        }
        if (typeof data.next_page !== 'string' || !data.next_page
            || data.next_page.length > 4096 || pages.has(data.next_page)
            || data.data.length === 0) {
            throw new UpstreamError('Anthropic returned incomplete or repeated usage pagination.');
        }
        page = data.next_page;
        pages.add(page);
    }
    throw new UpstreamError('Anthropic usage page budget exceeded; saved data retained.');
}
