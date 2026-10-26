import { SnapshotCache } from './cache';
import type { Storage } from './cache';
import { fetchGitHub } from './github';
import { fetchGitHubActivity } from './github-activity';
import { fetchWakaTime } from './wakatime';
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
    return new SnapshotCache(storage, {
        github: () => fetchGitHub(env, fetcher),
        githubActivity: () => fetchGitHubActivity(env, fetcher),
        wakatime: range => fetchWakaTime(env, range, fetcher),
    }, {
        freshSeconds: seconds(env.FRESH_SECONDS, 21600, 60),
        retrySeconds: seconds(env.RETRY_SECONDS, 900, 60),
        githubKey: env.GITHUB_VISIBILITY === 'all' ? 'github:all-v1' : 'github',
        githubActivityKey: `github:activity:${env.GITHUB_VISIBILITY ?? 'public'}:v1`,
        githubActivityCollectionVersion: 2,
    });
}
