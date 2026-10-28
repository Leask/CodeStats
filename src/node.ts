import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from './app';
import { SqliteStorage } from './node-storage';
import {
    createProfileCache, createPublicProfileCache, prepareConfiguredProfile, profileIdentity,
} from './snapshot';
import { publicProfileIdentity } from './profile';
import type { ProfileSelection } from './profile';
import type { ReadOptions, SnapshotCache } from './cache';
import { RANGES } from './types';
import type { Fetcher, Range, Settings, StatsSnapshot } from './types';
import { readCodexUsage } from './codex-node';
import { normalizeCodexUsage } from './codex-usage';
import { CODEX_IMPORT_PATH, MAX_USAGE_BODY } from './usage-import';

export { readCodexUsage } from './codex-node';

interface NodeOptions {
    dataDirectory?: string;
    fetcher?: Fetcher;
    codexReader?: typeof readCodexUsage;
    publicCacheLimit?: number;
}

function autoRefreshSeconds(value: string | undefined): number {
    const seconds = value?.trim() ?? '0';
    if (!seconds || seconds === '0' || seconds.toLowerCase() === 'off') return 0;
    if (!/^\d+$/.test(seconds) || !Number.isSafeInteger(Number(seconds))
        || Number(seconds) < 60 || Number(seconds) > 2_147_483) {
        throw new Error('AUTO_REFRESH_SECONDS must be 0/off, or 60–2147483 seconds.');
    }
    return Number(seconds);
}

export function settingsFromEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
): Settings {
    const visibility = environment.GITHUB_VISIBILITY ?? 'all';
    if (visibility !== 'public' && visibility !== 'all') {
        throw new Error('GITHUB_VISIBILITY must be public or all.');
    }
    return {
        GITHUB_USERNAME: environment.GITHUB_USERNAME ?? '',
        GITHUB_VISIBILITY: visibility,
        GITHUB_REPOSITORY_AFFILIATIONS: environment.GITHUB_REPOSITORY_AFFILIATIONS,
        GITHUB_INCLUDE_FORKS: environment.GITHUB_INCLUDE_FORKS,
        GITHUB_INCLUDE_OWN_CONTRIBUTIONS: environment.GITHUB_INCLUDE_OWN_CONTRIBUTIONS,
        WAKATIME_USERNAME: environment.WAKATIME_USERNAME ?? '',
        DEFAULT_RANGE: environment.DEFAULT_RANGE ?? 'all_time',
        FRESH_SECONDS: environment.FRESH_SECONDS ?? '21600',
        RETRY_SECONDS: environment.RETRY_SECONDS ?? '900',
        GITHUB_TOKEN: environment.GITHUB_TOKEN,
        WAKATIME_TOKEN: environment.WAKATIME_TOKEN,
        OPENROUTER_API_KEY: environment.OPENROUTER_API_KEY,
        OPENROUTER_USAGE_SINCE: environment.OPENROUTER_USAGE_SINCE,
        ANTHROPIC_ADMIN_KEY: environment.ANTHROPIC_ADMIN_KEY,
        ANTHROPIC_USAGE_SINCE: environment.ANTHROPIC_USAGE_SINCE,
        CODEX_USAGE_ENABLED: environment.CODEX_USAGE_ENABLED,
        CODEX_USERNAME: environment.CODEX_USERNAME,
        CODEX_SYNC_TOKEN: environment.CODEX_SYNC_TOKEN,
        AUTO_REFRESH_SECONDS: environment.AUTO_REFRESH_SECONDS ?? '0',
    };
}

/** HTTP and SQLite are the only Node-specific parts of the shared application. */
export function createNodeService(settings: Settings, options: NodeOptions = {}) {
    const configuration = { ...settings };
    const refreshSeconds = autoRefreshSeconds(configuration.AUTO_REFRESH_SECONDS);
    const publicLimit = options.publicCacheLimit ?? 64;
    if (!Number.isSafeInteger(publicLimit) || publicLimit < 1 || publicLimit > 1024) {
        throw new Error('The public profile cache limit is invalid.');
    }
    const storage = new SqliteStorage(
        options.dataDirectory ?? resolve('.data'), profileIdentity(configuration),
    );
    const background = new Set<Promise<unknown>>();
    type Prepared = Awaited<ReturnType<typeof prepareConfiguredProfile>>;
    let preparedPromise: Promise<Prepared> | undefined;
    let preparedValue: Prepared | undefined;
    let preparedRetryAt = 0;
    let configuredReaders = 0;
    let closing = false;
    let refreshOperation: Promise<StatsSnapshot> | undefined;
    const publicProfiles = new Map<string, { cache: SnapshotCache; active: number }>();
    const usageLoaders = { codex: async () => normalizeCodexUsage(
        await (options.codexReader ?? readCodexUsage)(),
    ).data };
    let baseCache: SnapshotCache | undefined;
    const configuredBase = () => baseCache ??= createProfileCache(
        storage, configuration, options.fetcher, usageLoaders,
    );
    const waitUntil = (promise: Promise<unknown>) => {
        const observed = promise.catch(() => undefined);
        background.add(observed);
        void observed.finally(() => background.delete(observed));
    };

    function unresolved(prepared: Prepared): boolean {
        return !configuration.WAKATIME_USERNAME.trim()
            && !!configuration.WAKATIME_TOKEN?.trim()
            && !prepared.settings.WAKATIME_USERNAME.trim();
    }

    async function withConfigured<T>(
        operation: (prepared: Prepared) => Promise<T>,
    ): Promise<T> {
        if (configuration.WAKATIME_USERNAME.trim()
            || !configuration.WAKATIME_TOKEN?.trim()) {
            return operation({ cache: configuredBase(), settings: configuration });
        }
        if (preparedValue && unresolved(preparedValue)
            && Date.now() >= preparedRetryAt && configuredReaders === 0
            && !preparedValue.cache.busy) {
            preparedPromise = undefined;
            preparedValue = undefined;
        }
        configuredReaders++;
        try {
            preparedPromise ??= prepareConfiguredProfile(storage, configuration,
                options.fetcher, usageLoaders).then(prepared => {
                    preparedValue = prepared;
                    const delay = Number(configuration.RETRY_SECONDS);
                    preparedRetryAt = unresolved(prepared) ? Date.now()
                        + (Number.isFinite(delay) ? Math.max(60, delay) : 900) * 1000 : 0;
                    return prepared;
                }).catch(error => {
                    preparedPromise = undefined;
                    throw error;
                });
            return await operation(await preparedPromise);
        } finally {
            configuredReaders--;
        }
    }

    function noteConfiguredRetry(prepared: Prepared, snapshot: StatsSnapshot) {
        if (unresolved(prepared) && snapshot.wakatime.retryAt) {
            const retryAt = Date.parse(snapshot.wakatime.retryAt);
            if (Number.isFinite(retryAt)) {
                preparedRetryAt = Math.max(preparedRetryAt, retryAt);
            }
        }
    }

    async function readConfigured(range: Range, readOptions: ReadOptions) {
        if (readOptions.sources && !readOptions.sources.includes('wakatime')) {
            return configuredBase().read(range, waitUntil, readOptions);
        }
        return withConfigured(async prepared => {
            const snapshot = await prepared.cache.read(range, waitUntil, readOptions);
            noteConfiguredRetry(prepared, snapshot);
            return snapshot;
        });
    }

    async function readPublic(
        range: Range, selection: ProfileSelection, readOptions: ReadOptions,
    ) {
        const identity = publicProfileIdentity(selection);
        let entry = publicProfiles.get(identity);
        if (!entry) {
            if (publicProfiles.size >= publicLimit) {
                const oldest = [...publicProfiles.entries()]
                    .find(([, candidate]) => candidate.active === 0 && !candidate.cache.busy);
                if (!oldest) throw new Error('Public profile capacity is busy.');
                publicProfiles.delete(oldest[0]);
            }
            entry = { cache: createPublicProfileCache(storage.scoped(identity),
                configuration, selection, options.fetcher), active: 0 };
        }
        publicProfiles.delete(identity);
        publicProfiles.set(identity, entry);
        entry.active++;
        try {
            return await entry.cache.read(range, waitUntil, {
                sources: readOptions.sources ?? selection.sources,
            });
        } finally {
            entry.active--;
        }
    }

    function refreshConfigured(): Promise<StatsSnapshot> {
        if (closing) return Promise.reject(new Error('CodeStats is closing.'));
        if (refreshOperation) return refreshOperation;
        const range = RANGES.includes(configuration.DEFAULT_RANGE as Range)
            ? configuration.DEFAULT_RANGE as Range : 'all_time';
        const operation = withConfigured(async prepared => {
            const pending: Promise<unknown>[] = [];
            const before = await prepared.cache.read(range, promise => {
                pending.push(promise); waitUntil(promise);
            }, { force: true });
            noteConfiguredRetry(prepared, before);
            await Promise.allSettled(pending);
            const after = await prepared.cache.read(range, waitUntil);
            noteConfiguredRetry(prepared, after);
            return after;
        });
        const tracked = operation.finally(() => {
            if (refreshOperation === tracked) refreshOperation = undefined;
        });
        refreshOperation = tracked;
        waitUntil(tracked);
        return tracked;
    }

    const handler = createHandler((_env, range, selection, readOptions) =>
        selection.mode === 'public'
            ? readPublic(range, selection, readOptions)
            : readConfigured(range, readOptions),
    (_env, payload) => configuredBase().saveCodexUsage(payload));
    const server: Server = createServer(async (incoming, outgoing) => {
        try {
            const url = new URL(incoming.url ?? '/', 'http://localhost');
            const imports = incoming.method === 'POST'
                && url.pathname === CODEX_IMPORT_PATH;
            if (!['GET', 'HEAD'].includes(incoming.method ?? 'GET') && !imports) {
                incoming.resume();
                outgoing.writeHead(405, { Allow: 'GET, HEAD' });
                outgoing.end('Method not allowed');
                return;
            }
            let body: Uint8Array | undefined;
            if (imports) {
                const chunks: Buffer[] = [];
                let size = 0;
                for await (const chunk of incoming.iterator({ destroyOnReturn: false })) {
                    size += chunk.length;
                    if (size > MAX_USAGE_BODY) {
                        outgoing.writeHead(413);
                        outgoing.end('Usage payload is too large.');
                        incoming.resume();
                        return;
                    }
                    chunks.push(chunk);
                }
                body = Buffer.concat(chunks);
            } else {
                incoming.resume();
            }
            const request = new Request(
                url, {
                    method: incoming.method ?? 'GET',
                    ...(body ? { body } : {}),
                    headers: Object.fromEntries(Object.entries(incoming.headers)
                        .filter((entry): entry is [string, string] =>
                            typeof entry[1] === 'string')),
                },
            );
            const response = await handler.fetch(request, configuration);
            outgoing.writeHead(response.status,
                Object.fromEntries(response.headers.entries()));
            outgoing.end(Buffer.from(await response.arrayBuffer()));
        } catch {
            // Upstream errors are sanitized by the collectors/cache. Never emit
            // raw HTTP, filesystem or configuration errors to a client or log.
            if (!outgoing.headersSent) {
                outgoing.writeHead(500, {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'no-store',
                });
                outgoing.end('CodeStats is temporarily unavailable.');
            } else {
                outgoing.destroy();
            }
        }
    });
    server.requestTimeout = 60_000;
    server.headersTimeout = 15_000;
    const interval = refreshSeconds ? setInterval(() => {
        void refreshConfigured().catch(() => undefined);
    }, refreshSeconds * 1000) : undefined;
    interval?.unref();
    let closePromise: Promise<void> | undefined;
    return {
        server,
        storage,
        refreshConfigured,
        get publicProfileCount() { return publicProfiles.size; },
        async listen(port = 8791, host = '127.0.0.1'): Promise<string> {
            if (!Number.isInteger(port) || port < 0 || port > 65535) {
                throw new Error('PORT must be an integer from 0 to 65535.');
            }
            await new Promise<void>((accept, reject) => {
                const failed = (error: Error) => { reject(error); };
                server.once('error', failed);
                server.listen(port, host, () => {
                    server.removeListener('error', failed);
                    accept();
                });
            });
            const address = server.address() as AddressInfo;
            const hostname = address.family === 'IPv6'
                ? '[' + address.address + ']' : address.address;
            return 'http://' + hostname + ':' + address.port;
        },
        close(): Promise<void> {
            closePromise ??= (async () => {
                closing = true;
                if (interval) clearInterval(interval);
                if (server.listening) {
                    await new Promise<void>((accept, reject) => {
                        server.close(error => error ? reject(error) : accept());
                    });
                }
                // Let stale-while-revalidate finish before closing its database.
                while (background.size) {
                    await Promise.allSettled([...background]);
                }
                storage.close();
                publicProfiles.clear();
            })();
            return closePromise;
        },
    };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    let service: ReturnType<typeof createNodeService> | undefined;
    try {
        service = createNodeService(settingsFromEnvironment(), {
            dataDirectory: process.env.CODESTATS_DATA_DIR,
        });
        for (const signal of ['SIGINT', 'SIGTERM'] as const) {
            process.once(signal, () => {
                void service?.close().catch(() => { process.exitCode = 1; });
            });
        }
        const url = await service.listen(Number(process.env.PORT ?? 8791),
            process.env.HOST ?? '127.0.0.1');
        console.log('CodeStats ready at ' + url);
    } catch {
        await service?.close();
        console.error('CodeStats could not listen; check HOST, PORT and the private data directory.');
        process.exitCode = 1;
    }
}
