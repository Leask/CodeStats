import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyWorkerOrigin } from './verify-worker-origin.mjs';

export class SyncTokenError extends Error {}

const project = fileURLToPath(new URL('../', import.meta.url));
const wrangler = join(project, 'node_modules/wrangler/bin/wrangler.js');

/** Send a generated secret through stdin, never command arguments or logs. */
export function installWorkerSecret(token, target, start = spawn) {
    if (typeof target?.accountId !== 'string' || typeof target?.workerName !== 'string'
        || !/^[a-f0-9]{32}$/i.test(target.accountId)
        || !/^[a-z0-9_-]{1,63}$/i.test(target?.workerName)) {
        throw new SyncTokenError('The Worker destination must be verified before setting its key.');
    }
    return new Promise((accept, reject) => {
        const failed = () => reject(new SyncTokenError(
            'Could not set the Worker sync secret. Verify the deployed Worker '
            + 'and npx wrangler login, then retry; its generated key is retained.',
        ));
        const child = start(process.execPath, [
            wrangler, 'secret', 'put', 'CODEX_SYNC_TOKEN',
            '--config', join(project, 'wrangler.jsonc'),
            '--name', target.workerName,
        ], {
            cwd: project, timeout: 90_000,
            env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: target.accountId,
                CI: 'true', WRANGLER_SEND_METRICS: 'false' },
            stdio: ['pipe', 'ignore', 'ignore'],
        });
        child.once('error', failed);
        child.once('close', code => code === 0 ? accept() : failed());
        child.stdin.on('error', () => {});
        child.stdin.end(token + '\n');
    });
}

function owned(file) {
    return !process.getuid || file.uid === process.getuid();
}

async function readRecord(filename, origin) {
    const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const file = await handle.stat();
        if (!file.isFile() || !owned(file) || (file.mode & 0o077) || file.size > 4096) {
            throw new SyncTokenError('The saved sync key must be an owned private file (0600).');
        }
        let record;
        try { record = JSON.parse(await handle.readFile('utf8')); }
        catch { throw new SyncTokenError('The saved sync key is invalid; it was not replaced.'); }
        if (record?.origin !== origin) {
            throw new SyncTokenError('The saved sync key belongs to another origin; '
                + 'use its original destination or provide CODEX_SYNC_TOKEN.');
        }
        if (!/^[a-f0-9]{64}$/.test(record?.token)
            || typeof record.installed !== 'boolean') {
            throw new SyncTokenError('The saved sync key is invalid; it was not replaced.');
        }
        return record;
    } finally {
        await handle.close();
    }
}

/** First sync bootstraps its key; later syncs reuse it without a redeploy. */
export async function syncToken(origin, options = {}) {
    const environment = options.environment ?? process.env;
    const configured = environment.CODEX_SYNC_TOKEN;
    if (configured) {
        if (configured.trim().length < 32 || /[\r\n]/.test(configured)) {
            throw new SyncTokenError('CODEX_SYNC_TOKEN must have at least 32 characters.');
        }
        return configured.trim();
    }
    if (new URL(origin).protocol !== 'https:') {
        throw new SyncTokenError('Automatic key setup requires a deployed HTTPS Worker; '
            + 'configure CODEX_SYNC_TOKEN for local or Node-only imports.');
    }
    const directory = resolve(options.directory ?? environment.CODESTATS_DATA_DIR ?? '.data');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const parent = await lstat(directory);
    if (!parent.isDirectory() || parent.isSymbolicLink()
        || !owned(parent) || (parent.mode & 0o077)) {
        throw new SyncTokenError('The sync key directory must be owned and private (0700).');
    }
    const filename = join(directory, 'codex-sync.json');
    let record;
    let verified;
    try {
        record = await readRecord(filename, origin);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        verified = await (options.verify ?? verifyWorkerOrigin)(origin);
        record = { origin, token: randomBytes(32).toString('hex'), installed: false };
        let handle;
        try {
            handle = await open(filename, 'wx', 0o600);
            await handle.writeFile(JSON.stringify(record) + '\n');
            await handle.sync();
        } catch (failure) {
            if (failure.code !== 'EEXIST') throw failure;
            record = await readRecord(filename, origin);
        } finally {
            await handle?.close();
        }
    }
    if (!record.installed) {
        verified ??= await (options.verify ?? verifyWorkerOrigin)(origin);
        await (options.install ?? installWorkerSecret)(record.token, verified);
        const temporary = filename + '.' + randomUUID();
        try {
            await writeFile(temporary, JSON.stringify({ ...record, installed: true }) + '\n',
                { mode: 0o600, flag: 'wx' });
            await rename(temporary, filename);
        } finally {
            await rm(temporary, { force: true });
        }
    }
    return record.token;
}
