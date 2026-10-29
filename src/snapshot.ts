import { SnapshotCache } from './cache';
import type { Storage } from './cache';
import { fetchGitHub } from './github';
import { repositoryOptions } from './github-options';
import { fetchGitHubActivity } from './github-activity';
import { fetchPublicGitHub, fetchPublicGitHubActivity } from './github-public';
import { codexUsageEnabled, publicSettings } from './profile';
import type { ProfileSelection } from './profile';
import { fetchWakaTime } from './wakatime';
import { MISSING_GITHUB_TOKEN } from './errors';
import { fetchAnthropicUsage, fetchOpenRouterUsage } from './ai-usage';
import type { AIUsageData, Fetcher, Range, Settings, WakaData } from './types';
import { resolveWakaTimeUsername } from './wakatime';
import { UpstreamError } from './errors';

interface UsageLoaders {
    codex?: () => Promise<AIUsageData>;
    wakatime?: (range: Range) => Promise<WakaData>;
}

/** A private key namespace without opening another database or copying data. */
export function scopedStorage(storage: Storage, identity: string): Storage {
    const key = (value: string) => JSON.stringify([identity, value]);
    return {
        get: <T>(value: string) => storage.get<T>(key(value)),
        put: <T>(value: string, payload: T) => storage.put(key(value), payload),
    };
}

/** Resolving a WakaTime owner must not move other providers or Codex imports. */
function scopedWakaStorage(storage: Storage, identity: string): Storage {
    const scoped = scopedStorage(storage, identity);
    return {
        get: <T>(key: string) => (key.startsWith('wakatime:')
            ? scoped : storage).get<T>(key),
        put: <T>(key: string, value: T) => (key.startsWith('wakatime:')
            ? scoped : storage).put(key, value),
    };
}

function seconds(value: string, fallback: number, minimum: number): number {
    const number = Number(value);
    return value.trim() && Number.isFinite(number)
        ? Math.max(minimum, number) : fallback;
}

/** Preserve the original Worker identity and its existing saved snapshots. */
export function profileIdentity(env: Settings): string {
    return [
        'public-v1', env.GITHUB_USERNAME.toLowerCase(),
        env.WAKATIME_USERNAME.toLowerCase(),
    ].join(':');
}

export function createProfileCache(
    storage: Storage,
    env: Settings,
    fetcher: Fetcher = fetch,
    usageLoaders: UsageLoaders = {},
): SnapshotCache {
    const options = repositoryOptions(env);
    // Retain the v6 key so old last-good data survives the count upgrade.
    const authenticated = Boolean(env.GITHUB_TOKEN?.trim());
    const githubEnabled = Boolean(env.GITHUB_USERNAME.trim() || env.GITHUB_TOKEN?.trim());
    const wakaEnabled = Boolean(env.WAKATIME_USERNAME.trim() || env.WAKATIME_TOKEN?.trim());
    const githubKey = authenticated ? ['github:repositories:v6',
        env.GITHUB_VISIBILITY ?? 'public',
        options.affiliations.join(','), String(options.includeForks)].join(':')
        : 'github:repositories:public-rest:v1:' + String(options.includeForks);
    return new SnapshotCache(storage, {
        ...(githubEnabled ? {
            github: () => authenticated ? fetchGitHub(env, fetcher)
                : fetchPublicGitHub(env, fetcher),
            githubActivity: () => authenticated ? fetchGitHubActivity(env, fetcher)
                : fetchPublicGitHubActivity(env, fetcher),
        } : {}),
        ...(wakaEnabled ? {
            wakatime: usageLoaders.wakatime ?? (range => fetchWakaTime(env, range, fetcher)),
        } : {}),
        aiUsage: {
            ...(env.OPENROUTER_API_KEY?.trim()
                ? { openrouter: () => fetchOpenRouterUsage(env, fetcher) } : {}),
            ...(env.ANTHROPIC_ADMIN_KEY?.trim()
                ? { anthropic: () => fetchAnthropicUsage(env, fetcher) } : {}),
            ...(codexUsageEnabled(env) && usageLoaders.codex
                ? { codex: usageLoaders.codex } : {}),
        },
    }, {
        freshSeconds: seconds(env.FRESH_SECONDS, 21600, 60),
        retrySeconds: seconds(env.RETRY_SECONDS, 900, 60),
        githubKey,
        githubCollectionVersion: 7,
        githubActivityKey: authenticated
            ? `github:activity:${env.GITHUB_VISIBILITY ?? 'public'}:v3:`
                + (env.GITHUB_INCLUDE_OWN_CONTRIBUTIONS ?? 'true')
            : 'github:activity:public-rest:v1',
        githubActivityCollectionVersion: 3,
        importedCodexUsage: codexUsageEnabled(env)
            && !usageLoaders.codex,
        aiUsageKeys: {
            // Keep the legacy key so older snapshots remain available while
            // collectionVersion 3 refreshes the daily token/request summary.
            openrouter: 'usage:openrouter:v1:'
                + (env.OPENROUTER_USAGE_SINCE?.trim() || 'last30completed'),
            anthropic: 'usage:anthropic:v1:'
                + (env.ANTHROPIC_USAGE_SINCE?.trim() || 'last30completed'),
        },
        // Credential presence only; never store, hash or expose its value.
        retryConfigurationErrors: env.GITHUB_TOKEN?.trim()
            ? [MISSING_GITHUB_TOKEN] : [],
    });
}

/** Token-only WakaTime is resolved before persistent account data is read. */
export async function prepareConfiguredProfile(
    storage: Storage, env: Settings, fetcher: Fetcher = fetch,
    usageLoaders: UsageLoaders = {},
): Promise<{ cache: SnapshotCache; settings: Settings }> {
    if (env.WAKATIME_USERNAME.trim() || !env.WAKATIME_TOKEN?.trim()) {
        return { cache: createProfileCache(storage, env, fetcher, usageLoaders), settings: env };
    }
    try {
        const username = await resolveWakaTimeUsername(env, fetcher);
        const settings = { ...env, WAKATIME_USERNAME: username };
        return {
            settings,
            cache: createProfileCache(scopedWakaStorage(storage,
                'configured-wakatime:v1:' + username.toLowerCase()), settings, fetcher, usageLoaders),
        };
    } catch (error) {
        const message = error instanceof UpstreamError ? error.message
            : 'WakaTime OAuth identity could not be resolved.';
        const retryAfter = error instanceof UpstreamError
            ? error.retryAfterSeconds : undefined;
        return { settings: env, cache: createProfileCache(
            scopedWakaStorage(storage, 'configured-wakatime:unresolved'), env, fetcher,
            { ...usageLoaders, wakatime: async () => {
                throw new UpstreamError(message, retryAfter);
            } },
        ) };
    }
}

/** Visitor names cannot inherit a configured owner's credentials or imports. */
export function createPublicProfileCache(
    storage: Storage, env: Settings, selection: ProfileSelection,
    fetcher: Fetcher = fetch,
): SnapshotCache {
    const settings = publicSettings(env, selection);
    return new SnapshotCache(storage, {
        ...(settings.GITHUB_USERNAME ? {
            github: () => fetchPublicGitHub(settings, fetcher),
            githubActivity: () => fetchPublicGitHubActivity(settings, fetcher),
        } : {}),
        ...(settings.WAKATIME_USERNAME ? {
            wakatime: (range: Range) => fetchWakaTime(settings, range, fetcher),
        } : {}),
        aiUsage: {
            codex: async () => { throw new UpstreamError(selection.accounts.codex
                ? 'Codex public profiles require sign-in to view usage. Use a configured account or aggregate sync.'
                : 'Provide a Codex ID for its public profile link; usage still requires account access.'); },
            openrouter: async () => { throw new UpstreamError(
                'OpenRouter has no anonymous username usage API. Use a configured account with a Management key.',
            ); },
            anthropic: async () => { throw new UpstreamError(
                'Anthropic API usage requires a configured organization Admin key; public IDs do not authorize access.',
            ); },
        },
    }, {
        freshSeconds: seconds(settings.FRESH_SECONDS, 21600, 60),
        retrySeconds: seconds(settings.RETRY_SECONDS, 900, 60),
        githubKey: 'github:repositories:public-rest:v1:' + (settings.GITHUB_INCLUDE_FORKS ?? 'true'),
        githubActivityKey: 'github:activity:public-rest:v1',
        githubCollectionVersion: 7, githubActivityCollectionVersion: 3,
        aiUsageKeys: { codex: 'usage:codex:public-unavailable:v1',
            openrouter: 'usage:openrouter:public-unavailable:v1',
            anthropic: 'usage:anthropic:public-unavailable:v1' },
    });
}
