// Test-only entry point. This class is never exported by the production Worker.
import worker, { SnapshotStore } from '../src/index';
import type { Env, SourceSnapshot } from '../src/types';

export class RuntimeTestStore extends SnapshotStore {
    constructor(
        state: DurableObjectState,
        env: Env,
        private readonly testStorage = state.storage,
    ) {
        super(state, env);
    }

    override async fetch(request: Request): Promise<Response> {
        if (new URL(request.url).pathname === '/test/age') {
            for (const key of [
                'github', 'github:all-v1', 'github:activity:all:v1',
                'wakatime:all_time',
            ]) {
                const record = await this.testStorage.get<SourceSnapshot<unknown>>(key);
                if (record?.data) {
                    await this.testStorage.put(key, {
                        ...record, lastSuccessAt: '2020-01-01T00:00:00.000Z',
                        retryAt: null,
                    });
                }
            }
            return new Response('Aged isolated test data');
        }
        return super.fetch(request);
    }
}

export default worker;
