import { DurableObject } from 'cloudflare:workers';
import { createHandler } from './app';
import { createProfileCache, profileIdentity } from './snapshot';
import { RANGES } from './types';
import type { SnapshotCache } from './cache';
import type { Env, Range, StatsSnapshot } from './types';
import { UpstreamError } from './errors';

/** Stable profile object; scope-specific GitHub keys preserve WakaTime data. */
export class SnapshotStore extends DurableObject<Env> {
    private readonly cache: SnapshotCache;

    constructor(private readonly state: DurableObjectState, env: Env) {
        super(state, env);
        this.cache = createProfileCache(state.storage, env);
    }

    async fetch(request: Request): Promise<Response> {
        if (new URL(request.url).pathname === '/codex'
            && request.method === 'POST') {
            try {
                await this.cache.saveCodexUsage(await request.json());
                return Response.json({ saved: true });
            } catch {
                return new Response('Invalid Codex aggregate import.', { status: 400 });
            }
        }
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

export default createHandler(snapshot, async (env, payload) => {
    const id = env.SNAPSHOTS.idFromName(profileIdentity(env));
    const response = await env.SNAPSHOTS.get(id).fetch('https://snapshot.internal/codex', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!response.ok) throw new UpstreamError('Could not save the Codex observation.');
}) satisfies ExportedHandler<Env>;
