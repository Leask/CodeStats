import { DurableObject } from 'cloudflare:workers';
import { createHandler } from './app';
import {
    createProfileCache, createPublicProfileCache, prepareConfiguredProfile, profileIdentity,
} from './snapshot';
import { publicProfileIdentity, resolveProfile } from './profile';
import type { ProfileSelection } from './profile';
import { RANGES } from './types';
import type { ReadOptions, SnapshotCache } from './cache';
import type { Env, Range, StatsSnapshot } from './types';
import { UpstreamError } from './errors';

/** Stable profile object; scope-specific GitHub keys preserve WakaTime data. */
export class SnapshotStore extends DurableObject<Env> {
    private configuredPromise?: ReturnType<typeof prepareConfiguredProfile>;
    private configured?: Awaited<ReturnType<typeof prepareConfiguredProfile>>;
    private retryAt = 0;
    private readers = 0;
    private publicCache?: SnapshotCache;
    private baseCache?: SnapshotCache;

    constructor(private readonly state: DurableObjectState, env: Env) {
        super(state, env);
    }

    private matches(identity: string): boolean {
        return this.state.id.toString()
            === this.env.SNAPSHOTS.idFromName(identity).toString();
    }

    private configuredBase(): SnapshotCache {
        return this.baseCache ??= createProfileCache(this.state.storage, this.env);
    }

    private unresolved(value: Awaited<ReturnType<typeof prepareConfiguredProfile>>) {
        return !this.env.WAKATIME_USERNAME.trim()
            && !!this.env.WAKATIME_TOKEN?.trim()
            && !value.settings.WAKATIME_USERNAME.trim();
    }

    private async withConfigured<T>(operation: (
        value: Awaited<ReturnType<typeof prepareConfiguredProfile>>,
    ) => Promise<T>): Promise<T> {
        if (this.env.WAKATIME_USERNAME.trim() || !this.env.WAKATIME_TOKEN?.trim()) {
            return operation({ cache: this.configuredBase(), settings: this.env });
        }
        if (this.configured && this.unresolved(this.configured)
            && Date.now() >= this.retryAt && this.readers === 0
            && !this.configured.cache.busy) {
            this.configuredPromise = undefined;
            this.configured = undefined;
        }
        this.readers++;
        try {
            this.configuredPromise ??= prepareConfiguredProfile(
                this.state.storage, this.env,
            ).then(value => {
                this.configured = value;
                const delay = Number(this.env.RETRY_SECONDS);
                this.retryAt = this.unresolved(value) ? Date.now()
                    + (Number.isFinite(delay) ? Math.max(60, delay) : 900) * 1000 : 0;
                return value;
            }).catch(error => {
                this.configuredPromise = undefined;
                throw error;
            });
            return await operation(await this.configuredPromise);
        } finally {
            this.readers--;
        }
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        if (!['/', '/public', '/codex'].includes(url.pathname)) {
            return new Response('Not found', { status: 404 });
        }
        let selection: ProfileSelection;
        try {
            selection = resolveProfile(url, this.env);
        } catch {
            return new Response('Invalid profile selectors.', { status: 400 });
        }
        const isPublic = url.pathname === '/public';
        if (isPublic !== (selection.mode === 'public')
            || !this.matches(isPublic ? publicProfileIdentity(selection)
                : profileIdentity(this.env))) {
            return new Response('Profile object does not match selectors.', { status: 400 });
        }
        if (url.pathname === '/codex') {
            if (request.method !== 'POST' || url.search) {
                return new Response('Invalid import request.', { status: 400 });
            }
            try {
                const payload: unknown = await request.json();
                await this.configuredBase().saveCodexUsage(payload);
                return Response.json({ saved: true });
            } catch {
                return new Response('Invalid Codex aggregate import.', { status: 400 });
            }
        }
        if (request.method !== 'GET' || isPublic && url.searchParams.has('force')) {
            return new Response('Invalid snapshot request.', { status: 400 });
        }
        const range = url.searchParams.get('range') as Range;
        if (!RANGES.includes(range)) {
            return new Response('Invalid range', { status: 400 });
        }
        const options: ReadOptions = {
            ...(isPublic || url.searchParams.has('sources')
                ? { sources: selection.sources } : {}),
            ...(url.searchParams.get('force') === 'true' ? { force: true } : {}),
        };
        const waitUntil = (promise: Promise<unknown>) => this.state.waitUntil(promise);
        const value = isPublic
            ? await (this.publicCache ??= createPublicProfileCache(
                this.state.storage, this.env, selection,
            )).read(range, waitUntil, options)
            : options.sources && !options.sources.includes('wakatime')
            ? await this.configuredBase().read(range, waitUntil, options)
            : await this.withConfigured(async prepared => {
                const result = await prepared.cache.read(range, waitUntil, options);
                if (this.unresolved(prepared) && result.wakatime.retryAt) {
                    const retryAt = Date.parse(result.wakatime.retryAt);
                    if (Number.isFinite(retryAt)) this.retryAt = Math.max(this.retryAt, retryAt);
                }
                return result;
            });
        return Response.json(value);
    }
}

async function snapshot(env: Env, range: Range,
    selection: ProfileSelection, options: ReadOptions): Promise<StatsSnapshot> {
    const identity = selection.mode === 'public'
        ? publicProfileIdentity(selection) : profileIdentity(env);
    const id = env.SNAPSHOTS.idFromName(identity);
    const url = new URL(selection.mode === 'public'
        ? 'https://snapshot.internal/public' : 'https://snapshot.internal/');
    url.searchParams.set('range', range);
    if (selection.mode === 'public') {
        for (const [service, username] of Object.entries(selection.accounts)) {
            url.searchParams.set(service, username);
        }
    }
    if (options.sources) url.searchParams.set('sources', options.sources.join(','));
    if (options.force && selection.mode === 'configured') {
        url.searchParams.set('force', 'true');
    }
    const response = await env.SNAPSHOTS.get(id).fetch(url.toString());
    if (!response.ok) {
        throw new Error('Snapshot unavailable');
    }
    return response.json<StatsSnapshot>();
}

const handler = createHandler(snapshot, async (env, payload) => {
    const id = env.SNAPSHOTS.idFromName(profileIdentity(env));
    const response = await env.SNAPSHOTS.get(id).fetch('https://snapshot.internal/codex', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) throw new UpstreamError('Could not save the Codex observation.');
});

export default {
    ...handler,
    async scheduled(_controller: ScheduledController, env: Env,
        context: ExecutionContext): Promise<void> {
        const range = RANGES.includes(env.DEFAULT_RANGE as Range)
            ? env.DEFAULT_RANGE as Range : 'all_time';
        // Only explicitly configured default accounts are ever refreshed.
        const operation = snapshot(env, range,
            resolveProfile(new URL('https://snapshot.internal/'), env), { force: true });
        context.waitUntil(operation);
        await operation;
    },
} satisfies ExportedHandler<Env>;
