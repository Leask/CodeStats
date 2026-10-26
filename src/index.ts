import { DurableObject } from 'cloudflare:workers';
import { createHandler } from './app';
import { createProfileCache, profileIdentity } from './snapshot';
import { RANGES } from './types';
import type { SnapshotCache } from './cache';
import type { Env, Range, StatsSnapshot } from './types';

/** Stable profile object; scope-specific GitHub keys preserve WakaTime data. */
export class SnapshotStore extends DurableObject<Env> {
    private readonly cache: SnapshotCache;

    constructor(private readonly state: DurableObjectState, env: Env) {
        super(state, env);
        this.cache = createProfileCache(state.storage, env);
    }

    async fetch(request: Request): Promise<Response> {
        const range = new URL(request.url).searchParams.get('range') as Range;
        if (!RANGES.includes(range)) {
            return new Response('Invalid range', { status: 400 });
        }
        const value = await this.cache.read(range,
            promise => this.state.waitUntil(promise));
        return Response.json(value);
    }
}

async function snapshot(env: Env, range: Range): Promise<StatsSnapshot> {
    const identity = profileIdentity(env);
    const id = env.SNAPSHOTS.idFromName(identity);
    const response = await env.SNAPSHOTS.get(id).fetch(
        'https://snapshot.internal/?range=' + range,
    );
    if (!response.ok) {
        throw new Error('Snapshot unavailable');
    }
    return response.json<StatsSnapshot>();
}

export default createHandler(snapshot) satisfies ExportedHandler<Env>;
