import type {
    AIService, AIUsageData, GitHubActivityData, GitHubData, Range,
    SourceSnapshot, StatsSnapshot, WakaData,
} from './types';
import { UpstreamError } from './errors';
import { normalizeCodexUsage } from './codex-usage';

export interface Storage {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
}

interface Loaders {
    github: () => Promise<GitHubData>;
    githubActivity?: () => Promise<GitHubActivityData>;
    wakatime: (range: Range) => Promise<WakaData>;
    aiUsage?: Partial<Record<AIService, () => Promise<AIUsageData>>>;
}

interface Policy {
    freshSeconds: number;
    retrySeconds: number;
    now?: () => number;
    githubKey?: string;
    githubActivityKey?: string;
    githubCollectionVersion?: number;
    githubActivityCollectionVersion?: number;
    retryConfigurationErrors?: string[];
    importedCodexUsage?: boolean;
    aiUsageKeys?: Partial<Record<AIService, string>>;
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
    private codexWrite: Promise<void> = Promise.resolve();

    constructor(
        private readonly storage: Storage,
        private readonly loaders: Loaders,
        private readonly policy: Policy,
    ) {
        this.now = policy.now ?? Date.now;
    }

    private classify<T>(
        value: SourceSnapshot<T>,
        isCurrent: (data: T) => boolean = () => true,
    ): SourceSnapshot<T> {
        const age = value.lastSuccessAt === null
            ? Infinity : this.now() - Date.parse(value.lastSuccessAt);
        return {
            ...value,
            status: value.data === null ? 'unavailable'
                : age < this.policy.freshSeconds * 1000 && isCurrent(value.data)
                ? 'fresh' : 'stale',
        };
    }

    private async refresh<T>(
        key: string,
        old: SourceSnapshot<T>,
        loader: () => Promise<T>,
        isCurrent: (data: T) => boolean,
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
                const observedAt = key === 'usage:codex:v1'
                    ? (data as AIUsageData).until : null;
                const result: SourceSnapshot<T> = {
                    data, lastSuccessAt: observedAt ?? new Date(this.now()).toISOString(),
                    lastAttemptAt: attempt, lastError: null,
                    retryAt: null, status: 'fresh',
                };
                const classified = this.classify(result, isCurrent);
                if (classified.status !== 'fresh') {
                    classified.retryAt = pending.retryAt;
                }
                // Never expire/delete last-good data when its refresh TTL ends.
                await this.storage.put(key, classified);
                return classified;
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
                        : key.startsWith('usage:')
                        ? 'Token usage refresh failed; saved data is retained.'
                        : key.startsWith('github')
                        ? 'GitHub refresh failed. Showing the last successful snapshot when available.'
                        : 'WakaTime refresh failed. Check the published range or OAuth access; saved data is retained.',
                }, isCurrent);
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
        isCurrent: (data: T) => boolean = () => true,
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
        const current = this.classify(stored, isCurrent);
        const running = this.inFlight.get(key);
        if (running && current.data === null) {
            return running as Promise<SourceSnapshot<T>>;
        }
        const retryDue = current.retryAt === null
            || Date.parse(current.retryAt) <= this.now()
            // A newly supplied setting can resolve a cached configuration error.
            || (current.lastError !== null
                && this.policy.retryConfigurationErrors?.includes(current.lastError) === true);
        if (current.status === 'fresh' || !retryDue) {
            return current;
        }
        const operation = this.refresh(key, current, loader, isCurrent);
        if (current.data !== null) {
            // Readable old data is returned immediately while refresh proceeds.
            waitUntil(operation);
            return current;
        }
        return operation;
    }

    /** Worker ingestion stores only validated aggregates, never CLI credentials. */
    async saveCodexUsage(payload: unknown): Promise<void> {
        const operation = this.codexWrite.then(async () => {
            const { data, observedAt } = normalizeCodexUsage(payload, this.now());
            const key = 'usage:codex:v1';
            const previous = await this.storage.get<SourceSnapshot<AIUsageData>>(key);
            if (previous?.lastSuccessAt
                && Date.parse(previous.lastSuccessAt) >= Date.parse(observedAt)) {
                throw new UpstreamError('Codex observation is not newer than the saved snapshot.');
            }
            await this.storage.put(key, {
                data, lastSuccessAt: observedAt, lastAttemptAt: observedAt,
                lastError: null, retryAt: null, status: 'fresh',
            } satisfies SourceSnapshot<AIUsageData>);
        });
        this.codexWrite = operation.catch(() => undefined);
        await operation;
    }

    private async usage(waitUntil: WaitUntil) {
        const entries = await Promise.all(Object.entries(this.loaders.aiUsage ?? {})
            .map(async ([service, loader]) => [service,
                await this.source(this.policy.aiUsageKeys?.[service as AIService]
                    ?? 'usage:' + service + ':v1', loader, waitUntil),
            ] as const));
        const result: Partial<Record<AIService, SourceSnapshot<AIUsageData>>>
            = Object.fromEntries(entries);
        if (this.policy.importedCodexUsage && !result.codex) {
            try {
                const stored = await this.storage.get<SourceSnapshot<AIUsageData>>(
                    'usage:codex:v1',
                );
                result.codex = this.classify(stored ?? {
                    ...empty<AIUsageData>(),
                    lastError: 'Sync Codex aggregates from a locally signed-in Codex CLI.',
                });
            } catch {
                result.codex = { ...empty<AIUsageData>(),
                    lastError: 'Codex usage storage is unavailable.' };
            }
        }
        return result;
    }

    async read(range: Range, waitUntil: WaitUntil): Promise<StatsSnapshot> {
        const [github, wakatime, githubActivity, aiUsage] = await Promise.all([
            this.source(this.policy.githubKey ?? 'github',
                this.loaders.github, waitUntil,
                data => this.policy.githubCollectionVersion === undefined
                    || data.collectionVersion === this.policy.githubCollectionVersion),
            this.source('wakatime:' + range,
                () => this.loaders.wakatime(range), waitUntil),
            this.loaders.githubActivity
                ? this.source(this.policy.githubActivityKey ?? 'github:activity',
                    this.loaders.githubActivity, waitUntil,
                    data => this.policy.githubActivityCollectionVersion === undefined
                        || data.collectionVersion === this.policy.githubActivityCollectionVersion,
                ) : undefined,
            this.usage(waitUntil),
        ]);
        return {
            schemaVersion: 1, github, wakatime, range,
            ...(githubActivity ? { githubActivity } : {}),
            ...(Object.keys(aiUsage).length ? { aiUsage } : {}),
            generatedAt: new Date(this.now()).toISOString(),
        };
    }
}
