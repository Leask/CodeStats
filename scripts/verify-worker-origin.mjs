import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'jsonc-parser';

export class WorkerOriginError extends Error {}

const project = fileURLToPath(new URL('../', import.meta.url));
const configPath = join(project, 'wrangler.jsonc');
const apiOrigin = 'https://api.cloudflare.com';
const maximumBytes = 128 * 1024;
const denied = () => new WorkerOriginError(
    'Could not verify this origin belongs to the configured Worker. '
    + 'Check wrangler.jsonc and Wrangler login, or provide CODEX_SYNC_TOKEN '
    + 'for a manually configured destination. No secret was changed.',
);

/** Auth JSON stays in memory; never forward CLI output or diagnostics. */
function wranglerJson(args, environment) {
    return new Promise((accept, reject) => {
        const child = spawn(process.execPath, [
            join(project, 'node_modules/wrangler/bin/wrangler.js'),
            ...args, '--config', configPath,
        ], {
            cwd: project, timeout: 20_000, killSignal: 'SIGKILL',
            env: { ...environment, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const chunks = [];
        let size = 0;
        let oversized = false;
        child.stdout.on('data', chunk => {
            size += chunk.length;
            if (size > maximumBytes) {
                oversized = true;
                child.kill('SIGKILL');
            } else chunks.push(chunk);
        });
        let diagnosticSize = 0;
        child.stderr.on('data', chunk => {
            diagnosticSize += chunk.length;
            if (diagnosticSize > maximumBytes) {
                oversized = true;
                child.kill('SIGKILL');
            }
        });
        child.once('error', () => reject(denied()));
        child.once('close', code => {
            if (code !== 0 || oversized) return reject(denied());
            try { accept(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch { reject(denied()); }
        });
    });
}

async function configuredWorker(readConfig) {
    const errors = [];
    const config = parse(await readConfig(), errors, { allowTrailingComma: true });
    if (errors.length || typeof config?.name !== 'string'
        || !/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(config.name)) {
        throw denied();
    }
    return config;
}

function authHeaders(credentials) {
    const safe = value => typeof value === 'string' && value.length > 0
        && value.length <= 32_768 && !/[\r\n]/.test(value);
    if (['oauth', 'api_token'].includes(credentials?.type) && safe(credentials.token)) {
        return { Accept: 'application/json', Authorization: 'Bearer ' + credentials.token };
    }
    if (credentials?.type === 'api_key' && safe(credentials.key) && safe(credentials.email)) {
        return { Accept: 'application/json', 'X-Auth-Key': credentials.key,
            'X-Auth-Email': credentials.email };
    }
    throw denied();
}

async function apiResult(path, headers, fetcher) {
    const url = new URL(path, apiOrigin);
    if (url.origin !== apiOrigin || !url.pathname.startsWith('/client/v4/accounts/')) {
        throw denied();
    }
    const response = await fetcher(url, {
        method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(15_000),
    });
    const reader = response.body?.getReader();
    try {
        if (!response.ok || !reader
            || Number(response.headers.get('content-length')) > maximumBytes) {
            throw denied();
        }
        const chunks = [];
        let size = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > maximumBytes) throw denied();
            chunks.push(value);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (body?.success !== true || !Object.hasOwn(body, 'result')) throw denied();
        return body.result;
    } finally {
        await reader?.cancel();
    }
}

/** Verify the exact deployed destination before provisioning a sync secret. */
export async function verifyWorkerOrigin(origin, options = {}) {
    try {
        const target = new URL(origin);
        if (target.protocol !== 'https:' || target.origin !== origin
            || target.username || target.password || target.port) throw denied();
        const environment = options.environment ?? process.env;
        const config = await configuredWorker(options.readConfig
            ?? (() => readFile(configPath, 'utf8')));
        const run = options.runWrangler ?? (args => wranglerJson(args, environment));
        const who = await run(['whoami', '--json']);
        if (who?.loggedIn !== true || !Array.isArray(who.accounts)) throw denied();
        const accounts = [...new Set(who.accounts.map(account => account?.id))]
            .filter(id => typeof id === 'string' && /^[a-f0-9]{32}$/i.test(id));
        const configured = environment.CLOUDFLARE_ACCOUNT_ID?.trim()
            || environment.CF_ACCOUNT_ID?.trim() || config.account_id;
        if (configured && !accounts.includes(configured)) throw denied();
        const candidates = configured ? [configured] : accounts;
        if (!candidates.length || candidates.length > 10) throw denied();
        const credentials = await run(['auth', 'token', '--json']);
        const headers = authHeaders(credentials);
        const workerName = config.name;
        const matches = await Promise.all(candidates.map(async accountId => {
            const get = path => apiResult('/client/v4/accounts/' + accountId + path,
                headers, options.fetcher ?? fetch);
            try {
                if (target.hostname.endsWith('.workers.dev')) {
                    const subdomain = await get('/workers/subdomain');
                    if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(subdomain?.subdomain)
                        || origin !== `https://${workerName}.${subdomain.subdomain}.workers.dev`) {
                        return null;
                    }
                    const script = await get('/workers/scripts/' + encodeURIComponent(workerName)
                        + '/subdomain');
                    return script?.enabled === true ? accountId : null;
                }
                const parameters = new URLSearchParams({
                    hostname: target.hostname, service: workerName,
                    environment: 'production', enabled: 'true',
                });
                const domains = await get('/workers/domains?' + parameters);
                return Array.isArray(domains) && domains.some(domain =>
                    domain?.hostname === target.hostname && domain.service === workerName
                    && domain.environment === 'production' && domain.enabled === true)
                    ? accountId : null;
            } catch {
                return null;
            }
        }));
        const verified = matches.filter(Boolean);
        if (verified.length !== 1) throw denied();
        return { accountId: verified[0], workerName };
    } catch {
        throw denied();
    }
}

export default verifyWorkerOrigin;
