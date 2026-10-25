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
        && await page.locator('#wakatime-status').textContent() === 'fresh';
    const count = await page.locator('#language-body tr').count();
    checks.fullLanguageUnion = count >= 103;
    await page.screenshot({ path: 'artifacts/preview-desktop.png', fullPage: true });
    await page.locator('#language-details summary').click();
    checks.expansion = await page.locator('#language-details').getAttribute('open') !== null;
    await page.locator('#sort').selectOption('code');
    checks.sort = (await page.locator('#card').getAttribute('src')).includes('sort=code');
    await page.locator('#theme').selectOption('light');
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
    await page.locator('#range').selectOption('last_7_days');
    await page.waitForFunction(() =>
        document.querySelector('#wakatime-status').textContent === 'unavailable');
    checks.rangeIsolation = (await page.locator('#range-note').textContent())
        .includes('no other range is substituted');
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
    for (const theme of ['dark', 'light', 'transparent']) {
        await svgPage.goto(base + '/card.svg?theme=' + theme);
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
        await svgPage.screenshot({ path: 'artifacts/card-' + theme + '.png' });
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
