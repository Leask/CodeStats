import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:8791';
const installed = '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ?? (existsSync(installed) ? installed : undefined);
mkdirSync('artifacts', { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const checks = {};
try {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => {
        const image = document.querySelector('#card');
        return image && !image.hidden && image.complete && image.naturalWidth > 0;
    });
    checks.liveSources = await page.locator('#github-status').textContent() === 'fresh'
        && await page.locator('#githubActivity-status').textContent() === 'fresh'
        && await page.locator('#wakatime-status').textContent() === 'fresh';
    const expected = await (await context.request.get(base + '/api/stats')).json();
    const count = await page.locator('#language-body tr').count();
    const names = await page.locator('#language-body tr td:first-child')
        .allTextContents();
    checks.fullLanguageUnion = count > 0 && new Set(names).size === count;
    await page.screenshot({ path: 'artifacts/preview-desktop.png', fullPage: true });
    await page.locator('#language-details summary').click();
    checks.expansion = await page.locator('#language-details').getAttribute('open') !== null;
    await page.locator('#sort').selectOption('code');
    await page.locator('#card').evaluate(image => image.decode());
    checks.sort = (await page.locator('#card').getAttribute('src')).includes('sort=code');
    await page.locator('#theme').selectOption('light');
    await page.locator('#card').evaluate(image => image.decode());
    checks.theme = (await page.locator('#card').getAttribute('src')).includes('theme=light');
    await page.locator('#readme-details summary').click();
    await page.locator('#public-url').fill('https://stats.example.com');
    const snippet = await page.locator('#snippet').textContent();
    checks.readmeHierarchy = snippet.includes('<details>')
        && snippet.includes('<picture>') && snippet.includes('view=languages')
        && snippet.includes('https://stats.example.com/card.svg');
    await page.locator('#copy').click();
    await page.waitForFunction(() => document.querySelector('#copy').textContent === 'Copied');
    checks.copy = await page.evaluate(() => navigator.clipboard.readText()) === snippet;
    await page.locator('#activity-details > summary').click();
    checks.activityExpansion = await page.locator('#activity-details')
        .getAttribute('open') !== null;
    checks.annualHistory = await page.locator('#contribution-years tr').count()
        === expected.githubActivity.data.contributionsByYear.length;
    checks.activityMetrics = await page.locator('#activity-body tr').count() === 14;
    checks.privateScope = (await page.locator('#activity-scope').textContent())
        .includes('token-visible');
    await page.locator('#view').selectOption('activity');
    await page.locator('#card').evaluate(image => image.decode());
    checks.activityView = (await page.locator('#card').getAttribute('src'))
        .includes('view=activity');
    await page.screenshot({ path: 'artifacts/preview-activity-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    checks.activityMobileNoOverflow = await page.evaluate(() =>
        document.documentElement.scrollWidth <= innerWidth);
    await page.screenshot({ path: 'artifacts/preview-activity-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.locator('#view').selectOption('overview');
    await page.locator('#card').evaluate(image => image.decode());
    await page.locator('#range').selectOption('last_7_days');
    const ranged = await (await context.request.get(
        base + '/api/stats?range=last_7_days',
    )).json();
    await page.waitForFunction(status =>
        document.querySelector('#wakatime-status').textContent === status,
        ranged.wakatime.status);
    checks.rangeIsolation = ranged.range === 'last_7_days'
        && (ranged.wakatime.data
            ? ranged.wakatime.data.range === 'last_7_days'
            : (await page.locator('#range-note').textContent())
                .includes('no other range is substituted'));
    await page.locator('#range').selectOption('all_time');
    await page.waitForFunction(() =>
        document.querySelector('#wakatime-status').textContent === 'fresh');
    await page.locator('#sort').selectOption('time');
    await page.locator('#theme').selectOption('dark');
    await page.setViewportSize({ width: 390, height: 844 });
    checks.mobileNoOverflow = await page.evaluate(() =>
        document.documentElement.scrollWidth <= innerWidth);
    await page.screenshot({ path: 'artifacts/preview-mobile.png', fullPage: true });

    const svgPage = await context.newPage();
    checks.svgTextWithinViewbox = true;
    const clipping = [];
    for (const view of ['overview', 'activity']) {
        for (const theme of ['dark', 'light', 'transparent']) {
            await svgPage.goto(base + '/card.svg?theme=' + theme + '&view=' + view);
            const overflow = await svgPage.evaluate(() => {
                const root = document.querySelector('svg');
                const { width, height } = root.viewBox.baseVal;
                return [...root.querySelectorAll('text')].flatMap(node => {
                    const b = node.getBBox();
                    return b.x < 0 || b.y < 0 || b.x + b.width > width
                        || b.y + b.height > height ? [node.textContent] : [];
                });
            });
            clipping.push(...overflow);
            const suffix = view === 'overview' ? theme : 'activity-' + theme;
            await svgPage.screenshot({ path: 'artifacts/card-' + suffix + '.png' });
        }
    }
    checks.svgTextWithinViewbox = clipping.length === 0;
    checks.noJavaScriptErrors = errors.length === 0;
    const result = {
        surface: 'Isolated local Chrome Beta via Playwright',
        base, checkedAt: new Date().toISOString(), checks,
        languageUnionRows: count, clipping, errors,
    };
    writeFileSync('artifacts/browser-review.json', JSON.stringify(result, null, 4) + '\n');
    console.log(JSON.stringify(result));
    assert.ok(Object.values(checks).every(Boolean));
} finally {
    await context.close();
    await browser.close();
}
