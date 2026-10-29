import { describe, expect, it, vi } from 'vitest';
import { verifyWorkerOrigin, WorkerOriginError } from '../scripts/verify-worker-origin.mjs';

const account = 'a'.repeat(32);
const otherAccount = 'b'.repeat(32);
const token = 'isolated-cloudflare-auth-fixture';
const origin = 'https://codestats.owner.workers.dev';
const response = result => Response.json({ success: true, result });

function fixture(overrides = {}) {
    const who = overrides.who ?? { loggedIn: true, accounts: [{ id: account }] };
    const auth = overrides.auth ?? { type: 'oauth', token };
    const runWrangler = vi.fn(async args => args[0] === 'whoami' ? who : auth);
    const fetcher = vi.fn(async (input, init) => {
        const url = new URL(input);
        expect(url.origin).toBe('https://api.cloudflare.com');
        expect(url.pathname).toMatch(/^\/client\/v4\/accounts\/[a-f0-9]{32}\//);
        expect(init.method).toBe('GET');
        expect(init.redirect).toBe('manual');
        if (overrides.fetch) return overrides.fetch(url, init);
        if (url.pathname.endsWith('/workers/subdomain')) return response({ subdomain: 'owner' });
        return response({ enabled: true });
    });
    return { environment: overrides.environment ?? {}, runWrangler, fetcher,
        readConfig: async () => overrides.config ?? '{ // JSONC\n "name": "codestats",\n }' };
}

describe('automatic sync destination verification', () => {
    it.each(['{invalid', '{"name":["codestats"]}', '{"name":"../other"}'])(
        'rejects malformed local configuration before reading authentication %s', async config => {
            const options = fixture({ config });
            await expect(verifyWorkerOrigin(origin, options)).rejects.toThrow('verify this origin');
            expect(options.runWrangler).not.toHaveBeenCalled();
            expect(options.fetcher).not.toHaveBeenCalled();
        },
    );

    it('verifies the named deployed Worker in the authenticated account', async () => {
        const options = fixture();
        expect(await verifyWorkerOrigin(origin, options)).toEqual({
            accountId: account, workerName: 'codestats',
        });
        expect(options.runWrangler.mock.calls.map(call => call[0])).toEqual([
            ['whoami', '--json'], ['auth', 'token', '--json'],
        ]);
        expect(options.fetcher).toHaveBeenCalledTimes(2);
        expect(options.fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer ' + token);
    });

    it.each([
        'https://codestats.other-account.workers.dev',
        'https://different.owner.workers.dev',
        'https://preview-codestats.owner.workers.dev',
    ])('rejects another account, Worker or preview destination %s', async value => {
        const options = fixture();
        await expect(verifyWorkerOrigin(value, options)).rejects.toBeInstanceOf(WorkerOriginError);
        expect(options.fetcher).toHaveBeenCalledTimes(1);
    });

    it('rejects a disabled workers.dev endpoint', async () => {
        const options = fixture({ fetch: url => response(url.pathname.endsWith('/workers/subdomain')
            ? { subdomain: 'owner' } : { enabled: false, previews_enabled: true }) });
        await expect(verifyWorkerOrigin(origin, options)).rejects.toThrow('No secret was changed');
    });

    it('discovers one matching account and respects explicit account selection', async () => {
        const who = { loggedIn: true, accounts: [{ id: account }, { id: otherAccount }] };
        const automatic = fixture({ who, fetch: url => response(
            url.pathname.endsWith('/workers/subdomain')
                ? { subdomain: url.pathname.includes(otherAccount) ? 'another-owner' : 'owner' }
                : { enabled: true },
        ) });
        expect(await verifyWorkerOrigin(origin, automatic))
            .toEqual({ accountId: account, workerName: 'codestats' });
        expect(automatic.fetcher).toHaveBeenCalledTimes(3);
        for (const environment of [{ CLOUDFLARE_ACCOUNT_ID: account }, { CF_ACCOUNT_ID: account }]) {
            expect(await verifyWorkerOrigin(origin, fixture({ who, environment })))
                .toEqual({ accountId: account, workerName: 'codestats' });
        }
        expect(await verifyWorkerOrigin(origin, fixture({ who,
            config: JSON.stringify({ name: 'codestats', account_id: account }) })))
            .toEqual({ accountId: account, workerName: 'codestats' });
    });

    it('rejects ambiguous account mappings and bounds automatic account discovery', async () => {
        const ambiguous = fixture({ who: { loggedIn: true,
            accounts: [{ id: account }, { id: otherAccount }] } });
        await expect(verifyWorkerOrigin(origin, ambiguous)).rejects.toThrow('verify this origin');
        const excessive = fixture({ who: { loggedIn: true,
            accounts: Array.from({ length: 11 }, (_, index) => ({
                id: index.toString(16).padStart(32, '0'),
            })) } });
        await expect(verifyWorkerOrigin(origin, excessive)).rejects.toThrow('verify this origin');
        expect(excessive.runWrangler).toHaveBeenCalledTimes(1);
        expect(excessive.fetcher).not.toHaveBeenCalled();
    });

    it('rejects an account ID outside the authenticated account list', async () => {
        const options = fixture({ environment: { CLOUDFLARE_ACCOUNT_ID: otherAccount } });
        await expect(verifyWorkerOrigin(origin, options)).rejects.toThrow('verify this origin');
        expect(options.fetcher).not.toHaveBeenCalled();
    });

    it('accepts an actually enabled production custom domain for the same service', async () => {
        const options = fixture({ fetch: url => {
            expect(url.pathname).toBe('/client/v4/accounts/' + account + '/workers/domains');
            expect(Object.fromEntries(url.searchParams)).toEqual({
                hostname: 'stats.example.com', service: 'codestats',
                environment: 'production', enabled: 'true',
            });
            return response([{ hostname: 'stats.example.com', service: 'codestats',
                environment: 'production', enabled: true }]);
        } });
        expect(await verifyWorkerOrigin('https://stats.example.com', options))
            .toEqual({ accountId: account, workerName: 'codestats' });
    });

    it.each([
        { service: 'other' }, { enabled: false }, { environment: 'staging' },
        { hostname: 'different.example.com' },
    ])('rejects a mismatched custom domain binding %j', async mismatch => {
        const options = fixture({ fetch: () => response([{
            hostname: 'stats.example.com', service: 'codestats',
            environment: 'production', enabled: true, ...mismatch,
        }]) });
        await expect(verifyWorkerOrigin('https://stats.example.com', options))
            .rejects.toThrow('provide CODEX_SYNC_TOKEN');
    });

    it.each(['api_token', 'api_key'])('supports %s credentials only on the fixed API origin', async type => {
        const options = fixture({ auth: type === 'api_key'
            ? { type, key: token, email: 'fixture@example.com' } : { type, token } });
        await verifyWorkerOrigin(origin, options);
        const headers = options.fetcher.mock.calls[0][1].headers;
        expect(type === 'api_key' ? headers['X-Auth-Key'] : headers.Authorization)
            .toBe(type === 'api_key' ? token : 'Bearer ' + token);
    });

    it('never puts credential-bearing diagnostics in verification errors', async () => {
        const options = fixture();
        options.runWrangler.mockRejectedValue(new Error('private stdout ' + token));
        await expect(verifyWorkerOrigin(origin, options)).rejects.toThrow('verify this origin');
        try { await verifyWorkerOrigin(origin, options); }
        catch (error) { expect(error.message).not.toContain(token); }
        expect(options.fetcher).not.toHaveBeenCalled();
    });

    it.each([
        () => new Response('sensitive body', { status: 302,
            headers: { Location: 'https://untrusted.example/' } }),
        () => new Response('x'.repeat(128 * 1024 + 1)),
        () => new Response('invalid json'),
    ])('fails closed on redirects, oversized bodies and malformed JSON', async fetch => {
        const options = fixture({ fetch });
        await expect(verifyWorkerOrigin(origin, options)).rejects.toThrow('verify this origin');
        expect(options.fetcher).toHaveBeenCalledTimes(1);
    });
});
