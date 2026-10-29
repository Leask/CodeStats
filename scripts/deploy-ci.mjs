import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const secretNames = ['GITHUB_TOKEN', 'WAKATIME_TOKEN', 'OPENROUTER_API_KEY',
    'ANTHROPIC_ADMIN_KEY'];
const variableNames = ['GITHUB_USERNAME', 'WAKATIME_USERNAME', 'CODEX_USERNAME',
    'GITHUB_VISIBILITY', 'GITHUB_REPOSITORY_AFFILIATIONS', 'GITHUB_INCLUDE_FORKS',
    'GITHUB_INCLUDE_OWN_CONTRIBUTIONS', 'DEFAULT_RANGE', 'FRESH_SECONDS',
    'RETRY_SECONDS', 'CODEX_USAGE_ENABLED', 'OPENROUTER_USAGE_SINCE',
    'ANTHROPIC_USAGE_SINCE'];
const project = fileURLToPath(new URL('../', import.meta.url));

function deploymentArguments(args) {
    let filename;
    let dryRun = false;
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (argument === '--dry-run' && !dryRun) dryRun = true;
        else if ((argument === '--secrets-file' || argument.startsWith('--secrets-file='))
            && filename === undefined) {
            filename = argument === '--secrets-file' ? args[++index]
                : argument.slice('--secrets-file='.length);
            if (!filename || filename.startsWith('--')) {
                throw new Error('Provide a path after --secrets-file.');
            }
        } else {
            throw new Error('Use --secrets-file PATH and/or --dry-run with npm run deploy.');
        }
    }
    return { filename, dryRun };
}

async function fileSecrets(filename) {
    if (filename === undefined) return {};
    let data;
    try {
        const contents = (await readFile(resolve(project, filename), 'utf8')).trim();
        data = contents.startsWith('{') ? JSON.parse(contents) : parseEnv(contents);
    } catch {
        throw new Error('Could not read the deployment secrets file.');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)
        || Object.entries(data).some(([name, value]) =>
            (!secretNames.includes(name) && name !== 'CODEX_SYNC_TOKEN')
                || typeof value !== 'string')) {
        throw new Error('The deployment secrets file must contain only named provider secrets.');
    }
    // Accept old files, but only the sync helper may install its managed key.
    return Object.fromEntries(Object.entries(data).flatMap(([name, value]) =>
        secretNames.includes(name) && value.trim() ? [[name, value.trim()]] : []));
}

/** Only named service settings become bindings; build authentication stays local. */
export async function deployCi(options = {}) {
    const environment = options.environment ?? process.env;
    const start = options.spawn ?? spawn;
    const { filename, dryRun } = deploymentArguments(options.arguments ?? []);
    const values = names => Object.fromEntries(names.flatMap(name => {
        const value = environment[name]?.trim();
        return value ? [[name, value]] : [];
    }));
    const secrets = { ...values(secretNames), ...await fileSecrets(filename) };
    const childEnvironment = { ...environment, WRANGLER_LOG: 'info' };
    delete childEnvironment.CODEX_SYNC_TOKEN;
    const variables = values(variableNames);
    // Clearing a username is intentional; unlike an empty secret, it must
    // override the template/default account rather than silently re-enable it.
    for (const name of ['GITHUB_USERNAME', 'WAKATIME_USERNAME', 'CODEX_USERNAME']) {
        if (environment[name] !== undefined) variables[name] = environment[name].trim();
    }
    for (const value of Object.values(variables)) {
        if (/[\r\n]/.test(value)
            || /(?:gh[pousr]_|github_pat_|waka_tok_|waka_[a-f\d]{8}-|sk-or-v1-|sk-ant-)/i.test(value)) {
            throw new Error('A public deployment variable contains credential-like data.');
        }
    }
    const directory = await mkdtemp(join(options.temporaryDirectory ?? tmpdir(),
        'codestats-deploy-'));
    try {
        const args = [join(project, 'node_modules/wrangler/bin/wrangler.js'),
            'deploy', '--config', join(project, 'wrangler.jsonc'), '--keep-vars'];
        if (dryRun) args.push('--dry-run');
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
                cwd: project, env: childEnvironment,
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
    try { await deployCi({ arguments: process.argv.slice(2) }); }
    catch {
        console.error('CodeStats deployment failed; temporary secrets were removed.');
        process.exitCode = 1;
    }
}
