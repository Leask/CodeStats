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

function dailyUsage(rows: unknown[], extra = {}) {
    return Response.json({ data: {
        data: rows, metadata: { row_count: rows.length, truncated: false }, ...extra,
    } });
}

function openRouter(tokens: unknown = '1234', extra = {}) {
    return dailyUsage([{ date__day: '2026-10-01', tokens_total: tokens,
        request_count: '5' }], extra);
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
    it('makes one unfiltered daily aggregate for 367 completed UTC days', async () => {
        const { fetcher, requests } = sequence([openRouter()]);
        const result = await fetchOpenRouterUsage(env, fetcher, NOW);
        expect(result).toMatchObject({ collectionVersion: 3,
            service: 'openrouter', totalTokens: 1234, totalPrompts: 5,
            period: 'Last 367 days', since: '2025-10-26T00:00:00.000Z',
            until: '2026-10-28T00:00:00.000Z', summary: {
                averageDailyTokens: 1234 / 367,
                averageWeeklyTokens: 1234 / 367 * 7,
                longestStreakDays: 1,
            } });
        expect(requests).toHaveLength(1);
        expect(requests[0].url.href).toBe('https://openrouter.ai/api/v1/analytics/query');
        expect(requests[0].init).toMatchObject({ method: 'POST', redirect: 'manual',
            headers: { Authorization: 'Bearer management-test' } });
        expect(JSON.parse(String(requests[0].init.body))).toEqual({
            metrics: ['tokens_total', 'request_count'], granularity: 'day', time_range: {
                start: result.since, end: result.until,
            }, order_by: { field: 'date', direction: 'asc' }, limit: 1000,
        });
    });

    it('labels configured coverage honestly instead of claiming lifetime', async () => {
        const { fetcher } = sequence([openRouter(0)]);
        const result = await fetchOpenRouterUsage({ ...env,
            OPENROUTER_USAGE_SINCE: '2026-01-01' }, fetcher, () => NOW);
        expect(result).toMatchObject({ totalTokens: 0, period: 'Since 2026-01-01',
            since: '2026-01-01T00:00:00.000Z', until: '2026-10-28T00:00:00.000Z' });
        expect(JSON.stringify(result)).not.toContain('management-test');
    });

    it('counts inactive days in averages and breaks streaks across gaps and zeroes', async () => {
        const { fetcher } = sequence([dailyUsage([
            { date__day: '2026-10-27', tokens_total: '40', request_count: '4' },
            { date__day: '2026-10-23', tokens_total: 0, request_count: 0 },
            { date__day: '2026-10-25', tokens_total: '30', request_count: 3 },
            { date__day: '2026-10-22', tokens_total: 10, request_count: '1' },
            { date__day: '2026-10-24T00:00:00.000Z', tokens_total: '20',
                request_count: 2 },
        ])]);
        const result = await fetchOpenRouterUsage({ ...env,
            OPENROUTER_USAGE_SINCE: '2026-10-20' }, fetcher, NOW);
        expect(result).toMatchObject({ totalTokens: 100, totalPrompts: 10, summary: {
            averageDailyTokens: 12.5, averageWeeklyTokens: 87.5,
            longestStreakDays: 2,
        } });
        expect(result.scope).toContain('8 completed UTC days');
    });

    it('accepts a confirmed empty or all-zero report as zero usage', async () => {
        for (const response of [dailyUsage([]), dailyUsage([
            { date__day: '2026-10-01', tokens_total: 0, request_count: 0 },
        ])]) {
            const { fetcher } = sequence([response]);
            expect(await fetchOpenRouterUsage(env, fetcher, NOW)).toMatchObject({
                totalTokens: 0, totalPrompts: 0, summary: { averageDailyTokens: 0,
                    averageWeeklyTokens: 0, longestStreakDays: 0 },
            });
        }
    });

    it('uses the entire permitted window without capping or dropping days', async () => {
        const first = Date.parse('2025-10-26T00:00:00Z');
        const rows = Array.from({ length: 367 }, (_, index) => ({
            date__day: new Date(first + index * 86_400_000).toISOString().slice(0, 10),
            tokens_total: '1', request_count: '2',
        }));
        const { fetcher } = sequence([dailyUsage(rows)]);
        const result = await fetchOpenRouterUsage({ ...env,
            OPENROUTER_USAGE_SINCE: '2025-10-26T00:00:00Z' }, fetcher, NOW);
        expect(result).toMatchObject({ totalTokens: 367, totalPrompts: 734, summary: {
            averageDailyTokens: 1, averageWeeklyTokens: 7, longestStreakDays: 367,
        } });
    });

    it.each(['2025-10-25', '2026-10-28', '2026-10-27T01:00:00Z'])(
        'rejects an excessive or incomplete daily interval %s before requesting', async since => {
            const { fetcher, requests } = sequence([]);
            await expect(fetchOpenRouterUsage({ ...env,
                OPENROUTER_USAGE_SINCE: since }, fetcher, NOW)).rejects.toThrow();
            expect(requests).toHaveLength(0);
        },
    );

    it.each([undefined, '2026-02-30', '2026-10-01T01:00:00Z',
        '2026-10-01T00:00:00+00:00', '2026-10-28', '2025-10-25'])(
        'rejects malformed or out-of-window daily dates %s', async date => {
            const { fetcher } = sequence([dailyUsage([
                { date__day: date, tokens_total: 1, request_count: 1 },
            ])]);
            await expect(fetchOpenRouterUsage(env, fetcher, NOW)).rejects.toThrow('usage');
        },
    );

    it('rejects repeated days even when their timestamp representations differ', async () => {
        const { fetcher } = sequence([dailyUsage([
            { date__day: '2026-10-01', tokens_total: 1, request_count: 1 },
            { date__day: '2026-10-01T00:00:00Z', tokens_total: 2, request_count: 1 },
        ])]);
        await expect(fetchOpenRouterUsage(env, fetcher, NOW)).rejects.toThrow('repeated');
    });

    it('rejects overflow while adding otherwise valid daily counts', async () => {
        const { fetcher } = sequence([dailyUsage([
            { date__day: '2026-10-01', tokens_total: Number.MAX_SAFE_INTEGER,
                request_count: 1 },
            { date__day: '2026-10-02', tokens_total: 1, request_count: 1 },
        ])]);
        await expect(fetchOpenRouterUsage(env, fetcher, NOW)).rejects.toThrow('token count');
    });

    it.each([null, -1, 1.5, '1.5', 'NaN', Number.MAX_SAFE_INTEGER + 1])(
        'rejects malformed tokens %s', async tokens => {
            const { fetcher } = sequence([openRouter(tokens)]);
            await expect(fetchOpenRouterUsage(env, fetcher, NOW)).rejects.toThrow('token count');
        },
    );

    it.each([undefined, null, -1, 1.5, '1.5', 'NaN',
        Number.MAX_SAFE_INTEGER + 1, '9007199254740992'])(
        'rejects malformed or missing request counts %s', async requests => {
            const { fetcher } = sequence([dailyUsage([
                { date__day: '2026-10-01', tokens_total: '10',
                    request_count: requests },
            ])]);
            await expect(fetchOpenRouterUsage(env, fetcher, NOW)).rejects.toThrow('request count');
        },
    );

    it('rejects request-count overflow while daily token counts remain valid', async () => {
        const { fetcher } = sequence([dailyUsage([
            { date__day: '2026-10-01', tokens_total: 1,
                request_count: String(Number.MAX_SAFE_INTEGER) },
            { date__day: '2026-10-02', tokens_total: 0, request_count: '1' },
        ])]);
        await expect(fetchOpenRouterUsage(env, fetcher, NOW)).rejects.toThrow('request count');
    });

    it.each([
        { metadata: { row_count: 1, truncated: true } },
        { metadata: { row_count: 2, truncated: false } },
        { metadata: { row_count: 1 } },
        { data: undefined },
        { data: [{ tokens_total: '1' }, { tokens_total: '2' }] },
        { warnings: ['upstream-filter-warning'] },
        { data: Array.from({ length: 368 }, () => ({})),
            metadata: { row_count: 368, truncated: false } },
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
