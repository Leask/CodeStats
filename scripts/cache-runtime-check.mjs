import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Fully isolated workerd runtime and SQLite store; all upstream traffic mocked.
const directory = await mkdtemp(join(tmpdir(), 'codestats-runtime-'));
const scriptPath = join(directory, 'worker.mjs');
await build({
    entryPoints: ['test/runtime-entry.ts'], outfile: scriptPath,
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    external: ['cloudflare:workers'],
});
let failing = false;
let requests = 0;
const outboundService = async request => {
    requests++;
    const url = new URL(request.url);
    assert.ok(['api.github.com', 'api.wakatime.com'].includes(url.hostname));
    if (failing) {
        return new Response('upstream unavailable', { status: 503 });
    }
    if (url.hostname === 'api.wakatime.com') {
        return Response.json({ data: {
            total_seconds_including_other_language: 100,
            daily_average_including_other_language: 10,
            is_including_today: false,
            is_up_to_date: true,
            human_readable_range: 'test fixture',
            languages: [
                { name: 'TypeScript', total_seconds: 70, percent: 70 },
                { name: 'Other', total_seconds: 30, percent: 30 },
            ],
        } });
    }
    const { query } = await request.json();
    if (query.includes('query Profile')) {
        return Response.json({ data: {
            user: {
                login: 'test', name: 'Test', followers: { totalCount: 2 },
                publicRepositories: { totalCount: 1 },
            },
            prs: { issueCount: 4 }, merged: { issueCount: 3 }, issues: { issueCount: 2 },
        } });
    }
    return Response.json({ data: { user: { repositories: {
        totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [{
            id: 'test-repository', isPrivate: false, isFork: false,
            stargazerCount: 8, forkCount: 2,
            languages: {
                totalSize: 1000, pageInfo: { hasNextPage: false, endCursor: null },
                edges: [{ size: 1000, node: { name: 'TypeScript', color: '#3178c6' } }],
            },
        }],
    } } } });
};
const create = (login = 'test') => new Miniflare({
    ...convertV4MiniflareOptions({
        name: 'codestats-runtime-test',
        rootPath: directory,
        modules: true, scriptPath, compatibilityDate: '2026-10-25',
        durableObjects: { SNAPSHOTS: { className: 'RuntimeTestStore', useSQLite: true } },
        outboundService,
        bindings: {
            GITHUB_USERNAME: login, WAKATIME_USERNAME: 'test',
            GITHUB_TOKEN: 'isolated-test-token-not-a-secret',
            DEFAULT_RANGE: 'all_time', FRESH_SECONDS: '60', RETRY_SECONDS: '900',
        },
    }),
    resourcePersistencePath: join(directory, 'state'),
});
const stats = async mf => (await mf.dispatchFetch('https://test.invalid/api/stats')).json();
const checks = {};
let mf = create();
try {
    const first = await stats(mf);
    checks.realWorkerdFresh = first.github.status === 'fresh'
        && first.wakatime.status === 'fresh';
    assert.ok(checks.realWorkerdFresh);
    const binding = (await mf.getBindings()).SNAPSHOTS;
    const id = binding.idFromName('public-v1:test:test');
    await binding.get(id).fetch('https://test.invalid/test/age');
    failing = true;
    const stale = await stats(mf);
    checks.expiredSnapshotServed = stale.github.status === 'stale'
        && stale.wakatime.status === 'stale';
    let failed;
    for (let attempt = 0; attempt < 30; attempt++) {
        failed = await stats(mf);
        if (failed.github.lastError && failed.wakatime.lastError) break;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    checks.lastGoodRetainedOn503 = failed.github.data.totalBytes === 1000
        && failed.wakatime.data.totalSeconds === 100
        && failed.github.lastSuccessAt === '2020-01-01T00:00:00.000Z'
        && failed.wakatime.lastSuccessAt === '2020-01-01T00:00:00.000Z';
    checks.failureRecorded = Boolean(failed.github.lastError && failed.wakatime.lastError);
    const calls = requests;
    await stats(mf);
    await stats(mf);
    checks.failureCooldown = requests === calls;
    const svg = await mf.dispatchFetch('https://test.invalid/card.svg');
    const markup = await svg.text();
    checks.readmeImageSurvives = svg.status === 200
        && svg.headers.get('content-type').includes('image/svg+xml')
        && markup.includes('SAVED SNAPSHOT') && markup.includes('TypeScript');
    await mf.dispose();
    mf = create();
    const restart = await stats(mf);
    checks.sqliteSurvivesRestart = JSON.stringify(restart.github.data)
        === JSON.stringify(first.github.data)
        && JSON.stringify(restart.wakatime.data) === JSON.stringify(first.wakatime.data)
        && restart.github.status === 'stale'
        && restart.github.lastSuccessAt === failed.github.lastSuccessAt;
    checks.restartPreservesCooldown = requests === calls;
    await mf.dispose();
    mf = create('uncached');
    const cold = await stats(mf);
    checks.noMadeUpColdData = cold.github.data === null && cold.wakatime.data === null
        && cold.github.status === 'unavailable' && cold.github.lastSuccessAt === null;
    assert.ok(Object.values(checks).every(Boolean), JSON.stringify(checks));
    const result = {
        checkedAt: new Date().toISOString(), checks,
        realRuntime: 'Cloudflare workerd with SQLite Durable Objects',
        isolation: 'Temporary store; mocked upstreams; no real tokens or cloud resources',
        originalPreviewStoreUntouched: true,
    };
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/cache-runtime-review.json', JSON.stringify(result, null, 4) + '\n');
    console.log(JSON.stringify(result));
} finally {
    await mf.dispose();
}
