import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const secretNames = ['GITHUB_TOKEN', 'WAKATIME_TOKEN', 'OPENROUTER_API_KEY',
    'CODEX_SYNC_TOKEN', 'ANTHROPIC_ADMIN_KEY'];
const variableNames = ['GITHUB_USERNAME', 'WAKATIME_USERNAME', 'CODEX_USERNAME',
    'GITHUB_VISIBILITY', 'GITHUB_REPOSITORY_AFFILIATIONS', 'GITHUB_INCLUDE_FORKS',
    'GITHUB_INCLUDE_OWN_CONTRIBUTIONS', 'DEFAULT_RANGE', 'FRESH_SECONDS',
    'RETRY_SECONDS', 'CODEX_USAGE_ENABLED', 'OPENROUTER_USAGE_SINCE',
    'ANTHROPIC_USAGE_SINCE'];
const project = fileURLToPath(new URL('../', import.meta.url));

/** Only named service settings become bindings; build authentication stays local. */
export async function deployCi(options = {}) {
    const environment = options.environment ?? process.env;
    const start = options.spawn ?? spawn;
    const values = names => Object.fromEntries(names.flatMap(name => {
        const value = environment[name]?.trim();
        return value ? [[name, value]] : [];
    }));
    const secrets = values(secretNames);
    const variables = values(variableNames);
    for (const value of Object.values(variables)) {
        if (/[\r\n]/.test(value)
            || /(?:gh[pousr]_|github_pat_|waka_tok_|sk-or-v1-|sk-ant-)/i.test(value)) {
            throw new Error('A public deployment variable contains credential-like data.');
        }
    }
    const directory = await mkdtemp(join(options.temporaryDirectory ?? tmpdir(),
        'codestats-deploy-'));
    try {
        const args = [join(project, 'node_modules/wrangler/bin/wrangler.js'),
            'deploy', '--config', join(project, 'wrangler.jsonc'), '--keep-vars'];
        if (Object.keys(secrets).length) {
            const filename = join(directory, 'secrets.json');
            await writeFile(filename, JSON.stringify(secrets), { mode: 0o600, flag: 'wx' });
            args.push('--secrets-file', filename);
        }
        for (const [name, value] of Object.entries(variables)) {
            args.push('--var', name + ':' + value);
        }
        await new Promise((accept, reject) => {
            const child = start(process.execPath, args, {
                cwd: project, env: { ...environment, WRANGLER_LOG: 'info' },
                stdio: ['ignore', 'inherit', 'inherit'],
            });
            const failed = () => reject(new Error('Worker deployment failed.'));
            child.once('error', failed);
            child.once('close', code => code === 0 ? accept() : failed());
        });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { await deployCi(); }
    catch {
        console.error('CodeStats CI deployment failed; temporary secrets were removed.');
        process.exitCode = 1;
    }
}
