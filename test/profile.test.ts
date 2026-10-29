import { describe, expect, it } from 'vitest';
import {
    canonicalCodexUrl, PRIMARY_SOURCES, publicProfileIdentity,
    publicSettings, resolveProfile,
} from '../src/profile';
import type { Settings } from '../src/types';

const settings: Settings = {
    GITHUB_USERNAME: 'Owner', WAKATIME_USERNAME: 'Owner_Time',
    CODEX_USERNAME: 'Owner.Codex', CODEX_USAGE_ENABLED: 'true',
    GITHUB_TOKEN: 'fixture-github-secret', WAKATIME_TOKEN: 'fixture-waka-secret',
    OPENROUTER_API_KEY: 'fixture-openrouter-secret',
    ANTHROPIC_ADMIN_KEY: 'fixture-anthropic-secret',
    CODEX_SYNC_TOKEN: 'fixture-codex-sync-secret',
    GITHUB_VISIBILITY: 'all',
    GITHUB_REPOSITORY_AFFILIATIONS: 'OWNER,COLLABORATOR,ORGANIZATION_MEMBER',
    GITHUB_INCLUDE_FORKS: 'false', GITHUB_INCLUDE_OWN_CONTRIBUTIONS: 'false',
    DEFAULT_RANGE: 'all_time', FRESH_SECONDS: '21600', RETRY_SECONDS: '900',
};
const url = (query = '') => new URL('https://stats.example.com/' + query);

describe('configured and public profile selection', () => {
    it('preserves configured accounts and all enabled primary services', () => {
        expect(resolveProfile(url(), settings)).toEqual({
            mode: 'configured', sources: [...PRIMARY_SOURCES],
            accounts: { github: 'owner', wakatime: 'owner_time', codex: 'Owner.Codex' },
        });
    });

    it('supports legacy Codex flag and token-only configurations without inventing IDs', () => {
        const value = resolveProfile(url(), {
            ...settings, GITHUB_USERNAME: '', WAKATIME_USERNAME: '',
            CODEX_USERNAME: undefined,
        });
        expect(value.accounts).toEqual({});
        expect(value.sources).toEqual([...PRIMARY_SOURCES]);
    });

    it('supports an unconfigured neutral deployment', () => {
        expect(resolveProfile(url(), {
            GITHUB_USERNAME: '', WAKATIME_USERNAME: '', DEFAULT_RANGE: 'all_time',
            FRESH_SECONDS: '21600', RETRY_SECONDS: '900',
        })).toEqual({ mode: 'configured', accounts: {}, sources: [] });
    });

    it('infers Codex from its ID or sync secret and honors an explicit opt-out', () => {
        const automatic = { ...settings, CODEX_USAGE_ENABLED: undefined };
        expect(resolveProfile(url(), { ...automatic, CODEX_SYNC_TOKEN: undefined })
            .sources).toContain('codex');
        expect(resolveProfile(url(), { ...automatic, CODEX_USERNAME: undefined })
            .sources).toContain('codex');
        expect(resolveProfile(url(), { ...automatic, CODEX_USAGE_ENABLED: 'false' })
            .sources).not.toContain('codex');
        expect(resolveProfile(url(), { ...automatic, CODEX_USERNAME: undefined,
            CODEX_SYNC_TOKEN: undefined }).sources).not.toContain('codex');
    });

    it('enters isolated public mode even for an account matching the owner', () => {
        const selected = resolveProfile(url('?github=OWNER'), settings);
        expect(selected).toEqual({
            mode: 'public', accounts: { github: 'owner' }, sources: ['github'],
        });
        expect(publicProfileIdentity(selected)).not.toBe('public-v1:owner:owner_time');
    });

    it('canonicalizes public IDs without inheriting omitted owner accounts', () => {
        expect(resolveProfile(url('?wakatime=%20%40Other_Time%20&codex=%40New.User'), settings))
            .toEqual({ mode: 'public', accounts: {
                wakatime: 'other_time', codex: 'New.User',
            }, sources: ['wakatime', 'codex'] });
    });

    it('accepts WakaTime UUID identifiers', () => {
        const id = '01234567-ABCD-4567-890A-123456789ABC';
        expect(resolveProfile(url('?wakatime=' + id), settings).accounts.wakatime)
            .toBe(id.toLowerCase());
    });

    it('allows explicit unavailable masks without authorizing owner data', () => {
        const selected = resolveProfile(url('?github=visitor&sources=openrouter,codex'), settings);
        expect(selected.sources).toEqual(['codex', 'openrouter']);
        expect(publicSettings(settings, selected)).not.toHaveProperty('OPENROUTER_API_KEY');
        expect(publicSettings(settings, selected).CODEX_USAGE_ENABLED).toBe('false');
    });

    it('orders source masks consistently without changing configured mode', () => {
        expect(resolveProfile(url('?sources=%20CODEX%20,github'), settings))
            .toMatchObject({ mode: 'configured', sources: ['github', 'codex'] });
    });

    it.each(['', ' ', 'github,', ',codex', 'github,,codex', 'github,github',
        'GitHub,github', 'unknown', 'anthropic'])(
        'rejects an invalid explicit source mask %j', value => {
            const target = url(); target.searchParams.set('sources', value);
            expect(() => resolveProfile(target, settings)).toThrow('Sources');
        },
    );

    it.each(['github=one&github=two', 'sources=github&sources=codex',
        'GitHub=visitor', 'github=visitor&GitHub=other'])(
        'rejects ambiguous selector parameters %s', query => {
            expect(() => resolveProfile(url('?' + query), settings))
                .toThrow('parameters');
        },
    );

    it.each([
        ['github', ''], ['github', '-user'], ['github', 'user-'],
        ['github', 'two--hyphens'], ['github', 'a'.repeat(40)],
        ['wakatime', ''], ['wakatime', 'a'.repeat(65)],
        ['wakatime', '_leading'], ['codex', ''], ['codex', '.'], ['codex', '..'],
        ['codex', 'a'.repeat(65)], ['codex', '你好'],
        ['github', 'https://github.com/user'], ['wakatime', 'user/path'],
        ['codex', 'https://chatgpt.com/u/user'], ['codex', 'user/path'],
        ['codex', 'user?query'], ['codex', 'user#fragment'], ['codex', '@@user'],
        ['codex', 'fixture user'], ['wakatime', 'waka_tok_accidentally_pasted'],
        ['wakatime', 'waka_00000000-0000-0000-0000-000000000000'],
        ['wakatime', 'github_pat_accidentally_pasted'],
    ])('rejects malformed %s account input', (service, value) => {
        const target = url(); target.searchParams.set(service, value);
        expect(() => resolveProfile(target, settings)).toThrow('invalid');
    });

    it.each(['token', 'api_key', 'apikey', 'access_token', 'github_token',
        'wakatimeToken', 'OPENROUTER_API_KEY', 'codex_sync_token',
        'client-secret', 'authorization', 'privateKey'])(
        'rejects credential query parameter %s without echoing its value', name => {
            const target = url(); target.searchParams.set(name, 'private-fixture-value');
            let message = '';
            try { resolveProfile(target, settings); }
            catch (error) { message = (error as Error).message; }
            expect(message).toContain('server configuration');
            expect(message).not.toContain('private-fixture-value');
        },
    );
});

describe('public cache and settings isolation', () => {
    it('shares identity across source masks and rendering parameters', () => {
        const first = resolveProfile(url('?github=Visitor&wakatime=Other&sources=github'
            + '&view=github&theme=dark'), settings);
        const second = resolveProfile(url('?wakatime=OTHER&github=visitor&sources=wakatime'
            + '&view=overview&sort=time&preview=123'), settings);
        expect(publicProfileIdentity(first)).toBe(publicProfileIdentity(second));
        expect(publicProfileIdentity(first)).toBe(
            'public-query:v1:["visitor","other",null]',
        );
    });

    it('separates accounts, providers and case-sensitive Codex handles', () => {
        const identities = ['?github=alice', '?github=bob', '?wakatime=alice',
            '?codex=alice', '?codex=Alice', '?github=alice&wakatime=bob']
            .map(query => publicProfileIdentity(resolveProfile(url(query), settings)));
        expect(new Set(identities).size).toBe(identities.length);
    });

    it('never treats configured selections or empty identities as public caches', () => {
        expect(() => publicProfileIdentity(resolveProfile(url(), settings)))
            .toThrow('public profile');
        expect(() => publicProfileIdentity({ mode: 'public', accounts: {}, sources: [] }))
            .toThrow('at least one');
    });

    it('whitelists public settings and leaves both inputs unchanged', () => {
        const selected = resolveProfile(url('?github=visitor&codex=Public.ID'), settings);
        const originalEnv = structuredClone(settings);
        const originalSelection = structuredClone(selected);
        const result = publicSettings(settings, selected);
        expect(result).toEqual({
            GITHUB_USERNAME: 'visitor', WAKATIME_USERNAME: '',
            CODEX_USERNAME: 'Public.ID', CODEX_USAGE_ENABLED: 'true',
            GITHUB_VISIBILITY: 'public', GITHUB_REPOSITORY_AFFILIATIONS: 'OWNER',
            GITHUB_INCLUDE_FORKS: 'false', GITHUB_INCLUDE_OWN_CONTRIBUTIONS: 'false',
            DEFAULT_RANGE: 'all_time', FRESH_SECONDS: '21600', RETRY_SECONDS: '900',
        });
        expect(JSON.stringify(result)).not.toContain('secret');
        for (const name of ['GITHUB_TOKEN', 'WAKATIME_TOKEN', 'CODEX_SYNC_TOKEN',
            'OPENROUTER_API_KEY', 'ANTHROPIC_ADMIN_KEY']) {
            expect(result).not.toHaveProperty(name);
        }
        expect(settings).toEqual(originalEnv);
        expect(selected).toEqual(originalSelection);
    });

    it('constructs only the canonical public Codex host from an ID', () => {
        expect(canonicalCodexUrl(' @Some.User_1-2 '))
            .toBe('https://chatgpt.com/u/Some.User_1-2');
        expect(() => canonicalCodexUrl('https://other.invalid/u/user'))
            .toThrow('Codex ID');
        expect(() => canonicalCodexUrl('../account')).toThrow('Codex ID');
    });
});
