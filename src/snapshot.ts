import { SnapshotCache } from './cache';
import type { Storage } from './cache';
import { fetchGitHub } from './github';
import { repositoryOptions } from './github-options';
import { fetchGitHubActivity } from './github-activity';
import { fetchWakaTime } from './wakatime';
import { MISSING_GITHUB_TOKEN } from './errors';
import { fetchAnthropicUsage, fetchOpenRouterUsage } from './ai-usage';
import type { AIUsageData, Fetcher, Settings } from './types';

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
    usageLoaders: { codex?: () => Promise<AIUsageData> } = {},
): SnapshotCache {
    const options = repositoryOptions(env);
    // Retain the v6 key so old last-good data survives the count upgrade.
    const githubKey = ['github:repositories:v6',
        env.GITHUB_VISIBILITY ?? 'public',
        options.affiliations.join(','), String(options.includeForks)].join(':');
    return new SnapshotCache(storage, {
        github: () => fetchGitHub(env, fetcher),
        githubActivity: () => fetchGitHubActivity(env, fetcher),
        wakatime: range => fetchWakaTime(env, range, fetcher),
        aiUsage: {
            ...(env.OPENROUTER_API_KEY?.trim()
                ? { openrouter: () => fetchOpenRouterUsage(env, fetcher) } : {}),
            ...(env.ANTHROPIC_ADMIN_KEY?.trim()
                ? { anthropic: () => fetchAnthropicUsage(env, fetcher) } : {}),
            ...(env.CODEX_USAGE_ENABLED === 'true' && usageLoaders.codex
                ? { codex: usageLoaders.codex } : {}),
        },
    }, {
        freshSeconds: seconds(env.FRESH_SECONDS, 21600, 60),
        retrySeconds: seconds(env.RETRY_SECONDS, 900, 60),
        githubKey,
        githubCollectionVersion: 7,
        githubActivityKey: `github:activity:${env.GITHUB_VISIBILITY ?? 'public'}:v3:`
            + (env.GITHUB_INCLUDE_OWN_CONTRIBUTIONS ?? 'true'),
        githubActivityCollectionVersion: 3,
        importedCodexUsage: env.CODEX_USAGE_ENABLED === 'true'
            && !usageLoaders.codex,
        aiUsageKeys: {
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
