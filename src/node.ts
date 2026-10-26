import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler } from './app';
import { SqliteStorage } from './node-storage';
import { createProfileCache, profileIdentity } from './snapshot';
import type { Fetcher, Settings } from './types';

interface NodeOptions {
    dataDirectory?: string;
    fetcher?: Fetcher;
}

export function settingsFromEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
): Settings {
    const visibility = environment.GITHUB_VISIBILITY ?? 'all';
    if (visibility !== 'public' && visibility !== 'all') {
        throw new Error('GITHUB_VISIBILITY must be public or all.');
    }
    return {
        GITHUB_USERNAME: environment.GITHUB_USERNAME ?? 'Leask',
        GITHUB_VISIBILITY: visibility,
        WAKATIME_USERNAME: environment.WAKATIME_USERNAME ?? 'leask',
        DEFAULT_RANGE: environment.DEFAULT_RANGE ?? 'all_time',
        FRESH_SECONDS: environment.FRESH_SECONDS ?? '21600',
        RETRY_SECONDS: environment.RETRY_SECONDS ?? '900',
        GITHUB_TOKEN: environment.GITHUB_TOKEN,
        WAKATIME_TOKEN: environment.WAKATIME_TOKEN,
    };
}

/** HTTP and SQLite are the only Node-specific parts of the shared application. */
export function createNodeService(settings: Settings, options: NodeOptions = {}) {
    const storage = new SqliteStorage(
        options.dataDirectory ?? resolve('.data'), profileIdentity(settings),
    );
    const cache = createProfileCache(storage, settings, options.fetcher);
    const background = new Set<Promise<unknown>>();
    const waitUntil = (promise: Promise<unknown>) => {
        const observed = promise.catch(() => undefined);
        background.add(observed);
        void observed.finally(() => background.delete(observed));
    };
    const handler = createHandler((_env, range) => cache.read(range, waitUntil));
    const server: Server = createServer(async (incoming, outgoing) => {
        // No endpoint accepts bodies. Drain them without retaining user input.
        incoming.resume();
        try {
            if (!['GET', 'HEAD'].includes(incoming.method ?? 'GET')) {
                outgoing.writeHead(405, { Allow: 'GET, HEAD' });
                outgoing.end('Method not allowed');
                return;
            }
            const request = new Request(
                new URL(incoming.url ?? '/', 'http://localhost'), {
                    method: incoming.method ?? 'GET',
                    headers: Object.fromEntries(Object.entries(incoming.headers)
                        .filter((entry): entry is [string, string] =>
                            typeof entry[1] === 'string')),
                },
            );
            const response = await handler.fetch(request, settings);
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
    let closePromise: Promise<void> | undefined;
    return {
        server,
        storage,
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
