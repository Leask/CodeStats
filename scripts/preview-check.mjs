import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { profileRank } from '../src/rank.ts';

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
// A cold full-account aggregate can take up to45s; cached visits are immediate.
page.setDefaultTimeout(60_000);
page.setDefaultNavigationTimeout(60_000);
const errors = [];
const requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => requests.push(request.url()));
const checks = {};
try {
    await page.goto(base + '/build', { waitUntil: 'networkidle' });
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
    checks.completeBreakdown = count === 10 && new Set(names).size === count
        && names.at(-1) === 'Others' && !names.includes('Other');
    checks.groupedFamiliesVisible = [
        'C/C++', 'JavaScript/TypeScript', 'Markdown/Text', 'HTML/CSS',
    ].every(name => names.includes(name))
        && names.every(name => !/\s\/|\/\s/.test(name))
        && !names.includes('HTML') && !names.includes('CSS');
    const displayed = await page.locator('#language-body tr').evaluateAll(rows =>
        rows.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent)));
    const js = displayed.find(row => row[0] === 'JavaScript/TypeScript');
    const jsNames = new Set(['javascript', 'typescript', 'js', 'ts', 'jsx', 'tsx',
        'javascript react', 'typescript react']);
    const seconds = expected.wakatime.data.languages
        .filter(row => jsNames.has(row.name.toLowerCase()))
        .reduce((sum, row) => sum + row.seconds, 0);
    const hours = Math.floor(seconds / 3600).toLocaleString('en-US');
    checks.groupedTimeSum = js[2] === hours + 'h ' + Math.floor(seconds / 60) % 60 + 'm';
    const c = displayed.find(row => row[0] === 'C/C++');
    const bytes = expected.github.data.languages
        .filter(row => ['c', 'c++', 'cpp', 'makefile'].includes(row.name.toLowerCase()))
        .reduce((sum, row) => sum + row.bytes, 0);
    checks.groupedCodeShare = c[1]
        === (100 * bytes / expected.github.data.totalBytes).toFixed(2) + '%';
    checks.timeDefault = await page.locator('#sort').inputValue() === 'time';
    const timeShares = displayed.map(row => parseFloat(row[3]));
    const codeShares = displayed.map(row => parseFloat(row[1]));
    const hundred = (values, scale) => values.reduce((sum, value) =>
        sum + Math.round(value * scale), 0) === 100 * scale;
    checks.completeTimeShare = hundred(timeShares, 100);
    checks.completeCodeShare = hundred(codeShares, 100);
    checks.timeDescending = timeShares.slice(0, -1)
        .every((value, index, values) => index === 0 || values[index - 1] >= value);
    const card = await (await context.request.get(base + '/card.svg')).text();
    checks.ownedStarScope = expected.github.data.collectionVersion >= 5
        && expected.github.data.scope.includes('organization/collaborator stars excluded')
        && card.includes('>' + expected.github.data.stars.toLocaleString('en-US')
            + '</text>');
    checks.relativeTimeHeader = />WAKATIME · RECENT (?:\d+ (?:YEARS?|MONTHS?|DAYS?)|ACTIVITY)<\/text>/.test(card)
        && card.includes('>GITHUB · CODE BYTES</text>');
    checks.compactFooter = card.includes('data-refresh-times="true"')
        && card.includes('data-project-credit="true" href="https://github.com/Leask/CodeStats"')
        && card.includes('>Power by github.com/Leask/<tspan')
        && card.includes('font-weight="650">CodeStats</tspan>')
        && !card.includes('>CODESTATS</text>') && !card.includes('FRESH SNAPSHOT')
        && !card.includes('groups · full source totals') && !card.includes('CODESTATS/01');
    const svgNames = [...card.matchAll(/<g><title>([^:]+): WakaTime/g)]
        .map(match => match[1]);
    const cardShares = (x) => [...card.matchAll(new RegExp(
        '<text x="' + x + '"[^>]*>([0-9.]+)%</text>', 'g',
    ))].map(match => Number(match[1]));
    checks.cardDisplayedShares = hundred(cardShares(523), 10)
        && hundred(cardShares(841), 10);
    checks.githubColumnFirst = /<text x="225" y="258"[^>]*>GITHUB · CODE BYTES<\/text>/.test(card)
        && /<text x="558" y="258"[^>]*>WAKATIME · RECENT /.test(card)
        && JSON.stringify(await page.locator('#language-details th').allTextContents())
            === JSON.stringify(['Language', 'Code share', 'Time', 'Time share']);
    checks.defaultTenRows = svgNames.length === Math.min(10, names.length);
    checks.cardAndTableOrderMatch = JSON.stringify(svgNames)
        === JSON.stringify(names.slice(0, 10));
    const svgIcons = [...card.matchAll(/data-language-icon="([^"]+)"[^>]*><path[^>]*d="([^"]+)"/g)];
    const tableIcons = await page.locator('#language-body .language-icon path')
        .evaluateAll(paths => paths.map(path => path.getAttribute('d')));
    checks.inlineLanguageLogos = svgIcons.length === 10 && tableIcons.length === 10
        && svgIcons.every((match, index) => match[2] === tableIcons[index]);
    await page.locator('#header').selectOption('false');
    await page.locator('#card').evaluate(image => image.decode());
    const withoutHeader = await (await context.request.get(
        base + await page.locator('#card').getAttribute('src'),
    )).text();
    checks.headerToggle = !withoutHeader.includes('data-profile-header')
        && Number(card.match(/height="(\d+)"/)[1])
            - Number(withoutHeader.match(/height="(\d+)"/)[1]) === 100
        && (await page.locator('#snippet').textContent()).includes('?header=false)');
    await page.locator('#header').selectOption('true');
    await page.locator('#card').evaluate(image => image.decode());
    checks.defaultHeaderHasNoParameter = !(await page.locator('#snippet').textContent())
        .includes('header=');
    await page.screenshot({ path: 'artifacts/preview-desktop.png', fullPage: true });
    await page.locator('#language-details summary').click();
    checks.expansion = await page.locator('#language-details').getAttribute('open') !== null;
    await page.locator('#sort').selectOption('code');
    await page.locator('#card').evaluate(image => image.decode());
    checks.sort = (await page.locator('#card').getAttribute('src')).includes('sort=code');
    checks.othersAlwaysLast = await page.locator('#language-body tr:last-child td:first-child')
        .textContent() === 'Others';
    await page.locator('#theme').selectOption('light');
    await page.locator('#card').evaluate(image => image.decode());
    checks.theme = (await page.locator('#card').getAttribute('src')).includes('theme=light');
    if (!await page.locator('#readme-details').evaluate(node => node.open)) {
        await page.locator('#readme-details summary').click();
    }
    await page.locator('#include-details').check();
    await page.locator('#public-url').fill('https://stats.example.com');
    const snippet = await page.locator('#snippet').textContent();
    checks.readmeHierarchy = snippet.includes('<details>')
        && snippet.includes('view=languages')
        && snippet.includes('[![CodeStats](https://stats.example.com/')
        && snippet.includes('](https://github.com/Leask/CodeStats)');
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
    checks.footerLayout = true;
    checks.twoSummaryRows = true;
    checks.profileHeader = true;
    checks.languageSubtitles = true;
    const clipping = [];
    for (const view of ['overview', 'activity']) {
        for (const theme of ['dark', 'light', 'transparent']) {
            await svgPage.goto(base + '/card.svg?theme=' + theme + '&view=' + view);
            const overflow = await svgPage.evaluate(() => {
                const root = document.querySelector('svg');
                const bounds = root.getBoundingClientRect();
                return [...root.querySelectorAll('text')].flatMap(node => {
                    const b = node.getBoundingClientRect();
                    return b.left < bounds.left || b.top < bounds.top
                        || b.right > bounds.right || b.bottom > bounds.bottom
                        ? [node.textContent] : [];
                });
            });
            clipping.push(...overflow);
            const rank = profileRank(expected.github.data, expected.githubActivity.data);
            checks.profileHeader &&= await svgPage.evaluate(({ name, username, bio, rank }) => {
                const header = document.querySelector('[data-profile-header]');
                const avatar = header.querySelector('image[data-github-avatar]');
                const identity = header.querySelector('[data-profile-name]');
                const handle = identity.querySelector('tspan');
                const description = header.querySelector('[data-profile-description] text');
                const imageBox = avatar?.getBoundingClientRect();
                const nameBox = identity.getBoundingClientRect();
                const bioBox = description.getBoundingClientRect();
                const textCenter = (nameBox.top + bioBox.bottom) / 2;
                const imageCenter = (imageBox.top + imageBox.bottom) / 2;
                return !!avatar && /^data:image\//.test(avatar.getAttribute('href'))
                    && identity.textContent === name + '@' + username
                    && handle.getAttribute('fill') !== identity.getAttribute('fill')
                    && header.querySelector('[data-profile-description] title').textContent === bio
                    && bio.startsWith(description.textContent.replace(/…$/, ''))
                    && !header.querySelector('[data-profile-rank]')
                    && header.querySelectorAll('text').length === 2
                    && imageBox.right + 12 <= nameBox.left
                    && nameBox.bottom < bioBox.top
                    && Math.abs(textCenter - imageCenter) <= 2;
            }, { name: expected.github.data.name, username: expected.github.data.username,
                bio: expected.github.data.bio || expected.github.data.profileStatus || '', rank });
            checks.twoSummaryRows &&= await svgPage.evaluate(() => {
                const groups = [...document.querySelectorAll('[data-summary-metric]')];
                const ids = groups.map(group => group.dataset.summaryMetric);
                const expected = ['coding-time', 'calendar-contributions',
                    'repositories', 'commits-indexed', 'pull-requests', 'issues',
                    'followers', 'stars'];
                if (JSON.stringify(ids) !== JSON.stringify(expected)) return false;
                if (groups.some(group => group.querySelectorAll('text').length !== 2)) return false;
                if (groups[3].querySelectorAll('text')[1].textContent !== 'COMMITS') return false;
                const boxes = groups.map(group => group.getBoundingClientRect());
                return boxes.every((box, index) => {
                    const rowStart = Math.floor(index / 4) * 4;
                    const next = boxes[index + 1];
                    return Math.abs(box.top - boxes[rowStart].top) < 1
                        && (index % 4 === 3 || box.right + 8 < next.left)
                        && (index < 4 ? box.bottom + 8 < boxes[index + 4].top : true);
                });
            });
            if (view === 'overview') {
                checks.languageSubtitles &&= await svgPage.evaluate(() => {
                    const icons = [...document.querySelectorAll('[data-language-icon]')];
                    return icons.length > 0 && icons.every(icon => {
                        const texts = icon.parentNode.querySelectorAll(':scope > text');
                        const subtitle = texts[1];
                        return /^(?:[\d.]+ (?:B|KB|MB|GB|TB)|—) · \d[\d,]*h \d+m$/
                            .test(subtitle.textContent)
                            && subtitle.getBBox().x + subtitle.getBBox().width < 225;
                    });
                });
            }
            checks.footerLayout &&= await svgPage.evaluate(rank => {
                const ranking = document.querySelector('[data-profile-rank]');
                const trophy = ranking.querySelector('[data-rank-icon]')
                    .getBoundingClientRect();
                const rating = ranking.querySelector('text');
                const ratingBox = rating.getBoundingClientRect();
                const refresh = document.querySelector('[data-refresh-times]');
                const clock = refresh.querySelector('svg').getBoundingClientRect();
                const times = refresh.querySelector('text').getBoundingClientRect();
                const credit = document.querySelector('[data-project-credit]');
                const logo = credit.querySelector('svg').getBoundingClientRect();
                const text = credit.querySelector('text').getBoundingClientRect();
                return rating.textContent === 'Top '
                    + (rank.percentile < 0.01 ? '<0.01' : rank.percentile.toFixed(2))
                    + '% · ' + rank.level
                    && trophy.right + 4 <= ratingBox.left
                    && ratingBox.right + 16 <= clock.left
                    && clock.right + 4 <= times.left
                    && times.right + 16 <= logo.left && logo.right + 4 <= text.left
                    && Math.abs(ratingBox.bottom - times.bottom) < 2;
            }, rank);
            const suffix = view === 'overview' ? theme : 'activity-' + theme;
            await svgPage.screenshot({ path: 'artifacts/card-' + suffix + '.png' });
        }
    }
    checks.svgTextWithinViewbox = clipping.length === 0;
    checks.hiddenHeaderLayout = true;
    for (const view of ['overview', 'languages', 'activity']) {
        await svgPage.goto(base + '/card.svg?header=false&view=' + view);
        checks.hiddenHeaderLayout &&= await svgPage.evaluate(() => {
            const root = document.querySelector('svg');
            const bounds = root.getBoundingClientRect();
            const metrics = [...root.querySelectorAll('[data-summary-metric]')];
            return !root.querySelector('[data-profile-header]')
                && !!root.querySelector('[data-profile-rank] [data-rank-icon]')
                && root.querySelector('[data-profile-rank]').getBoundingClientRect().right
                    < root.querySelector('[data-refresh-times]').getBoundingClientRect().left
                && metrics.length === 8
                && metrics[0].getBoundingClientRect().top < bounds.top + 30
                && [...root.querySelectorAll('text')].every(node => {
                    const b = node.getBoundingClientRect();
                    return b.top >= bounds.top && b.bottom <= bounds.bottom
                        && b.left >= bounds.left && b.right <= bounds.right;
                });
        });
        await svgPage.screenshot({ path: 'artifacts/card-no-header-' + view + '.png' });
    }
    await page.goto(base + '/build?header=false');
    await page.waitForFunction(() => document.querySelector('#loading').hidden);
    checks.headerQueryOptions = await page.locator('#header').inputValue() === 'false'
        && (await page.locator('#card').getAttribute('src')).includes('header=false')
        && (await page.locator('#snippet').textContent()).includes('header=false');
    checks.noJavaScriptErrors = errors.length === 0;
    checks.noExternalAssets = requests.every(url => new URL(url).origin === new URL(base).origin);
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
