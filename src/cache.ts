import type {
    GitHubActivityData, GitHubData, Range, SourceSnapshot, StatsSnapshot, WakaData,
} from './types';
import { UpstreamError } from './errors';

export interface Storage {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
}

interface Loaders {
    github: () => Promise<GitHubData>;
    githubActivity?: () => Promise<GitHubActivityData>;
    wakatime: (range: Range) => Promise<WakaData>;
}

interface Policy {
    freshSeconds: number;
    retrySeconds: number;
    now?: () => number;
    githubKey?: string;
    githubActivityKey?: string;
}

type WaitUntil = (promise: Promise<unknown>) => void;

function empty<T>(): SourceSnapshot<T> {
    return {
        data: null, lastSuccessAt: null, lastAttemptAt: null,
        lastError: null, retryAt: null, status: 'unavailable',
    };
}

/** Durable last-good state, separate from refresh TTL and failure cooldown. */
export class SnapshotCache {
    private readonly inFlight = new Map<string, Promise<unknown>>();
    private readonly now: () => number;

    constructor(
        private readonly storage: Storage,
        private readonly loaders: Loaders,
        private readonly policy: Policy,
    ) {
        this.now = policy.now ?? Date.now;
    }

    private classify<T>(value: SourceSnapshot<T>): SourceSnapshot<T> {
        const age = value.lastSuccessAt === null
            ? Infinity : this.now() - Date.parse(value.lastSuccessAt);
        return {
            ...value,
            status: value.data === null ? 'unavailable'
                : age < this.policy.freshSeconds * 1000 ? 'fresh' : 'stale',
        };
    }

    private async refresh<T>(
        key: string,
        old: SourceSnapshot<T>,
        loader: () => Promise<T>,
    ): Promise<SourceSnapshot<T>> {
        const existing = this.inFlight.get(key);
        if (existing) {
            return existing as Promise<SourceSnapshot<T>>;
        }
        const operation = (async () => {
            const attempt = new Date(this.now()).toISOString();
            const pending = {
                ...old, lastAttemptAt: attempt,
                retryAt: new Date(
                    this.now() + this.policy.retrySeconds * 1000,
                ).toISOString(),
            };
            try {
                // Preserve the success while reserving a bounded retry window.
                // This reservation also survives eviction/restart during fetch.
                await this.storage.put(key, pending);
                const data = await loader();
                const result: SourceSnapshot<T> = {
                    data, lastSuccessAt: new Date(this.now()).toISOString(),
                    lastAttemptAt: attempt, lastError: null,
                    retryAt: null, status: 'fresh',
                };
                // Never expire/delete last-good data when its refresh TTL ends.
                await this.storage.put(key, result);
                return result;
            } catch (error) {
                const retrySeconds = error instanceof UpstreamError
                    && error.retryAfterSeconds !== undefined
                    ? Math.max(this.policy.retrySeconds, error.retryAfterSeconds)
                    : this.policy.retrySeconds;
                const result = this.classify({
                    ...pending,
                    retryAt: new Date(this.now() + retrySeconds * 1000)
                        .toISOString(),
                    lastError: error instanceof UpstreamError ? error.message
                        : key.startsWith('github')
                        ? 'GitHub refresh failed. Showing the last successful snapshot when available.'
                        : 'WakaTime refresh failed. Check the published range or OAuth access; saved data is retained.',
                });
                try {
                    await this.storage.put(key, result);
                } catch {
                    // Storage failure cannot justify replacing good data with 0.
                    // Return the in-hand prior snapshot; never log raw errors.
                }
                return result;
            }
        })();
        this.inFlight.set(key, operation);
        try {
            return await operation;
        } finally {
            this.inFlight.delete(key);
        }
    }

    private async source<T>(
        key: string,
        loader: () => Promise<T>,
        waitUntil: WaitUntil,
    ): Promise<SourceSnapshot<T>> {
        let stored: SourceSnapshot<T>;
        try {
            stored = (await this.storage.get<SourceSnapshot<T>>(key))
                ?? empty<T>();
        } catch {
            return {
                ...empty<T>(),
                lastError: 'Snapshot storage is temporarily unavailable.',
            };
        }
        const current = this.classify(stored);
        const running = this.inFlight.get(key);
        if (running && current.data === null) {
            return running as Promise<SourceSnapshot<T>>;
        }
        const retryDue = current.retryAt === null
            || Date.parse(current.retryAt) <= this.now();
        if (current.status === 'fresh' || !retryDue) {
            return current;
        }
        const operation = this.refresh(key, current, loader);
        if (current.data !== null) {
            // Readable old data is returned immediately while refresh proceeds.
            waitUntil(operation);
            return current;
        }
        return operation;
    }

    async read(range: Range, waitUntil: WaitUntil): Promise<StatsSnapshot> {
        const [github, wakatime, githubActivity] = await Promise.all([
            this.source(this.policy.githubKey ?? 'github',
                this.loaders.github, waitUntil),
            this.source('wakatime:' + range,
                () => this.loaders.wakatime(range), waitUntil),
            this.loaders.githubActivity
                ? this.source(this.policy.githubActivityKey ?? 'github:activity',
                    this.loaders.githubActivity, waitUntil) : undefined,
        ]);
        return {
            schemaVersion: 1, github, wakatime, range,
            ...(githubActivity ? { githubActivity } : {}),
            generatedAt: new Date(this.now()).toISOString(),
        };
    }
}
