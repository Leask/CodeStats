import type { Settings } from './types';

export const PRIMARY_SOURCES = [
    'github', 'wakatime', 'codex', 'openrouter',
] as const;

export type PrimarySource = typeof PRIMARY_SOURCES[number];
export type ProfileAccounts = Partial<Record<
    'github' | 'wakatime' | 'codex', string
>>;

export interface ProfileSelection {
    mode: 'configured' | 'public';
    accounts: ProfileAccounts;
    sources: PrimarySource[];
}

/** Configured Codex identity/imports enable usage unless explicitly disabled. */
export function codexUsageEnabled(env: Settings): boolean {
    const override = env.CODEX_USAGE_ENABLED?.trim().toLowerCase();
    if (override === 'false') return false;
    return override === 'true'
        || Boolean(env.CODEX_USERNAME?.trim() || env.CODEX_SYNC_TOKEN?.trim());
}

const ACCOUNT_PARAMETERS = ['github', 'wakatime', 'codex'] as const;
const PROFILE_PARAMETERS = new Set<string>([...ACCOUNT_PARAMETERS, 'sources']);
const SECRET_PART = /(?:^|_)(?:token|secret|password|passwd|authorization|credential|credentials|key)(?:_|$)/;
const SECRET_SUFFIX = /(?:token|apikey|secret|password|passwd|authorization|credential|privatekey|accesskey)$/;

function secretParameter(name: string): boolean {
    const normalized = name.replace(/([a-z\d])([A-Z])/g, '$1_$2')
        .toLowerCase().replace(/[^a-z\d]+/g, '_');
    return SECRET_PART.test(normalized)
        || SECRET_SUFFIX.test(normalized.replace(/_/g, ''));
}

export function normalizeProfileAccount(service: keyof ProfileAccounts, value: string): string {
    const id = value.trim().replace(/^@/, '');
    const valid = !/^(?:gh[pousr]_|github_pat_|waka_tok_|waka_[a-f\d]{8}-|sk-or-v1-|sk-ant-)/i.test(id)
        && (service === 'github'
        ? /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(id)
            && !id.includes('--')
        : service === 'wakatime'
        ? /^[a-z\d][a-z\d_-]{0,63}$/i.test(id)
        : /^[a-z\d_.-]{1,64}$/i.test(id) && /[a-z\d]/i.test(id));
    if (!valid) {
        const label = service === 'github' ? 'GitHub username'
            : service === 'wakatime' ? 'WakaTime username' : 'Codex ID';
        throw new Error(label + ' is invalid; provide an ID, not a URL.');
    }
    return service === 'codex' ? id : id.toLowerCase();
}

function sources(value: string): PrimarySource[] {
    const requested = value.split(',').map(item => item.trim().toLowerCase());
    if (!value.trim() || value.length > 128
        || requested.some(item => !PRIMARY_SOURCES.includes(item as PrimarySource))
        || new Set(requested).size !== requested.length) {
        throw new Error('Sources must be a nonempty list of unique known services.');
    }
    return PRIMARY_SOURCES.filter(service => requested.includes(service));
}

/** Names are public selectors; a name never authorizes use of owner secrets. */
export function resolveProfile(url: URL, env: Settings): ProfileSelection {
    const parameters = new Map<string, string>();
    for (const [name, value] of url.searchParams) {
        if (secretParameter(name)) {
            throw new Error('Tokens are not accepted in URL parameters; '
                + 'use server configuration.');
        }
        const normalized = name.toLowerCase();
        if (!PROFILE_PARAMETERS.has(normalized)) continue;
        if (name !== normalized || parameters.has(normalized)) {
            throw new Error('Profile parameters must be lowercase and appear once.');
        }
        parameters.set(name, value);
    }
    const mode = ACCOUNT_PARAMETERS.some(name => parameters.has(name))
        ? 'public' : 'configured';
    const accounts: ProfileAccounts = {};
    if (mode === 'public') {
        for (const service of ACCOUNT_PARAMETERS) {
            if (parameters.has(service)) {
                accounts[service] = normalizeProfileAccount(service, parameters.get(service)!);
            }
        }
    } else {
        for (const [service, value] of [
            ['github', env.GITHUB_USERNAME], ['wakatime', env.WAKATIME_USERNAME],
            ['codex', env.CODEX_USERNAME],
        ] as const) {
            if (value?.trim()) accounts[service] = normalizeProfileAccount(service, value);
        }
    }
    const inferred = mode === 'public'
        ? PRIMARY_SOURCES.filter(service => service !== 'openrouter'
            && accounts[service] !== undefined)
        : PRIMARY_SOURCES.filter(service => service === 'github'
            ? !!accounts.github || !!env.GITHUB_TOKEN?.trim()
            : service === 'wakatime'
            ? !!accounts.wakatime || !!env.WAKATIME_TOKEN?.trim()
            : service === 'codex'
            ? codexUsageEnabled(env)
            : !!env.OPENROUTER_API_KEY?.trim());
    return {
        mode, accounts,
        sources: parameters.has('sources')
            ? sources(parameters.get('sources')!) : inferred,
    };
}

function publicAccounts(selection: ProfileSelection): ProfileAccounts {
    if (selection.mode !== 'public') {
        throw new Error('A public profile selection is required.');
    }
    const accounts: ProfileAccounts = {};
    for (const service of ACCOUNT_PARAMETERS) {
        if (selection.accounts[service] !== undefined) {
            accounts[service] = normalizeProfileAccount(service, selection.accounts[service]!);
        }
    }
    if (!Object.keys(accounts).length) {
        throw new Error('A public profile requires at least one account ID.');
    }
    return accounts;
}

/** Views and source masks share observations for the same public account set. */
export function publicProfileIdentity(selection: ProfileSelection): string {
    const accounts = publicAccounts(selection);
    return 'public-query:v1:' + JSON.stringify(ACCOUNT_PARAMETERS
        .map(service => accounts[service] ?? null));
}

/** Explicit whitelist: public requests never inherit owner authentication. */
export function publicSettings(
    env: Settings, selection: ProfileSelection,
): Settings {
    const accounts = publicAccounts(selection);
    return {
        GITHUB_USERNAME: accounts.github ?? '',
        WAKATIME_USERNAME: accounts.wakatime ?? '',
        ...(accounts.codex ? { CODEX_USERNAME: accounts.codex } : {}),
        GITHUB_VISIBILITY: 'public',
        GITHUB_REPOSITORY_AFFILIATIONS: 'OWNER',
        GITHUB_INCLUDE_FORKS: env.GITHUB_INCLUDE_FORKS ?? 'true',
        GITHUB_INCLUDE_OWN_CONTRIBUTIONS:
            env.GITHUB_INCLUDE_OWN_CONTRIBUTIONS ?? 'true',
        CODEX_USAGE_ENABLED: accounts.codex ? 'true' : 'false',
        DEFAULT_RANGE: env.DEFAULT_RANGE,
        FRESH_SECONDS: env.FRESH_SECONDS,
        RETRY_SECONDS: env.RETRY_SECONDS,
    };
}

/** Only the public ID is accepted; neither callers nor redirects choose a host. */
export function canonicalCodexUrl(id: string): string {
    return 'https://chatgpt.com/u/' + encodeURIComponent(normalizeProfileAccount('codex', id));
}
