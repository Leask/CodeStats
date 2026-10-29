import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
