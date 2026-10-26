import { SnapshotCache } from './cache';
import type { Storage } from './cache';
import { fetchGitHub } from './github';
import { repositoryOptions } from './github-options';
import { fetchGitHubActivity } from './github-activity';
import { fetchWakaTime } from './wakatime';
import { MISSING_GITHUB_TOKEN } from './errors';
import type { Fetcher, Settings } from './types';

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
): SnapshotCache {
    const options = repositoryOptions(env);
    const githubKey = ['github:repositories:v6',
        env.GITHUB_VISIBILITY ?? 'public',
        options.affiliations.join(','), String(options.includeForks)].join(':');
    return new SnapshotCache(storage, {
        github: () => fetchGitHub(env, fetcher),
        githubActivity: () => fetchGitHubActivity(env, fetcher),
        wakatime: range => fetchWakaTime(env, range, fetcher),
    }, {
        freshSeconds: seconds(env.FRESH_SECONDS, 21600, 60),
        retrySeconds: seconds(env.RETRY_SECONDS, 900, 60),
        githubKey,
        githubActivityKey: `github:activity:${env.GITHUB_VISIBILITY ?? 'public'}:v3:`
            + (env.GITHUB_INCLUDE_OWN_CONTRIBUTIONS ?? 'true'),
        githubActivityCollectionVersion: 3,
        // Credential presence only; never store, hash or expose its value.
        retryConfigurationErrors: env.GITHUB_TOKEN?.trim()
            ? [MISSING_GITHUB_TOKEN] : [],
    });
}
