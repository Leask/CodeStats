import { describe, expect, it } from 'vitest';
import { fetchWakaTime, resolveWakaTimeUsername } from '../src/wakatime';
import type { Fetcher } from '../src/types';

const TOKEN = 'fixture-oauth-token';
const USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const env = { WAKATIME_USERNAME: 'leask', WAKATIME_TOKEN: TOKEN };
const stats = {
    range: 'all_time', status: 'ok', is_up_to_date: true,
    is_including_today: false, percent_calculated: 100,
    total_seconds_including_other_language: 100,
    daily_average_including_other_language: 10,
    languages: [{ name: 'Other', total_seconds: 100, percent: 100 }],
};
const json = (data: unknown) => Response.json({ data });
const owner = () => json({ username: 'leask', id: USER_ID,
    email: 'private-fixture@example.invalid' });

function sequence(responses: Array<Response | Error>) {
    const requests: Array<{ url: URL; headers: Headers; redirect?: string }> = [];
    const fetcher = (async (input, init) => {
        requests.push({
            url: new URL(String(input)), headers: new Headers(init?.headers),
            redirect: init?.redirect,
        });
        const response = responses.shift();
        if (!response) throw new Error('Unexpected request.');
        if (response instanceof Error) throw response;
        return response;
    }) as Fetcher;
    return { fetcher, requests };
}

describe('WakaTime public-first OAuth fallback', () => {
    it('prefers complete public data even when an OAuth token is configured', async () => {
        const { fetcher, requests } = sequence([json(stats)]);
        const result = await fetchWakaTime(env, 'all_time', fetcher);
        expect(result).toMatchObject({ totalSeconds: 100, accessMode: 'public' });
        expect(requests).toHaveLength(1);
        expect(requests[0].headers.has('authorization')).toBe(false);
        expect(requests[0].url.pathname).toBe('/api/v1/users/leask/stats/all_time');
    });

    it.each([400, 401, 403, 404, 202])(
        'uses only the same explicit range after public HTTP %s', async status => {
            const { fetcher, requests } = sequence([
                new Response('private-error-body', { status }), owner(),
                json({ ...stats, range: 'last_30_days', username: 'leask', user_id: USER_ID }),
            ]);
            const result = await fetchWakaTime(env, 'last_30_days', fetcher);
            expect(result).toMatchObject({ range: 'last_30_days', accessMode: 'oauth' });
            expect(requests.map(request => request.url.pathname)).toEqual([
                '/api/v1/users/leask/stats/last_30_days', '/api/v1/users/current',
                '/api/v1/users/leask/stats/last_30_days',
            ]);
            expect(requests[0].headers.has('authorization')).toBe(false);
            expect(requests.slice(1).every(request => request.headers.get('authorization')
                === `Bearer ${TOKEN}`)).toBe(true);
            expect(requests.every(request => request.url.origin === 'https://api.wakatime.com'
                && !request.url.toString().includes(TOKEN)
                && request.redirect === 'manual')).toBe(true);
            expect(JSON.stringify(result)).not.toMatch(/private-fixture|fixture-oauth-token/);
        },
    );

    it.each([
        { ...stats, is_up_to_date: false },
        { ...stats, range: 'last_7_days' },
        { ...stats, languages: [] },
    ])('falls back from invalid or pending public data without merging payloads', async value => {
        const { fetcher, requests } = sequence([json(value), owner(), json(stats)]);
        const result = await fetchWakaTime(env, 'all_time', fetcher);
        expect(result).toMatchObject({ totalSeconds: 100, accessMode: 'oauth' });
        expect(requests).toHaveLength(3);
        expect(result.languages).toEqual([{ name: 'Other', seconds: 100, percent: 100 }]);
    });

    it('rejects a different token owner before requesting authorized statistics', async () => {
        const { fetcher, requests } = sequence([
            new Response(null, { status: 403 }), json({ username: 'another', id: USER_ID }),
        ]);
        await expect(fetchWakaTime(env, 'all_time', fetcher))
            .rejects.toThrow('different account');
        expect(requests).toHaveLength(2);
    });

    it('accepts a UUID target only when it belongs to the OAuth owner', async () => {
        const { fetcher } = sequence([
            new Response(null, { status: 400 }), owner(),
            json({ ...stats, username: 'leask', user_id: USER_ID }),
        ]);
        const result = await fetchWakaTime({ ...env, WAKATIME_USERNAME: USER_ID },
            'all_time', fetcher);
        expect(result).toMatchObject({ username: USER_ID, accessMode: 'oauth' });
        const mismatch = sequence([
            new Response(null, { status: 400 }), owner(),
        ]);
        await expect(fetchWakaTime({ ...env,
            WAKATIME_USERNAME: '11111111-2222-3333-4444-555555555555',
        }, 'all_time', mismatch.fetcher)).rejects.toThrow('different account');
    });

    it('rejects mismatched account metadata in otherwise valid authorized statistics', async () => {
        const { fetcher } = sequence([
            new Response(null, { status: 400 }), owner(),
            json({ ...stats, username: 'another' }),
        ]);
        await expect(fetchWakaTime(env, 'all_time', fetcher))
            .rejects.toThrow('account identity changed');
    });

    it.each([
        new Response('secret-error-body', { status: 429, headers: { 'Retry-After': '120' } }),
        new Response('secret-error-body', { status: 403,
            headers: { 'X-RateLimit-Remaining': '0', 'Retry-After': '120' } }),
    ])('does not bypass public rate limiting through OAuth', async response => {
        const { fetcher, requests } = sequence([response]);
        await expect(fetchWakaTime(env, 'all_time', fetcher)).rejects.toMatchObject({
            message: 'WakaTime rate limit reached.', retryAfterSeconds: 120,
        });
        expect(requests).toHaveLength(1);
    });

    it.each([
        new Error('unsafe-network-secret'), new Response('secret', { status: 503 }),
        new Response('secret', { status: 302,
            headers: { Location: 'https://untrusted.invalid/' } }),
    ])('retains transient or redirect failures without trying OAuth', async response => {
        const { fetcher, requests } = sequence([response]);
        const error = await fetchWakaTime(env, 'all_time', fetcher).catch(error => error);
        expect(error.message).not.toMatch(/unsafe|secret|untrusted/);
        expect(requests).toHaveLength(1);
    });

    it.each([
        { ...stats, range: 'last_7_days' },
        { ...stats, is_up_to_date: false },
        { ...stats, is_including_today: null },
        { ...stats, languages: [] },
    ])('rejects unusable fallback data so the caller retains its last good snapshot', async data => {
        const { fetcher, requests } = sequence([
            new Response(null, { status: 400 }), owner(), json(data),
        ]);
        await expect(fetchWakaTime(env, 'all_time', fetcher)).rejects.toThrow('WakaTime');
        expect(requests).toHaveLength(3);
        expect(requests.filter(request => request.url.pathname.endsWith('/all_time')))
            .toHaveLength(2);
    });

    it('sanitizes failures from both sources', async () => {
        const { fetcher } = sequence([
            new Response('private-range-secret', { status: 400 }), owner(),
            new Response('private-token-secret', { status: 401 }),
        ]);
        const error = await fetchWakaTime(env, 'all_time', fetcher).catch(error => error);
        expect(error.message).not.toMatch(/private-range|private-token|fixture-oauth/);
    });

    it.each([
        new Response('{not-json'),
        new Response('{}', { headers: { 'Content-Length': String(3 * 1024 * 1024) } }),
    ])('bounds invalid public bodies before trying the owner-authorized fallback', async response => {
        const { fetcher, requests } = sequence([response, owner(), json(stats)]);
        await expect(fetchWakaTime(env, 'all_time', fetcher))
            .resolves.toMatchObject({ accessMode: 'oauth' });
        expect(requests).toHaveLength(3);
    });

    it('does not treat an interrupted public response as deliberate unavailability', async () => {
        const interrupted = new Response(new ReadableStream({
            start(controller) { controller.error(new Error('unsafe-stream-secret')); },
        }));
        const { fetcher, requests } = sequence([interrupted]);
        await expect(fetchWakaTime(env, 'all_time', fetcher))
            .rejects.toThrow('response failed or timed out');
        expect(requests).toHaveLength(1);
    });
});

describe('WakaTime token-only identity', () => {
    it('does not fetch identity when a valid explicit username is configured', async () => {
        const { fetcher, requests } = sequence([]);
        await expect(resolveWakaTimeUsername(env, fetcher)).resolves.toBe('leask');
        expect(requests).toHaveLength(0);
    });

    it('accepts ordinary usernames beginning with waka_', async () => {
        const { fetcher, requests } = sequence([]);
        await expect(resolveWakaTimeUsername({ WAKATIME_USERNAME: 'waka_user' }, fetcher))
            .resolves.toBe('waka_user');
        expect(requests).toHaveLength(0);
    });

    it.each([
        { username: 'leask', id: USER_ID },
        { username: null, user_id: USER_ID },
        { username: '', id: USER_ID },
        { id: USER_ID },
    ])('resolves a token-only cache identity from the official current-user endpoint', async data => {
        const { fetcher, requests } = sequence([json(data)]);
        const expected = data.username || USER_ID;
        await expect(resolveWakaTimeUsername({ ...env, WAKATIME_USERNAME: '' }, fetcher))
            .resolves.toBe(expected);
        expect(requests[0].url.pathname).toBe('/api/v1/users/current');
        expect(requests[0].headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    });

    it('fetches token-only public data after resolving its owner and retains public precedence', async () => {
        const { fetcher, requests } = sequence([owner(), json(stats)]);
        await expect(fetchWakaTime({ ...env, WAKATIME_USERNAME: '' }, 'all_time', fetcher))
            .resolves.toMatchObject({ username: 'leask', accessMode: 'public' });
        expect(requests).toHaveLength(2);
        expect(requests[1].headers.has('authorization')).toBe(false);
    });

    it('reuses token-only owner verification for the same-range OAuth fallback', async () => {
        const { fetcher, requests } = sequence([
            owner(), new Response(null, { status: 403 }), json(stats),
        ]);
        await expect(fetchWakaTime({ ...env, WAKATIME_USERNAME: '' }, 'all_time', fetcher))
            .resolves.toMatchObject({ username: 'leask', accessMode: 'oauth' });
        expect(requests).toHaveLength(3);
    });

    it.each(['https://wakatime.com/@leask', '../user', 'waka_tok_accidental-secret',
        `waka_${USER_ID}`])
        ('rejects invalid or credential-like usernames before requesting them', async username => {
            const { fetcher, requests } = sequence([]);
            await expect(resolveWakaTimeUsername({ ...env,
                WAKATIME_USERNAME: username }, fetcher)).rejects.toThrow('username');
            expect(requests).toHaveLength(0);
        });

    it.each([{}, { username: '../unsafe' }, { username: 'leask', id: 42 }])
        ('rejects incomplete or malformed owner metadata', async data => {
            const { fetcher } = sequence([json(data)]);
            await expect(resolveWakaTimeUsername({ ...env, WAKATIME_USERNAME: '' }, fetcher))
                .rejects.toThrow('WakaTime');
        });

    it('rejects missing identity and credentials before any request', async () => {
        const { fetcher, requests } = sequence([]);
        await expect(resolveWakaTimeUsername({ WAKATIME_USERNAME: '' }, fetcher))
            .rejects.toThrow('username or OAuth token is required');
        expect(requests).toHaveLength(0);
    });
});
