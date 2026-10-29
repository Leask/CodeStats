import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installWorkerSecret, syncToken } from '../scripts/codex-sync-token.mjs';

const directories = [];
const origin = 'https://fixture.workers.dev';
const target = { accountId: 'a'.repeat(32), workerName: 'fixture' };
const verify = async () => target;
const directory = async () => {
    const path = await mkdtemp(join(tmpdir(), 'codestats-sync-key-'));
    directories.push(path);
    return path;
};
afterEach(async () => {
    await Promise.all(directories.splice(0).map(path => rm(path,
        { recursive: true, force: true })));
});

describe('runtime Codex sync keys', () => {
    it('creates and installs one private key, then reuses it without another deploy', async () => {
        const path = await directory();
        const install = vi.fn(async () => {});
        const checked = vi.fn(verify);
        const options = { directory: path, environment: {}, install, verify: checked };
        const first = await syncToken(origin, options);
        expect(first).toMatch(/^[a-f0-9]{64}$/);
        expect(install).toHaveBeenCalledExactlyOnceWith(first, target);
        const files = await readdir(path);
        expect(files).toHaveLength(1);
        const saved = join(path, files[0]);
        expect((await stat(saved)).mode & 0o777).toBe(0o600);
        expect(JSON.parse(await readFile(saved, 'utf8'))).toEqual({
            origin, token: first, installed: true,
        });
        expect(await syncToken(origin, options)).toBe(first);
        expect(install).toHaveBeenCalledTimes(1);
        expect(checked).toHaveBeenCalledTimes(1);
    });

    it('retains the generated key after failed setup and retries it next time', async () => {
        const path = await directory();
        const install = vi.fn().mockRejectedValueOnce(new Error('fixture failure'))
            .mockResolvedValue(undefined);
        const options = { directory: path, environment: {}, install, verify };
        await expect(syncToken(origin, options)).rejects.toThrow('fixture failure');
        const saved = JSON.parse(await readFile(join(path, (await readdir(path))[0]), 'utf8'));
        expect(saved.installed).toBe(false);
        expect(await syncToken(origin, options)).toBe(saved.token);
        expect(install.mock.calls.map(call => call[0])).toEqual([saved.token, saved.token]);
    });

    it('keeps explicitly supplied keys and never invokes Wrangler for them', async () => {
        const path = await directory();
        const token = 'manual-fixture-sync-secret'.repeat(2);
        const install = vi.fn();
        expect(await syncToken(origin, { directory: path, install,
            environment: { CODEX_SYNC_TOKEN: token } })).toBe(token);
        expect(await readdir(path)).toEqual([]);
        expect(install).not.toHaveBeenCalled();
        await expect(syncToken(origin, { directory: path, install,
            environment: { CODEX_SYNC_TOKEN: 'short' } })).rejects.toThrow('32 characters');
    });

    it('never silently rotates the configured Worker for a different origin', async () => {
        const path = await directory();
        const install = vi.fn(async () => {});
        const options = { directory: path, environment: {}, install, verify };
        const first = await syncToken(origin, options);
        await expect(syncToken('https://second-fixture.workers.dev', options))
            .rejects.toThrow('another origin');
        expect(await syncToken(origin, options)).toBe(first);
        expect(install).toHaveBeenCalledTimes(1);
        expect(await readdir(path)).toHaveLength(1);
    });

    it('does not replace unsafe or corrupt saved files or follow a linked directory', async () => {
        const path = await directory();
        const options = { directory: path, environment: {}, verify,
            install: vi.fn(async () => {}) };
        await syncToken(origin, options);
        const saved = join(path, (await readdir(path))[0]);
        await chmod(saved, 0o644);
        await expect(syncToken(origin, options)).rejects.toThrow('private file');
        await chmod(saved, 0o600);
        await writeFile(saved, '{invalid-fixture');
        await expect(syncToken(origin, options)).rejects.toThrow('was not replaced');
        expect(await readFile(saved, 'utf8')).toBe('{invalid-fixture');
        const link = join(await directory(), 'linked');
        await symlink(path, link);
        await expect(syncToken(origin, { ...options, directory: link }))
            .rejects.toThrow('private (0700)');
        expect(options.install).toHaveBeenCalledTimes(1);
    });

    it('requires explicit configuration for local and Node-only destinations', async () => {
        const install = vi.fn();
        await expect(syncToken('http://127.0.0.1:8791', { environment: {}, install }))
            .rejects.toThrow('deployed HTTPS Worker');
        expect(install).not.toHaveBeenCalled();
    });

    it('passes the secret to Wrangler only over stdin with output suppressed', async () => {
        const child = new EventEmitter();
        child.stdin = new PassThrough();
        const token = 'isolated-child-sync-fixture'.repeat(2);
        const chunks = [];
        child.stdin.on('data', chunk => chunks.push(chunk));
        const start = vi.fn(() => child);
        const pending = installWorkerSecret(token, target, start);
        child.emit('close', 0);
        await pending;
        const [binary, args, options] = start.mock.calls[0];
        expect(binary).toBe(process.execPath);
        expect(args.slice(1, 4)).toEqual(['secret', 'put', 'CODEX_SYNC_TOKEN']);
        expect(args.join(' ')).not.toContain(token);
        expect(Buffer.concat(chunks).toString()).toBe(token + '\n');
        expect(options.stdio).toEqual(['pipe', 'ignore', 'ignore']);
        expect(options.env.CI).toBe('true');
        expect(options.env.CLOUDFLARE_ACCOUNT_ID).toBe(target.accountId);
        expect(args.slice(-2)).toEqual(['--name', target.workerName]);
    });

    it('reports Wrangler failure without exposing child diagnostics', async () => {
        const child = new EventEmitter();
        child.stdin = new PassThrough();
        const pending = installWorkerSecret('fixture', target, () => child);
        child.emit('close', 1);
        await expect(pending).rejects.toThrow('wrangler login');
    });

    it('never creates a key or changes a Worker when first-run target verification fails', async () => {
        const path = await directory();
        const install = vi.fn();
        await expect(syncToken('https://wrong-fixture.workers.dev', {
            directory: path, environment: {}, install,
            verify: async () => { throw new Error('Worker does not match the origin.'); },
        })).rejects.toThrow('does not match');
        expect(await readdir(path)).toEqual([]);
        expect(install).not.toHaveBeenCalled();
    });
});
