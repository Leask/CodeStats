import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAnthropicUsage, fetchOpenRouterUsage } from '../src/ai-usage';
import type { Fetcher } from '../src/types';

const NOW = Date.parse('2026-10-28T15:42:10Z');
const env = { OPENROUTER_API_KEY: 'management-test', ANTHROPIC_ADMIN_KEY: 'admin-test' };

function sequence(responses: Response[]) {
    const requests: { url: URL; init: RequestInit }[] = [];
    const fetcher = (async (input, init) => {
        requests.push({ url: new URL(String(input)), init: init ?? {} });
        const response = responses.shift();
        if (!response) {
            throw new Error('Unexpected usage request.');
        }
        return response;
    }) as Fetcher;
    return { fetcher, requests };
}

function openRouter(tokens: unknown = '1234', extra = {}) {
    return Response.json({ data: {
        data: [{ tokens_total: tokens }],
        metadata: { row_count: 1, truncated: false }, ...extra,
    } });
}

function bucket(date = '2026-10-01', results: unknown[] = [{
    uncached_input_tokens: 10, cache_read_input_tokens: 20, output_tokens: 30,
    cache_creation: { ephemeral_5m_input_tokens: 40, ephemeral_1h_input_tokens: 50 },
}]) {
    const starting = Date.parse(date);
    return { starting_at: new Date(starting).toISOString(),
        ending_at: new Date(starting + 86_400_000).toISOString(), results };
}

function anthropic(data: unknown[] = [bucket()], has_more = false,
    next_page: unknown = null) {
    return Response.json({ data, has_more, next_page });
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('OpenRouter aggregate usage', () => {
    it('makes one unfiltered aggregate for 30 completed UTC days', async () => {
        const { fetcher, requests } = sequence([openRouter()]);
        const result = await fetchOpenRouterUsage(env, fetcher, NOW);
        expect(result).toMatchObject({ service: 'openrouter', totalTokens: 1234,
            period: 'Last 30 days', since: '2026-09-28T00:00:00.000Z',
            until: '2026-10-28T00:00:00.000Z' });
        expect(requests).toHaveLength(1);
        expect(requests[0].url.href).toBe('https://openrouter.ai/api/v1/analytics/query');
        expect(requests[0].init).toMatchObject({ method: 'POST', redirect: 'manual',
            headers: { Authorization: 'Bearer management-test' } });
        expect(JSON.parse(String(requests[0].init.body))).toEqual({
            metrics: ['tokens_total'], time_range: {
                start: result.since, end: result.until,
            },
        });
    });

    it('labels configured coverage honestly instead of claiming lifetime', async () => {
        const { fetcher } = sequence([openRouter(0)]);
        const result = await fetchOpenRouterUsage({ ...env,
            OPENROUTER_USAGE_SINCE: '2026-01-01' }, fetcher, () => NOW);
        expect(result).toMatchObject({ totalTokens: 0, period: 'Since 2026-01-01',
            since: '2026-01-01T00:00:00.000Z', until: '2026-10-28T15:42:10.000Z' });
        expect(JSON.stringify(result)).not.toContain('management-test');
    });

    it.each([null, -1, 1.5, '1.5', 'NaN', Number.MAX_SAFE_INTEGER + 1])(
        'rejects malformed tokens %s', async tokens => {
            const { fetcher } = sequence([openRouter(tokens)]);
            await expect(fetchOpenRouterUsage(env, fetcher, NOW)).rejects.toThrow('token count');
        },
    );

    it.each([
        { metadata: { row_count: 1, truncated: true } },
        { metadata: { row_count: 2, truncated: false } },
        { metadata: { row_count: 1 } },
        { data: [] },
        { data: [{ tokens_total: '1' }, { tokens_total: '2' }] },
        { warnings: ['upstream-filter-warning'] },
    ])('rejects partial or unconfirmed totals %j', async extra => {
        const { fetcher } = sequence([openRouter('123', extra)]);
        await expect(fetchOpenRouterUsage(env, fetcher, NOW)).rejects.toThrow('partial');
    });
});

describe('Anthropic organization usage', () => {
    it('sums all input/cache/output tokens across aggregate pages', async () => {
        const { fetcher, requests } = sequence([
            anthropic([bucket()], true, 'next-page'),
            anthropic([bucket('2026-10-02')]),
        ]);
        const result = await fetchAnthropicUsage(env, fetcher, NOW);
        expect(result).toMatchObject({ service: 'anthropic', totalTokens: 300,
            period: 'Last 30 days' });
        expect(result.scope).toContain('excludes Claude subscriptions');
        expect(requests).toHaveLength(2);
        for (const request of requests) {
            expect(request.url.origin).toBe('https://api.anthropic.com');
            expect(request.url.pathname).toBe('/v1/organizations/usage_report/messages');
            expect(request.url.searchParams.get('limit')).toBe('31');
            expect(request.url.searchParams.get('bucket_width')).toBe('1d');
            expect(request.url.searchParams.get('starting_at')).toBe(result.since);
            expect(request.url.searchParams.get('ending_at')).toBe(result.until);
            expect(request.init).toMatchObject({ redirect: 'manual', headers: {
                'x-api-key': 'admin-test', 'anthropic-version': '2023-06-01',
            } });
        }
        expect(requests[1].url.searchParams.get('page')).toBe('next-page');
        expect(requests[1].init.signal).toBe(requests[0].init.signal);
    });

    it('returns confirmed zero for empty complete reports and buckets', async () => {
        for (const response of [anthropic([]), anthropic([bucket('2026-10-01', [])])]) {
            const { fetcher } = sequence([response]);
            expect((await fetchAnthropicUsage(env, fetcher, NOW)).totalTokens).toBe(0);
        }
    });

    it('rejects incomplete component counts and unsafe sums', async () => {
        for (const row of [
            { uncached_input_tokens: 1, cache_read_input_tokens: 2, output_tokens: 3 },
            { uncached_input_tokens: '1', cache_read_input_tokens: 2, output_tokens: 3,
                cache_creation: { ephemeral_5m_input_tokens: 4, ephemeral_1h_input_tokens: 5 } },
            { uncached_input_tokens: Number.MAX_SAFE_INTEGER, cache_read_input_tokens: 1,
                output_tokens: 0, cache_creation: {
                    ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0,
                } },
        ]) {
            const { fetcher } = sequence([anthropic([bucket('2026-10-01', [row])])]);
            await expect(fetchAnthropicUsage(env, fetcher, NOW)).rejects.toThrow();
        }
    });

    it('does not return partial totals after a later page fails', async () => {
        const { fetcher } = sequence([
            anthropic([bucket()], true, 'next'), new Response('secret', { status: 503 }),
        ]);
        await expect(fetchAnthropicUsage(env, fetcher, NOW)).rejects.toThrow('HTTP 503');
    });

    it('rejects repeated buckets, cursors and missing terminal confirmation', async () => {
        const cases = [
            [anthropic([bucket()], true, 'next'), anthropic([bucket()])],
            [anthropic([bucket()], true, 'next'), anthropic([bucket('2026-10-02')], true, 'next')],
            [anthropic([bucket()], true, null)],
            [anthropic([], true, 'next')],
            [anthropic([bucket()], false, 'unexpected')],
            [Response.json({ data: [], next_page: null })],
        ];
        for (const responses of cases) {
            const { fetcher } = sequence(responses);
            await expect(fetchAnthropicUsage(env, fetcher, NOW)).rejects.toThrow();
        }
    });

    it('stops at the bounded 32-page budget', async () => {
        const responses = Array.from({ length: 32 }, (_, index) => anthropic([
            bucket(new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10)),
        ], true, `next-${index}`));
        const { fetcher, requests } = sequence(responses);
        await expect(fetchAnthropicUsage({ ...env,
            ANTHROPIC_USAGE_SINCE: '2026-01-01' }, fetcher, NOW)).rejects.toThrow('page budget');
        expect(requests).toHaveLength(32);
    });
});

describe('usage transport and configuration guards', () => {
    it.each([fetchOpenRouterUsage, fetchAnthropicUsage])('requires a configured key', async collect => {
        const { fetcher, requests } = sequence([]);
        await expect(collect({}, fetcher, NOW)).rejects.toThrow('key');
        expect(requests).toHaveLength(0);
    });

    it.each(['2026-02-30', '2026-10-29', 'not-a-date', '2026-10-01T00:00:00+02:00'])(
        'rejects invalid start dates %s before requesting', async since => {
            const { fetcher, requests } = sequence([]);
            await expect(fetchOpenRouterUsage({ ...env,
                OPENROUTER_USAGE_SINCE: since }, fetcher, NOW)).rejects.toThrow('usage start');
            expect(requests).toHaveLength(0);
        },
    );

    it.each([fetchOpenRouterUsage, fetchAnthropicUsage])('keeps errors safe and blocks redirects', async collect => {
        for (const status of [302, 401, 403, 429, 500]) {
            const { fetcher, requests } = sequence([new Response('super-secret', {
                status, headers: { 'retry-after': '120', location: 'https://elsewhere.invalid' },
            })]);
            const failure = await collect(env, fetcher, NOW).catch(error => error);
            expect(failure.message).not.toContain('super-secret');
            expect(failure.message).toContain(status === 403 ? 'key required' : `HTTP ${status}`);
            expect(failure.retryAfterSeconds).toBe(status === 429 ? 120 : undefined);
            expect(requests).toHaveLength(1);
        }
    });

    it.each(['0', '-1', '0.5', 'tomorrow', '999999999999999999999'])('ignores invalid retry delay %s', async delay => {
        const { fetcher } = sequence([new Response('', {
            status: 429, headers: { 'retry-after': delay },
        })]);
        const failure = await fetchOpenRouterUsage(env, fetcher, NOW).catch(error => error);
        expect(failure.retryAfterSeconds).toBeUndefined();
    });

    it('bounds valid retry delays', async () => {
        const { fetcher } = sequence([new Response('', {
            status: 429, headers: { 'retry-after': '999999' },
        })]);
        const failure = await fetchOpenRouterUsage(env, fetcher, NOW).catch(error => error);
        expect(failure.retryAfterSeconds).toBe(86_400);
    });

    it.each([fetchOpenRouterUsage, fetchAnthropicUsage])('rejects invalid or oversized response bodies', async collect => {
        for (const response of [new Response('not-json'),
            new Response('x'.repeat(2 * 1024 * 1024 + 1)),
            new Response('{}', { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } })]) {
            const { fetcher } = sequence([response]);
            await expect(collect(env, fetcher, NOW)).rejects.toThrow();
        }
    });

    it('enforces the shared deadline while reading a stalled response body', async () => {
        vi.useFakeTimers();
        vi.spyOn(AbortSignal, 'timeout').mockImplementation(delay => {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), delay);
            return controller.signal;
        });
        const stalled = new ReadableStream<Uint8Array>({ start() {} });
        const { fetcher } = sequence([new Response(stalled)]);
        const result = fetchOpenRouterUsage(env, fetcher, NOW).catch(error => error);
        await vi.advanceTimersByTimeAsync(45_001);
        expect((await result).message).toContain('incomplete usage');
    });
});
