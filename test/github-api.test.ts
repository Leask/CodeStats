import { describe, expect, it } from 'vitest';
import { createGitHubClient } from '../src/github-api';
import type { Fetcher } from '../src/types';

const env = { GITHUB_USERNAME: 'test', GITHUB_TOKEN: 'fixture-only' };

describe('GitHub official API boundary', () => {
    it('accepts inherited read scopes without exposing headers in data', async () => {
        const client = createGitHubClient(env, (async () => Response.json({
            data: { viewer: { login: 'test' } },
        }, { headers: { 'x-oauth-scopes': 'repo, user, admin:org' } })) as Fetcher,
        { requiredScopes: ['repo', 'read:user', 'read:org'] });
        expect(await client.query('{viewer{login}}')).toEqual({
            viewer: { login: 'test' },
        });
    });

    it('rejects silent private coverage loss when profile scope is missing', async () => {
        const client = createGitHubClient(env, (async () => Response.json({
            data: { user: { contributionsCollection: { count: 0 } } },
        }, { headers: { 'x-oauth-scopes': 'repo' } })) as Fetcher,
        { requiredScopes: ['repo', 'read:user'] });
        await expect(client.query('{user{login}}')).rejects.toThrow('scopes');
    });

    it('rejects HTTP 200 SSO partial results before accepting data', async () => {
        const client = createGitHubClient(env, (async () => Response.json({
            total_count: 0, incomplete_results: false,
        }, { headers: { 'x-github-sso': 'partial-results; organizations=123' } })) as Fetcher);
        await expect(client.get('/search/commits?q=author:test'))
            .rejects.toThrow('SSO');
    });

    it('keeps credentials on the fixed origin and never follows redirects', async () => {
        const seen: string[] = [];
        const client = createGitHubClient(env, (async (url, init) => {
            seen.push(String(url));
            expect(init?.redirect).toBe('manual');
            return new Response(null, {
                status: 302, headers: { Location: 'https://untrusted.invalid/' },
            });
        }) as Fetcher);
        await expect(client.get('https://untrusted.invalid/'))
            .rejects.toThrow('origin');
        expect(seen).toHaveLength(0);
        await expect(client.get('/user')).rejects.toThrow('HTTP 302');
        expect(seen).toEqual(['https://api.github.com/user']);
    });

    it('honors server rate-limit cooldown and hides error response bodies', async () => {
        const client = createGitHubClient(env, (async () => new Response(
            'private-path-and-secret', {
                status: 429, headers: { 'Retry-After': '3600' },
            },
        )) as Fetcher);
        await expect(client.get('/user')).rejects.toMatchObject({
            message: 'GitHub API returned HTTP 429.', retryAfterSeconds: 3600,
        });
    });
});
