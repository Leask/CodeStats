import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseEnv } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deployCi } from '../scripts/deploy-ci.mjs';

const directories = [];
const directory = async () => {
    const path = await mkdtemp(join(tmpdir(), 'codestats-ci-test-'));
    directories.push(path);
    return path;
};
afterEach(async () => {
    await Promise.all(directories.splice(0).map(path => rm(path,
        { recursive: true, force: true })));
});

function child(inspect, status = 0) {
    return vi.fn((...args) => {
        const process = new EventEmitter();
        queueMicrotask(async () => {
            try { await inspect(...args); }
            catch (error) { process.emit('error', error); return; }
            process.emit('close', status);
        });
        return process;
    });
}

describe('CI runtime environment forwarding', () => {
    it('does not offer the program-managed sync key as a deployment input', async () => {
        for (const name of ['.dev.vars.example', '.env.example']) {
            const sample = parseEnv(await readFile(new URL('../' + name,
                import.meta.url), 'utf8'));
            expect(sample).not.toHaveProperty('CODEX_SYNC_TOKEN');
        }
        const metadata = JSON.parse(await readFile(new URL('../package.json',
            import.meta.url), 'utf8'));
        expect(metadata.cloudflare.bindings).not.toHaveProperty('CODEX_SYNC_TOKEN');
    });

    it.each(['env', 'json'])('ignores legacy sync keys in Build and %s files to preserve the managed Worker key', async format => {
        const path = await directory();
        const filename = join(await directory(), 'legacy.' + format);
        const legacy = { CODEX_SYNC_TOKEN: 'stale-file-fixture' };
        await writeFile(filename, format === 'json' ? JSON.stringify(legacy)
            : 'CODEX_SYNC_TOKEN=' + legacy.CODEX_SYNC_TOKEN);
        const start = child(async (_binary, args, options) => {
            expect(args).not.toContain('--secrets-file');
            expect(args).toContain('--keep-vars');
            expect(options.env).not.toHaveProperty('CODEX_SYNC_TOKEN');
        });
        await deployCi({ temporaryDirectory: path, spawn: start,
            environment: { CODEX_SYNC_TOKEN: 'stale-build-fixture' },
            arguments: ['--secrets-file', filename] });
        expect(start).toHaveBeenCalledTimes(1);
        expect(await readdir(path)).toEqual([]);
    });

    it('uploads only allowlisted service secrets in a temporary private file', async () => {
        const path = await directory();
        const github = 'isolated-github-ci-fixture';
        const router = 'isolated-router-ci-fixture';
        let secretFile;
        const start = child(async (binary, args, options) => {
            expect(binary).toBe(process.execPath);
            expect(args).toContain('--keep-vars');
            secretFile = args[args.indexOf('--secrets-file') + 1];
            expect((await stat(dirname(secretFile))).mode & 0o777).toBe(0o700);
            expect((await stat(secretFile)).mode & 0o777).toBe(0o600);
            expect(JSON.parse(await readFile(secretFile, 'utf8'))).toEqual({
                GITHUB_TOKEN: github, OPENROUTER_API_KEY: router,
            });
            expect(args.join(' ')).not.toContain(github);
            expect(args.join(' ')).not.toContain(router);
            expect(args.join(' ')).not.toContain('CLOUDFLARE_API_TOKEN');
            expect(args).toContain('CODEX_USERNAME:owner');
            expect(args).toContain('WAKATIME_USERNAME:owner-time');
            expect(options.stdio).toEqual(['ignore', 'inherit', 'inherit']);
            expect(options.env.CLOUDFLARE_API_TOKEN).toBe('isolated-build-auth-fixture');
            expect(options.env.WRANGLER_LOG).toBe('info');
        });
        await deployCi({ temporaryDirectory: path, spawn: start, environment: {
            GITHUB_TOKEN: github, OPENROUTER_API_KEY: router,
            WAKATIME_TOKEN: '', CODEX_SYNC_TOKEN: ' ',
            CODEX_USERNAME: 'owner', WAKATIME_USERNAME: 'owner-time',
            CLOUDFLARE_API_TOKEN: 'isolated-build-auth-fixture',
            UNRELATED_SECRET: 'isolated-unrelated-fixture',
        } });
        expect(start).toHaveBeenCalledTimes(1);
        expect(await readdir(path)).toEqual([]);
        await expect(stat(secretFile)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('preserves existing runtime secrets when the build supplies no new values', async () => {
        const path = await directory();
        const start = child(async (_binary, args) => {
            expect(args).not.toContain('--secrets-file');
            expect(args).toContain('--keep-vars');
            expect(args).toContain('DEFAULT_RANGE:all_time');
        });
        await deployCi({ temporaryDirectory: path, spawn: start,
            environment: { GITHUB_TOKEN: ' ', DEFAULT_RANGE: 'all_time' } });
        expect(await readdir(path)).toEqual([]);
    });

    it.each(['env', 'json'])('merges an explicit %s file without putting secrets in argv or process.env', async format => {
        const path = await directory();
        const filename = join(await directory(), 'provider-secrets.' + format);
        const secrets = { GITHUB_TOKEN: 'explicit-file-fixture',
            ANTHROPIC_ADMIN_KEY: 'explicit-admin-fixture', WAKATIME_TOKEN: '' };
        await writeFile(filename, format === 'json' ? JSON.stringify(secrets)
            : Object.entries(secrets).map(([name, value]) => name + '=' + value).join('\n'));
        const start = child(async (_binary, args, options) => {
            const temporary = args[args.indexOf('--secrets-file') + 1];
            expect(JSON.parse(await readFile(temporary, 'utf8'))).toEqual({
                GITHUB_TOKEN: secrets.GITHUB_TOKEN,
                ANTHROPIC_ADMIN_KEY: secrets.ANTHROPIC_ADMIN_KEY,
                OPENROUTER_API_KEY: 'build-router-fixture',
            });
            expect(args).toContain('--dry-run');
            expect(args).not.toContain('--name');
            expect(args.join(' ')).not.toContain('explicit-file-fixture');
            expect(options.env.GITHUB_TOKEN).toBe('build-github-fixture');
            expect(options.env.ANTHROPIC_ADMIN_KEY).toBeUndefined();
            expect(options.env.WRANGLER_CI_OVERRIDE_NAME).toBe('customer-worker');
            expect(options.env.CLOUDFLARE_ACCOUNT_ID).toBe('isolated-account-fixture');
        });
        await deployCi({ temporaryDirectory: path, spawn: start,
            arguments: ['--dry-run', '--secrets-file', filename], environment: {
                GITHUB_TOKEN: 'build-github-fixture', OPENROUTER_API_KEY: 'build-router-fixture',
                WRANGLER_CI_OVERRIDE_NAME: 'customer-worker',
                CLOUDFLARE_ACCOUNT_ID: 'isolated-account-fixture',
            } });
        expect(start).toHaveBeenCalledTimes(1);
        expect(await readdir(path)).toEqual([]);
    });

    it('accepts an empty secrets sample without uploading placeholder or blank values', async () => {
        const path = await directory();
        const start = child(async (_binary, args) => {
            expect(args).not.toContain('--secrets-file');
        });
        await deployCi({ temporaryDirectory: path, spawn: start, environment: {},
            arguments: ['--secrets-file=.dev.vars.example'] });
        expect(start).toHaveBeenCalledTimes(1);
    });

    it('forwards deliberately cleared account names while omitting blank secrets', async () => {
        const start = child(async (_binary, args) => {
            for (const name of ['GITHUB_USERNAME', 'WAKATIME_USERNAME', 'CODEX_USERNAME']) {
                expect(args).toContain(name + ':');
            }
            expect(args).not.toContain('--secrets-file');
        });
        await deployCi({ spawn: start, environment: { GITHUB_USERNAME: '',
            WAKATIME_USERNAME: ' ', CODEX_USERNAME: '', GITHUB_TOKEN: '' } });
        expect(start).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['--secrets-file'], ['--secrets-file='], ['--unknown'],
        ['--var', 'GITHUB_TOKEN:isolated-fixture'],
        ['--dry-run', '--dry-run'],
    ])('rejects ambiguous or unsupported arguments before starting a deployment: %j', async args => {
        const path = await directory();
        const start = vi.fn();
        await expect(deployCi({ temporaryDirectory: path, spawn: start,
            environment: {}, arguments: args })).rejects.toThrow();
        expect(start).not.toHaveBeenCalled();
        expect(await readdir(path)).toEqual([]);
    });

    it('rejects build authentication in provider files without including its value in errors', async () => {
        const path = await directory();
        const filename = join(await directory(), 'invalid.json');
        await writeFile(filename, JSON.stringify({
            CLOUDFLARE_API_TOKEN: 'isolated-build-auth-value',
        }));
        const start = vi.fn();
        await expect(deployCi({ temporaryDirectory: path, spawn: start,
            environment: {}, arguments: ['--secrets-file', filename] }))
            .rejects.toThrow('only named provider secrets');
        expect(start).not.toHaveBeenCalled();
        expect(await readdir(path)).toEqual([]);
    });

    it.each(['exit', 'error'])('removes temporary secrets after a child %s', async failure => {
        const path = await directory();
        const start = failure === 'exit' ? child(async () => {}, 1) : vi.fn(() => {
            throw new Error('isolated-sensitive-diagnostic');
        });
        await expect(deployCi({ temporaryDirectory: path, spawn: start,
            environment: { GITHUB_TOKEN: 'isolated-ci-secret' } })).rejects.toThrow();
        expect(await readdir(path)).toEqual([]);
    });

    it.each(['waka_tok_accidentally_pasted',
        'waka_' + [8, 4, 4, 4, 12].map(width => '1'.repeat(width)).join('-')])(
        'rejects a credential accidentally placed in a public variable before spawning: %s', async value => {
        const path = await directory();
        const start = vi.fn();
        await expect(deployCi({ temporaryDirectory: path, spawn: start,
            environment: { CODEX_USERNAME: value } }))
            .rejects.toThrow('credential-like');
        expect(start).not.toHaveBeenCalled();
        expect(await readdir(path)).toEqual([]);
    });
});
