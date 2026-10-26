import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Execute the actual Wrangler bundle: Node-only HTML tests miss name helpers.
const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
assert.equal(config.keep_names, false);
assert.equal(config.minify, false);
const directory = await mkdtemp(join(tmpdir(), 'codestats-worker-browser-'));
const origin = 'https://codestats.test';
const mf = new Miniflare({
    ...convertV4MiniflareOptions({
        name: 'codestats-worker-browser-test', rootPath: process.cwd(),
        modules: true, scriptPath: resolve('dist/index.js'),
        compatibilityDate: config.compatibility_date,
        durableObjects: {
            SNAPSHOTS: { className: 'SnapshotStore', useSQLite: true },
        },
        bindings: { ...config.vars, GITHUB_USERNAME: 'test',
            WAKATIME_USERNAME: 'test' },
        outboundService: async request => {
            assert.equal(new URL(request.url).hostname, 'api.wakatime.com');
            return Response.json({ data: {
                total_seconds_including_other_language: 100,
                daily_average_including_other_language: 10,
                is_including_today: false, is_up_to_date: true,
                human_readable_range: 'test fixture',
                languages: [
                    { name: 'TypeScript', total_seconds: 70, percent: 70 },
                    { name: 'Other', total_seconds: 30, percent: 30 },
                ],
            } });
        },
    }),
    resourcePersistencePath: directory,
});
const installed = '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ?? (existsSync(installed) ? installed : undefined);
let browser;
const checks = {};
try {
    const html = await (await mf.dispatchFetch(origin + '/build')).text();
    checks.noBundlerHelperInBrowser = !html.includes('__name(');
    browser = await chromium.launch({ headless: true, executablePath });
    const context = await browser.newContext({
        permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let failure = '';
    await page.route(origin + '/**', async route => {
        const request = route.request();
        if (new URL(request.url()).pathname === '/api/stats' && failure) {
            await route.fulfill({ status: failure === '503' ? 503 : 200,
                contentType: 'text/html', body: '<html>Not JSON</html>' });
            return;
        }
        const response = await mf.dispatchFetch(request.url());
        await route.fulfill({ status: response.status,
            headers: Object.fromEntries(response.headers),
            body: Buffer.from(await response.arrayBuffer()) });
    });
    await page.goto(origin + '/build');
    await page.waitForFunction(() => document.querySelector('#loading').hidden);
    await page.locator('#card').evaluate(image => image.decode());
    checks.partialSourceStillRenders = await page.locator('#language-body tr').count() === 2;
    checks.missingSecretVisible = (await page.locator('#github-error').textContent())
        .includes('Configure a server-side GITHUB_TOKEN');
    checks.wakaStillFresh = await page.locator('#wakatime-status').textContent() === 'fresh';
    checks.transparentDefault = await page.locator('#theme').inputValue() === 'transparent';
    checks.readmeVisible = await page.locator('#readme-details').evaluate(node => node.open);
    const defaultMarkdown = '[![CodeStats](' + origin + '/)](https://github.com/Leask/CodeStats)';
    checks.compactProjectLinkedMarkdown = await page.locator('#snippet').textContent()
        === defaultMarkdown;
    await page.locator('#copy').click();
    checks.copy = await page.evaluate(() => navigator.clipboard.readText()) === defaultMarkdown;
    await page.locator('#theme').selectOption('light');
    await page.locator('#card').evaluate(image => image.decode());
    checks.nonDefaultOptionsOnly = (await page.locator('#snippet').textContent())
        .includes(origin + '/?theme=light)');
    await page.locator('#include-details').check();
    const expanded = await page.locator('#snippet').textContent();
    checks.optionalDetails = expanded.includes('\n\n<details>\n')
        && expanded.match(/\]\(https:\/\/github.com\/Leask\/CodeStats\)/g).length === 3;
    const root = await mf.dispatchFetch(origin + '/');
    checks.rootIsTransparentImage = root.headers.get('content-type').includes('image/svg+xml')
        && (await root.text()).includes('@media(prefers-color-scheme:dark)');
    await page.goto(origin + '/build?theme=dark&view=activity&header=false');
    await page.waitForFunction(() => document.querySelector('#loading').hidden);
    checks.builderQueryOptions = await page.locator('#theme').inputValue() === 'dark'
        && await page.locator('#view').inputValue() === 'activity'
        && await page.locator('#header').inputValue() === 'false';
    const hidden = await (await mf.dispatchFetch(origin + '/?header=false')).text();
    checks.hiddenHeader = !hidden.includes('data-profile-header')
        && hidden.includes('data-summary-metric')
        && (await page.locator('#snippet').textContent()).includes('header=false');
    for (const mode of ['503', 'invalid-json']) {
        failure = mode;
        await page.goto(origin + '/build');
        await page.waitForFunction(() => document.querySelector('#loading').classList.contains('error'));
        const message = await page.locator('#loading').textContent();
        checks[mode] = message.includes(mode === '503' ? 'HTTP 503' : 'invalid JSON response')
            && !message.includes('snapshot is retained')
            && await page.locator('#snippet').textContent() === defaultMarkdown;
    }
    checks.noJavaScriptErrors = errors.length === 0;
    const result = { checkedAt: new Date().toISOString(), checks, errors,
        bundle: 'Actual Wrangler dist/index.js in workerd + SQLite Durable Object',
        surface: 'Installed Chrome Beta via Playwright',
        isolation: 'Temporary storage and mocked upstream; no tokens or cloud deployment' };
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/worker-browser-review.json', JSON.stringify(result, null, 4) + '\n');
    console.log(JSON.stringify(result));
    assert.ok(Object.values(checks).every(Boolean));
} finally {
    await browser?.close();
    await mf.dispose();
    await rm(directory, { recursive: true, force: true });
}
