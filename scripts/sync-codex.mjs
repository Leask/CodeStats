import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

class SyncError extends Error {}

/** Keep the bridge secret out of remote URLs, redirects and process arguments. */
function destination(value) {
    let target;
    try {
        target = new URL(value);
    } catch {
        throw new SyncError('Provide the CodeStats HTTPS origin as the argument.');
    }
    const loopback = target.hostname === 'localhost'
        || target.hostname === '[::1]'
        || /^127(?:\.\d{1,3}){3}$/.test(target.hostname);
    if ((target.protocol !== 'https:' && !(target.protocol === 'http:' && loopback))
        || target.username || target.password || target.pathname !== '/'
        || target.search || target.hash) {
        throw new SyncError('Use an HTTPS origin, or HTTP on localhost only.');
    }
    return new URL('/api/usage/codex', target);
}

async function main() {
    if (process.argv.length !== 3) {
        throw new SyncError('Usage: node --env-file=.env scripts/sync-codex.mjs <origin>');
    }
    const target = destination(process.argv[2]);
    const token = process.env.CODEX_SYNC_TOKEN;
    if (!token || /[\r\n]/.test(token)) {
        throw new SyncError('Set CODEX_SYNC_TOKEN in a private environment file.');
    }
    let reading;
    try {
        const { readCodexUsage } = await import('../dist/node.mjs');
        reading = await readCodexUsage();
    } catch {
        throw new SyncError('Could not read Codex usage. Build the Node entry point '
            + 'and verify your existing local Codex-service login.');
    }
    let response;
    try {
        response = await fetch(target, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token,
                'Content-Type': 'application/json' },
            body: JSON.stringify(reading),
            redirect: 'manual',
            signal: AbortSignal.timeout(30_000),
        });
    } catch {
        throw new SyncError('CodeStats could not be reached for the usage sync.');
    }
    await response.body?.cancel();
    if (!response.ok) {
        throw new SyncError('CodeStats rejected the usage sync (HTTP '
            + response.status + ').');
    }
    console.log('Codex usage synced successfully.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        await main();
    } catch (error) {
        console.error(error instanceof SyncError ? error.message
            : 'Codex usage sync failed. No diagnostic or response body was printed.');
        process.exitCode = 1;
    }
}
