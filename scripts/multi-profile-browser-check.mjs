import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// All requests execute the actual Wrangler bundle, with finite fake upstreams.
// Chrome uses a fresh context; no existing browser profile or account is read.
const providers = ['github', 'wakatime', 'codex', 'openrouter'];
const origin = 'https://multi-profile.codestats.test';
const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const temporary = await mkdtemp(join(tmpdir(), 'codestats-multi-browser-'));
const syncToken = 'isolated-multi-sync-fixture-not-a-secret'.repeat(2);
const wakaToken = 'isolated-waka-owner-fixture';
const routerToken = 'isolated-router-owner-fixture';
const upstreamCalls = [];
const browserCalls = [];
const checks = {};
const layoutCases = [];
const errors = [];
const masks = Array.from({ length: 15 }, (_, index) => providers
    .filter((_, bit) => (index + 1) & (1 << bit)));

function waka(username, seconds) {
    return { data: {
        username, is_up_to_date: true, is_including_today: false,
        total_seconds_including_other_language: seconds,
        daily_average_including_other_language: 3600,
        start: '2020-01-01T00:00:00Z', end: '2026-10-28T00:00:00Z',
        languages: [{ name: 'TypeScript', total_seconds: seconds * 0.7, percent: 70 },
            { name: 'Python', total_seconds: seconds * 0.2, percent: 20 },
            { name: 'Other', total_seconds: seconds * 0.1, percent: 10 }],
    } };
}

function ownerId(username) { return username === 'owner' ? 1 : 2; }

async function upstream(request) {
    const url = new URL(request.url);
    const authorization = request.headers.get('authorization');
    upstreamCalls.push({ host: url.hostname, path: url.pathname, authorization });
    if (url.hostname === 'api.github.com') {
        assert.equal(authorization, null);
        if (url.pathname.startsWith('/search/')) {
            const query = url.searchParams.get('q') || '';
            const total = query.includes('is:merged') ? 2
                : url.pathname.endsWith('/commits') ? 17 : 5;
            return Response.json({ total_count: total, incomplete_results: false });
        }
        const match = url.pathname.match(/^\/users\/([a-z\d-]+)(\/repos)?$/i);
        assert.ok(match, 'Only public profile/repository metadata may be requested.');
        const username = match[1];
        if (match[2]) return Response.json([{
            id: ownerId(username) * 100, name: 'fixture',
            full_name: username + '/fixture', private: false, visibility: 'public',
            fork: false, owner: { id: ownerId(username), login: username },
            stargazers_count: 3, forks_count: 2,
        }]);
        return Response.json({ id: ownerId(username), login: username,
            name: username === 'owner' ? 'Owner public profile' : 'Visitor public profile',
            public_repos: 1, followers: 7, bio: 'Isolated public fixture', avatar_url: null });
    }
    if (url.hostname === 'api.wakatime.com') {
        if (url.pathname === '/api/v1/users/current') {
            assert.equal(authorization, 'Bearer ' + wakaToken);
            return Response.json({ data: { username: 'owner' } });
        }
        const match = url.pathname.match(/^\/api\/v1\/users\/([^/]+)\/stats\/(all_time|last_7_days|last_30_days)$/);
        assert.ok(match, 'Only bounded WakaTime range statistics may be requested.');
        if (match[1] === 'owner') {
            if (!authorization) return new Response('Private fixture', { status: 404 });
            assert.equal(authorization, 'Bearer ' + wakaToken);
            return Response.json(waka('owner', 654320));
        }
        assert.equal(authorization, null);
        return Response.json(waka(match[1], 360000));
    }
    if (url.hostname === 'openrouter.ai') {
        assert.equal(url.pathname, '/api/v1/analytics/query');
        assert.equal(authorization, 'Bearer ' + routerToken);
        const query = await request.json();
        assert.deepEqual(query.metrics, ['tokens_total', 'request_count']);
        assert.equal(query.granularity, 'day');
        return Response.json({ data: { data: [{
            date__day: query.time_range.start.slice(0, 10),
            tokens_total: '42000000', request_count: '129146',
        }], metadata: { row_count: 1, truncated: false } } });
    }
    throw new Error('Unexpected outbound origin in isolated browser test.');
}

const mf = new Miniflare({
    ...convertV4MiniflareOptions({
        name: 'codestats-multi-profile-browser', rootPath: process.cwd(),
        modules: true, scriptPath: resolve('dist/index.js'),
        compatibilityDate: config.compatibility_date,
        durableObjects: { SNAPSHOTS: { className: 'SnapshotStore', useSQLite: true } },
        bindings: { ...config.vars, GITHUB_USERNAME: 'owner', GITHUB_TOKEN: '',
            WAKATIME_USERNAME: 'owner', WAKATIME_TOKEN: wakaToken,
            CODEX_USERNAME: 'owner-codex', CODEX_USAGE_ENABLED: 'true',
            CODEX_SYNC_TOKEN: syncToken, OPENROUTER_API_KEY: routerToken,
            ANTHROPIC_ADMIN_KEY: '', AUTO_REFRESH_SECONDS: '0' },
        outboundService: upstream,
    }),
    resourcePersistencePath: temporary,
});

async function json(path) {
    const response = await mf.dispatchFetch(origin + path);
    assert.equal(response.status, 200, path);
    return response.json();
}

function source(data) {
    return { data, status: 'fresh', lastSuccessAt: '2026-10-28T12:00:00Z',
        lastAttemptAt: '2026-10-28T12:00:00Z', lastError: null, retryAt: null };
}

function renderFixture(selected) {
    return {
        schemaVersion: 1, generatedAt: '2026-10-28T14:00:00Z', range: 'all_time',
        selectedSources: selected,
        profile: { mode: 'configured', accounts: {
            github: 'fixture-user', wakatime: 'fixture-waka', codex: 'fixture-codex',
        } },
        github: source({ collectionVersion: 7, username: 'fixture-user',
            name: 'Fixture Developer', followers: 501, repositories: 559,
            publicRepositories: 450, visibility: 'all', analyzedRepositories: 559,
            stars: 1386, forks: 20, pullRequests: 649, mergedPullRequests: 531,
            issues: 288, totalBytes: 1000, scope: 'Synthetic complete language aggregate',
            languages: [{ name: 'C++', bytes: 397, color: '#f34b7d' },
                { name: 'TypeScript', bytes: 300, color: '#3178c6' },
                { name: 'Python', bytes: 203, color: '#3572a5' },
                { name: 'Shell', bytes: 100, color: '#89e051' }],
            repositoryLanguageCounts: [{ languages: ['C++', 'TypeScript'], repositories: 12 },
                { languages: ['Python', 'Shell'], repositories: 7 }] }),
        githubActivity: source({ collectionVersion: 3, username: 'fixture-user',
            visibility: 'all', scope: 'Synthetic complete activity aggregate',
            commits: 47755, allTimeContributions: 48648,
            contributionsByYear: [{ year: 2026, contributions: 48648 }],
            reviewContributions: 479, pullRequestsReviewed: 67,
            pullRequestsCommented: 111, issuesCommented: 166,
            contributedRepositories: 94, allTimeContributedRepositories: 532 }),
        wakatime: source({ username: 'fixture-waka', range: 'all_time',
            totalSeconds: 10000, dailyAverageSeconds: 300, start: '2020-01-01',
            end: '2026-10-28', includesToday: false, rangeLabel: 'since 2020',
            languages: [{ name: 'C++', seconds: 2000, percent: 20 },
                { name: 'TypeScript', seconds: 4200, percent: 42 },
                { name: 'Python', seconds: 2800, percent: 28 },
                { name: 'Other', seconds: 1000, percent: 10 }] }),
        aiUsage: {
            codex: source({ collectionVersion: 2, service: 'codex', label: 'Codex',
                totalTokens: 131320846898, period: 'Lifetime', since: null,
                until: '2026-10-28T12:00:00Z', scope: 'Synthetic Codex aggregate',
                summary: { peakDailyTokens: 5262475191, longestRunningTurnSec: 203454,
                    longestStreakDays: 109, currentStreakDays: 82 } }),
            openrouter: source({ collectionVersion: 3, service: 'openrouter', label: 'OpenRouter',
                totalTokens: 292800000, totalPrompts: 129146, period: 'Last 367 days',
                since: '2025-10-26T00:00:00Z', until: '2026-10-28T00:00:00Z',
                scope: 'Synthetic OpenRouter aggregate', summary: {
                    averageDailyTokens: 797955, averageWeeklyTokens: 5585688,
                    longestStreakDays: 120 } }),
        },
    };
}

function inspectGeometry() {
    const root = document.querySelector('main > svg');
    const bounds = root.getBoundingClientRect();
    const tolerance = 0.8;
    const outOfBounds = [...root.querySelectorAll('text')].filter(node => {
        const rect = node.getBoundingClientRect();
        return rect.width && (rect.left < bounds.left - tolerance
            || rect.right > bounds.right + tolerance || rect.top < bounds.top - tolerance
            || rect.bottom > bounds.bottom + tolerance);
    }).map(node => node.textContent);
    const metrics = [...root.querySelectorAll('[data-source-metric]')];
    const collisions = [];
    for (let left = 0; left < metrics.length; left++) {
        const a = metrics[left].getBoundingClientRect();
        for (let right = left + 1; right < metrics.length; right++) {
            const b = metrics[right].getBoundingClientRect();
            if (a.left < b.right - tolerance && b.left < a.right - tolerance
                && a.top < b.bottom - tolerance && b.top < a.bottom - tolerance) {
                collisions.push([metrics[left].dataset.sourceMetric, metrics[right].dataset.sourceMetric]);
            }
        }
    }
    const sections = [...root.querySelectorAll('[data-source-section]')];
    const sectionOrder = sections.map(node => node.dataset.sourceSection);
    const refreshOrder = [...root.querySelectorAll('[data-refresh-source]')]
        .map(node => node.dataset.refreshSource);
    const refresh = root.querySelector('[data-source-footer] > g');
    const credit = root.querySelector('[data-project-credit]');
    const refreshBox = refresh?.getBoundingClientRect();
    const creditBox = credit?.getBoundingClientRect();
    const footerCollision = !!refreshBox && !!creditBox
        && refreshBox.left < creditBox.right - tolerance
        && creditBox.left < refreshBox.right - tolerance
        && refreshBox.top < creditBox.bottom - tolerance
        && creditBox.top < refreshBox.bottom - tolerance;
    return { outOfBounds, collisions, sectionOrder, refreshOrder, footerCollision,
        width: bounds.width, height: bounds.height };
}

let browser;
try {
    await mkdir('artifacts', { recursive: true });
    assert.equal(config.keep_names, false);
    const upload = await mf.dispatchFetch(origin + '/api/usage/codex', {
        method: 'POST', headers: { Authorization: 'Bearer ' + syncToken,
            'Content-Type': 'application/json' },
        body: JSON.stringify({ observedAt: new Date(Date.now() - 3600000).toISOString(),
            summary: { lifetimeTokens: 131320846898, peakDailyTokens: 5262475191,
                longestRunningTurnSec: 203454, currentStreakDays: 82, longestStreakDays: 109 } }),
    });
    assert.equal(upload.status, 200);
    const owner = await json('/api/stats');
    assert.equal(owner.wakatime.data.totalSeconds, 654320);
    assert.equal(owner.aiUsage.codex.data.totalTokens, 131320846898);
    assert.equal(owner.aiUsage.openrouter.data.totalTokens, 42000000);
    checks.configuredFourProviders = owner.selectedSources.length === 4;
    for (const selected of masks) {
        const value = await json('/api/stats?sources=' + selected.join(','));
        assert.deepEqual(value.selectedSources, selected);
        assert.equal(value.github.data !== null, selected.includes('github'));
        assert.equal(value.wakatime.data !== null, selected.includes('wakatime'));
        assert.equal(!!value.aiUsage?.codex?.data, selected.includes('codex'));
        assert.equal(!!value.aiUsage?.openrouter?.data, selected.includes('openrouter'));
    }
    checks.configuredFifteenMasks = true;
    const before = upstreamCalls.length;
    const sameName = await json('/api/stats?github=owner&wakatime=owner&codex=owner-codex'
        + '&sources=github,wakatime,codex,openrouter');
    checks.sameNamePublicIsolation = sameName.profile.mode === 'public'
        && sameName.github.data.visibility === 'public' && sameName.wakatime.data === null
        && sameName.aiUsage.codex.data === null && sameName.aiUsage.openrouter.data === null
        && upstreamCalls.slice(before).every(call => call.authorization === null);
    assert.ok(checks.sameNamePublicIsolation);
    const rejected = await mf.dispatchFetch(origin + '/api/stats?github=alice&token=fixture-do-not-echo');
    checks.secretQueryRejected = rejected.status === 400
        && !(await rejected.text()).includes('fixture-do-not-echo');
    const html = await (await mf.dispatchFetch(origin + '/build')).text();
    checks.actualBundleHasAccountControls = html.includes('id="account-mode"')
        && !html.includes('__name(');
    assert.ok(checks.actualBundleHasAccountControls);
    const installed = '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta';
    browser = await chromium.launch({ headless: true,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
            ?? (existsSync(installed) ? installed : undefined) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route(origin + '/**', async route => {
        const request = route.request();
        browserCalls.push(request.url());
        const response = await mf.dispatchFetch(request.url());
        await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers),
            body: Buffer.from(await response.arrayBuffer()) });
    });
    const wait = async () => {
        await page.waitForFunction(() => document.querySelector('#loading').hidden);
        await page.locator('#card').evaluate(image => image.decode());
    };
    await page.goto(origin + '/build'); await wait();
    checks.noTokenInputs = await page.locator(
        'input[id*="token"],input[name*="token"],input[type="password"]',
    ).count() === 0;
    checks.overviewDefault = await page.locator('#view').inputValue() === 'overview';
    await page.locator('#accounts > summary').click();
    await page.locator('#account-mode').selectOption('public');
    await page.locator('#github-account').fill('@Alice');
    await page.locator('#wakatime-account').fill('@Alice');
    await page.locator('#codex-account').fill('visitor-codex');
    await page.locator('#apply-profile').click(); await wait();
    const imageUrl = new URL(await page.locator('#card').getAttribute('src'), origin);
    const jsonUrl = new URL(await page.locator('#json-link').getAttribute('href'), origin);
    const snippet = await page.locator('#snippet').textContent();
    checks.appliedBareNames = ['github', 'wakatime'].every(key =>
        imageUrl.searchParams.get(key) === 'alice' && jsonUrl.searchParams.get(key) === 'alice')
        && imageUrl.searchParams.get('codex') === 'visitor-codex'
        && snippet.includes('github=alice') && snippet.includes('wakatime=alice')
        && snippet.includes('codex=visitor-codex');
    checks.canonicalCodexLink = await page.locator('#codex-profile-link').getAttribute('href')
        === 'https://chatgpt.com/u/visitor-codex';
    await page.locator('#source-openrouter').check(); await wait();
    checks.sourceCheckboxUpdatesRequest = new URL(
        await page.locator('#card').getAttribute('src'), origin,
    ).searchParams.get('sources') === providers.join(',');
    const invalidAccounts = [
        ['github', 'https://github.com/alice'],
        ['github', 'github_pat_fixture_accidental_key'],
        ['wakatime', 'waka_00000000-0000-0000-0000-000000000000'],
    ];
    checks.invalidNameRejectedBeforeRequest = true;
    for (const [provider, invalid] of invalidAccounts) {
        await page.locator('#github-account').fill('alice');
        await page.locator('#wakatime-account').fill('alice');
        const requestCount = browserCalls.filter(url => new URL(url).pathname === '/api/stats').length;
        await page.locator('#' + provider + '-account').fill(invalid);
        await page.locator('#apply-profile').click();
        checks.invalidNameRejectedBeforeRequest &&= await page.locator('#profile-error').isVisible()
            && browserCalls.filter(url => new URL(url).pathname === '/api/stats').length === requestCount;
    }
    await page.locator('#github-account').fill('alice');
    await page.locator('#wakatime-account').fill('alice');
    await page.locator('#apply-profile').click(); await wait();
    await page.screenshot({ path: 'artifacts/multi-profile-builder-public.png', fullPage: true });
    checks.maskAndViewControls = true;
    for (const selected of masks) {
        const query = new URLSearchParams({ github: 'alice', wakatime: 'alice',
            codex: 'visitor-codex', sources: selected.join(',') });
        await page.goto(origin + '/build?' + query); await wait();
        const checked = await page.locator('.source-picker input:checked')
            .evaluateAll(nodes => nodes.map(node => node.value));
        assert.deepEqual(checked, selected);
        const native = await json('/api/stats?' + query);
        assert.deepEqual(native.selectedSources, selected);
        assert.equal(native.github.data !== null, selected.includes('github'));
        assert.equal(native.wakatime.data !== null, selected.includes('wakatime'));
        assert.equal(native.aiUsage?.codex?.data ?? null, null);
        assert.equal(native.aiUsage?.openrouter?.data ?? null, null);
        for (const view of providers) {
            await page.locator('#view').selectOption(view);
            await page.locator('#card').evaluate(image => image.decode());
            const current = new URL(await page.locator('#card').getAttribute('src'), origin);
            const dataLink = new URL(await page.locator('#json-link').getAttribute('href'), origin);
            assert.equal(current.searchParams.get('view'), view);
            assert.equal(current.searchParams.get('sources'), selected.join(','));
            assert.equal(dataLink.searchParams.get('sources'), selected.join(','));
            assert.ok((await page.locator('#snippet').textContent()).includes('view=' + view));
        }
    }
    const compiled = await build({ entryPoints: ['src/render.ts'], bundle: true,
        platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
    const { renderCard } = await import('data:text/javascript;base64,'
        + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
    const svgPage = await context.newPage();
    const inspect = async (data, selected, view, width, header) => {
        const filtered = structuredClone(data);
        for (const provider of providers.filter(value => !selected.includes(value))) {
            if (provider === 'github' || provider === 'wakatime') {
                filtered[provider] = { ...filtered[provider], data: null, enabled: false };
                if (provider === 'github') delete filtered.githubActivity;
            } else delete filtered.aiUsage[provider];
        }
        const svg = renderCard(filtered, { theme: 'dark', view, sort: 'code', limit: 10, header });
        await svgPage.setViewportSize({ width: Math.max(880, width), height: 1400 });
        await svgPage.setContent('<style>body{margin:0}main>svg{display:block;width:100%;height:auto}</style>'
            + '<main style="width:' + width + 'px">' + svg + '</main>');
        const review = await svgPage.evaluate(inspectGeometry);
        const expected = view === 'overview' ? selected : [view];
        assert.deepEqual(review.sectionOrder, expected);
        assert.deepEqual(review.refreshOrder, expected);
        const entry = { sources: selected, view, width, header, ...review };
        layoutCases.push(entry);
        assert.deepEqual(review.outOfBounds, [], JSON.stringify(entry));
        assert.deepEqual(review.collisions, [], JSON.stringify(entry));
        assert.equal(review.footerCollision, false, JSON.stringify(entry));
        if (selected.length === 4 && width === 880 && header) {
            await svgPage.locator('main > svg').screenshot({
                path: 'artifacts/multi-profile-focused-' + view + '.png',
            });
        }
    };
    for (const selected of masks) {
        const fixture = renderFixture(selected);
        // Existing overview geometry remains under preview-check.mjs.
        const views = selected.includes('github') && selected.includes('wakatime')
            ? selected : ['overview', ...selected];
        for (const view of views) {
            for (const width of [880, 440, 320]) {
                for (const header of [true, false]) {
                    await inspect(fixture, selected, view, width, header);
                }
            }
        }
    }
    // Public partial/unsupported modes are also checked as actual Worker SVGs.
    for (const view of providers) {
        const query = '?github=alice&wakatime=alice&codex=visitor-codex&sources='
            + providers.join(',') + '&view=' + view;
        const markup = await (await mf.dispatchFetch(origin + '/card.svg' + query)).text();
        await svgPage.setContent('<style>body{margin:0}main>svg{display:block;width:100%;height:auto}</style>'
            + '<main style="width:320px">' + markup + '</main>');
        const review = await svgPage.evaluate(inspectGeometry);
        assert.deepEqual(review.outOfBounds, [], JSON.stringify({ view, review }));
        assert.deepEqual(review.sectionOrder, [view]);
        await svgPage.locator('main > svg').screenshot({
            path: 'artifacts/multi-profile-public-' + view + '.png',
        });
    }
    checks.allFifteenMasks = true;
    checks.focusedAndPartialGeometry = layoutCases.length > 200;
    checks.noBrowserErrors = errors.length === 0;
    checks.noExternalBrowserAssets = browserCalls.every(url => new URL(url).origin === origin);
    checks.noSecretsInBrowserUrls = browserCalls.every(url => !/token|api_key|access_key/i
        .test(new URL(url).search));
    const body = await page.content();
    checks.noOwnerSecretsInBuilder = [syncToken, wakaToken, routerToken].every(value =>
        !body.includes(value) && !JSON.stringify(browserCalls).includes(value));
    const result = { checkedAt: new Date().toISOString(), checks,
        surface: 'Isolated Chrome Beta through Playwright',
        runtime: 'Actual dist/index.js in workerd with SQLite Durable Objects',
        isolation: 'Temporary state, fake upstream responses; no real credentials or deployment',
        sourceMasks: masks.length, layoutCases: layoutCases.length, errors,
        screenshots: { builder: 'artifacts/multi-profile-builder-public.png',
            focusedCompleteFixtures: providers.map(provider =>
                'artifacts/multi-profile-focused-' + provider + '.png'),
            publicWorkerCards: providers.map(provider =>
                'artifacts/multi-profile-public-' + provider + '.png') } };
    await writeFile('artifacts/multi-profile-browser-review.json',
        JSON.stringify({ ...result, layouts: layoutCases }, null, 4) + '\n');
    console.log(JSON.stringify(result));
    assert.ok(Object.values(checks).every(Boolean));
} finally {
    await browser?.close();
    await mf.dispose();
    await rm(temporary, { recursive: true, force: true });
}
