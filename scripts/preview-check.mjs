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
// A cold full-account aggregate can take up to 45s; cached visits are immediate.
page.setDefaultTimeout(60_000);
page.setDefaultNavigationTimeout(60_000);
const errors = [];
const requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => requests.push(request.url()));
const checks = {};

async function waitForSelectedCard() {
    const selected = await page.locator('#controls').evaluate(form =>
        Object.fromEntries(['range', 'theme', 'header', 'view', 'sort']
            .map(id => [id, form.querySelector('#' + id).value])));
    await page.waitForFunction(selected => {
        const image = document.querySelector('#card');
        if (!document.querySelector('#loading').hidden || !image || image.hidden
            || !image.complete || image.naturalWidth === 0) return false;
        const url = new URL(image.getAttribute('src'), location.href);
        return Object.entries(selected).every(([key, value]) =>
            url.searchParams.get(key) === value);
    }, selected);
    await page.locator('#card').evaluate(image => image.decode());
}

async function selectControl(id, value) {
    await page.locator('#' + id).selectOption(value);
    await waitForSelectedCard();
}

try {
    await page.goto(base + '/build', { waitUntil: 'networkidle' });
    await waitForSelectedCard();
    checks.liveSources = await page.locator('#github-status').textContent() === 'fresh'
        && await page.locator('#wakatime-status').textContent() === 'fresh';
    const expected = await (await context.request.get(base + '/api/stats')).json();
    checks.currentRepositoryCollection = expected.github.status === 'fresh'
        && expected.github.data?.collectionVersion >= 7
        && expected.wakatime.status === 'fresh';
    checks.privateMembershipNotPublished = !JSON.stringify(expected)
        .includes('repositoryLanguageCounts');
    const activity = expected.githubActivity;
    checks.activityStateHonest = await page.locator('#githubActivity-status')
        .textContent() === (activity?.status ?? 'unavailable')
        && await page.locator('#githubActivity-error').textContent()
            === (activity?.lastError ?? '');
    const configuredUsage = ['openrouter', 'codex', 'anthropic']
        .filter(service => expected.aiUsage?.[service]);
    checks.optionalUsageSourceState = true;
    for (const service of configuredUsage) {
        const source = expected.aiUsage[service];
        checks.optionalUsageSourceState &&= await page.locator('#' + service + '-status')
            .textContent() === source.status
            && await page.locator('#' + service + '-error').textContent()
                === (source.lastError ?? '');
    }
    checks.onlyConfiguredUsageSources = await page.locator('[data-usage-source]').count()
        === configuredUsage.length;
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
    checks.sixColumnServerRows = displayed.every(row => row.length === 6)
        && JSON.stringify(names) === JSON.stringify(expected.languageRows
            .map(row => row.name));
    checks.repositoryCounts = displayed.every((row, index) => {
        const count = expected.languageRows[index]?.repositoryCount;
        return Number.isSafeInteger(count) && count >= 0
            && count <= expected.github.data.analyzedRepositories
            && row[1] === count.toLocaleString('en-US');
    });
    const js = displayed.find(row => row[0] === 'JavaScript/TypeScript');
    const jsNames = new Set(['javascript', 'typescript', 'js', 'ts', 'jsx', 'tsx',
        'javascript react', 'typescript react']);
    const seconds = expected.wakatime.data.languages
        .filter(row => jsNames.has(row.name.toLowerCase()))
        .reduce((sum, row) => sum + row.seconds, 0);
    const hours = Math.floor(seconds / 3600).toLocaleString('en-US');
    checks.groupedTimeSum = js[4] === hours + 'h ' + Math.floor(seconds / 60) % 60 + 'm';
    const c = displayed.find(row => row[0] === 'C/C++');
    const bytes = expected.github.data.languages
        .filter(row => ['c', 'c++', 'cpp', 'makefile'].includes(row.name.toLowerCase()))
        .reduce((sum, row) => sum + row.bytes, 0);
    checks.groupedCodeShare = c[3]
        === (100 * bytes / expected.github.data.totalBytes).toFixed(2) + '%';
    checks.codeDefault = await page.locator('#sort').inputValue() === 'code';
    const timeShares = displayed.map(row => parseFloat(row[5]));
    const codeShares = displayed.map(row => parseFloat(row[3]));
    const hundred = (values, scale) => values.reduce((sum, value) =>
        sum + Math.round(value * scale), 0) === 100 * scale;
    checks.completeTimeShare = hundred(timeShares, 100);
    checks.completeCodeShare = hundred(codeShares, 100);
    checks.codeDescending = codeShares.slice(0, -1)
        .every((value, index, values) => index === 0 || values[index - 1] >= value);
    const card = await (await context.request.get(base + '/card.svg')).text();
    checks.ownedStarScope = expected.github.data.collectionVersion >= 5
        && expected.github.data.scope.includes('organization/collaborator stars excluded')
        && card.includes('>' + expected.github.data.stars.toLocaleString('en-US')
            + '</text>');
    checks.sourceColumnHeaders = card.includes('>WAKATIME · CODE TIME · SCALE ')
        && card.includes('>GITHUB · CODE BYTES · SCALE ');
    checks.compactFooter = card.includes('data-refresh-times="true"')
        && card.includes('data-project-credit="true" href="https://github.com/Leask/CodeStats"')
        && card.includes('>Power by github.com/Leask/<tspan')
        && card.includes('font-weight="650">CodeStats</tspan>')
        && !card.includes('>CODESTATS</text>') && !card.includes('FRESH SNAPSHOT')
        && !card.includes('groups · full source totals') && !card.includes('CODESTATS/01');
    const svgNames = [...card.matchAll(/<g data-language-row="([^"]+)">/g)]
        .map(match => match[1]);
    const cardShares = (x) => [...card.matchAll(new RegExp(
        '<text x="' + x + '"[^>]*>([0-9.]+)%</text>', 'g',
    ))].map(match => Number(match[1]));
    checks.cardDisplayedShares = hundred(cardShares(523), 10)
        && hundred(cardShares(841), 10);
    checks.githubColumnFirst = /<text x="225" y="258"[^>]*>GITHUB · CODE BYTES · SCALE /.test(card)
        && /<text x="558" y="258"[^>]*>WAKATIME · CODE TIME · SCALE /.test(card)
        && JSON.stringify(await page.locator('#language-details th').allTextContents())
            === JSON.stringify(['Language', 'Repos', 'Code bytes', 'Code share',
                'Time', 'Time share']);
    checks.defaultTenRows = svgNames.length === Math.min(10, names.length);
    checks.cardAndTableOrderMatch = JSON.stringify(svgNames)
        === JSON.stringify(names.slice(0, 10));
    const svgIcons = [...card.matchAll(/data-language-icon="([^"]+)"[^>]*><path[^>]*d="([^"]+)"/g)];
    const tableIcons = await page.locator('#language-body .language-icon path')
        .evaluateAll(paths => paths.map(path => path.getAttribute('d')));
    checks.inlineLanguageLogos = svgIcons.length === 10 && tableIcons.length === 10
        && svgIcons.every((match, index) => match[2] === tableIcons[index]);
    await selectControl('header', 'false');
    const withoutHeader = await (await context.request.get(
        base + await page.locator('#card').getAttribute('src'),
    )).text();
    checks.headerToggle = !withoutHeader.includes('data-profile-header')
        && Number(card.match(/height="(\d+)"/)[1])
            - Number(withoutHeader.match(/height="(\d+)"/)[1]) === 100
        && (await page.locator('#snippet').textContent()).includes('?header=false)');
    await selectControl('header', 'true');
    checks.defaultHeaderHasNoParameter = !(await page.locator('#snippet').textContent())
        .includes('header=');
    await page.screenshot({ path: 'artifacts/preview-desktop.png', fullPage: true });
    await page.locator('#language-details summary').click();
    checks.expansion = await page.locator('#language-details').getAttribute('open') !== null;
    await selectControl('sort', 'time');
    checks.sort = (await page.locator('#card').getAttribute('src')).includes('sort=time');
    const timeRows = await (await context.request.get(
        base + '/api/stats?sort=time',
    )).json();
    const sortedRows = await page.locator('#language-body tr').evaluateAll(rows =>
        rows.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent)));
    checks.sortedServerRows = JSON.stringify(sortedRows.map(row => [row[0], row[1]]))
        === JSON.stringify(timeRows.languageRows.map(row => [
            row.name, row.repositoryCount.toLocaleString('en-US'),
        ]));
    checks.othersAlwaysLast = await page.locator('#language-body tr:last-child td:first-child')
        .textContent() === 'Others';
    await selectControl('theme', 'light');
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
        === Math.max(1, activity?.data?.contributionsByYear.length ?? 0);
    checks.activityMetrics = await page.locator('#activity-body tr').count() === 14;
    checks.privateScope = (await page.locator('#activity-scope').textContent())
        .includes(activity?.data ? activity.data.visibility === 'all'
            ? 'Public + private' : 'Public aggregates' : 'unavailable');
    await selectControl('view', 'activity');
    checks.activityView = (await page.locator('#card').getAttribute('src'))
        .includes('view=activity');
    await page.screenshot({ path: 'artifacts/preview-activity-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    checks.activityMobileNoOverflow = await page.evaluate(() =>
        document.documentElement.scrollWidth <= innerWidth);
    await page.screenshot({ path: 'artifacts/preview-activity-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await selectControl('view', 'overview');
    await selectControl('range', 'last_7_days');
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
    await selectControl('range', 'all_time');
    checks.allTimeRestored = await page.locator('#wakatime-status')
        .textContent() === 'fresh';
    await selectControl('sort', 'time');
    await selectControl('theme', 'dark');
    await page.setViewportSize({ width: 390, height: 844 });
    checks.mobileNoOverflow = await page.evaluate(() =>
        document.documentElement.scrollWidth <= innerWidth);
    await page.screenshot({ path: 'artifacts/preview-mobile.png', fullPage: true });

    const svgPage = await context.newPage();
    checks.svgTextWithinViewbox = true;
    checks.footerLayout = true;
    checks.twoSummaryRows = true;
    checks.profileHeader = true;
    checks.avatarRankRing = true;
    checks.languageSubtitles = true;
    checks.threeFontSizes = true;
    checks.maxNormalizedBars = true;
    checks.trueSourcePercentLabels = true;
    checks.scaleHeaders = true;
    checks.svgRepositoryCounts = true;
    checks.tokenUsageStrip = true;
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
            checks.threeFontSizes &&= await svgPage.evaluate(() => {
                const size = node => Number.parseFloat(getComputedStyle(node).fontSize);
                const texts = [...document.querySelectorAll('text')];
                return texts.every(node => [27, 13, 11].includes(size(node)))
                    && size(document.querySelector('[data-profile-name]')) === 27
                    && [...document.querySelectorAll('[data-summary-metric]')]
                        .every(group => size(group.querySelector('text')) === 27)
                    && [...document.querySelectorAll('[data-language-icon]')]
                        .every(icon => size(icon.parentNode.querySelector('text')) === 13);
            });
            const rank = profileRank(expected.github.data, activity?.data ?? null);
            checks.tokenUsageStrip &&= await svgPage.evaluate(({ usage, view }) => {
                const configured = ['openrouter', 'codex', 'anthropic']
                    .filter(service => usage?.[service]);
                const groups = [...document.querySelectorAll('[data-token-service]')];
                if (view === 'activity') return groups.length === 0;
                if (groups.length !== configured.length) return false;
                const formatter = new Intl.NumberFormat('en-US', {
                    notation: 'compact', maximumFractionDigits: 1,
                });
                return groups.every((group, index) => {
                    const service = configured[index];
                    const source = usage[service];
                    const total = source.data?.totalTokens;
                    const value = typeof total === 'number' ? formatter.format(total) : '—';
                    const languageRows = [...document.querySelectorAll('[data-language-row]')];
                    const lastLanguage = languageRows.at(-1)?.getBoundingClientRect();
                    const bounds = group.getBoundingClientRect();
                    return group.dataset.tokenService === service
                        && group.dataset.usageStatus === source.status
                        && group.querySelector('[data-token-total]').textContent === value
                        && group.querySelector('[data-token-period]').textContent
                            === (source.data?.period ?? 'Not available yet')
                        && (!lastLanguage || bounds.top > lastLanguage.bottom + 8);
                });
            }, { usage: expected.aiUsage, view });
            checks.avatarRankRing &&= await svgPage.evaluate(rank => {
                const rim = document.querySelector('[data-avatar-rank-rim]');
                const arc = document.querySelector('[data-avatar-rank-progress]');
                const avatar = document.querySelector('#avatar-clip circle');
                return !!rim && !!arc && !!avatar
                    && ['cx', 'cy', 'r', 'stroke', 'stroke-width'].every(key =>
                        rim.getAttribute(key) === arc.getAttribute(key))
                    && rim.getAttribute('opacity') === '0.2'
                    && arc.getAttribute('opacity') === '0.8'
                    && arc.getAttribute('pathLength') === '100'
                    && arc.getAttribute('stroke-dasharray') === '100'
                    && arc.getAttribute('transform') === 'rotate(-90 66 78)'
                    && Math.abs(Number(arc.getAttribute('stroke-dashoffset'))
                        - rank.percentile) < 0.000001
                    && rim.getAttribute('r') === avatar.getAttribute('r')
                    && rim.getAttribute('stroke-width') === '3';
            }, rank);
            await svgPage.emulateMedia({ reducedMotion: 'reduce' });
            checks.avatarRankRing &&= await svgPage.locator(
                '[data-avatar-rank-progress]',
            ).evaluate(arc => getComputedStyle(arc).animationName === 'none');
            checks.profileHeader &&= await svgPage.evaluate(({ name, username, bio, rank }) => {
                const header = document.querySelector('[data-profile-header]');
                const avatar = header.querySelector('image[data-github-avatar]');
                const identity = header.querySelector('[data-profile-name]');
                const description = header.querySelector('[data-profile-description] text');
                const imageBox = avatar?.getBoundingClientRect();
                const nameBox = identity.getBoundingClientRect();
                const bioBox = description.getBoundingClientRect();
                const textCenter = (nameBox.top + bioBox.bottom) / 2;
                const imageCenter = (imageBox.top + imageBox.bottom) / 2;
                return !!avatar && /^data:image\//.test(avatar.getAttribute('href'))
                    && identity.textContent === name
                    && !identity.textContent.includes('@' + username)
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
                const chart = await svgPage.evaluate(expected => {
                    const groups = [...document.querySelectorAll('[data-language-row]')];
                    const rows = new Map(expected.languageRows.map(row => [row.name, row]));
                    const sources = [
                        { key: 'code', field: 'codeBytes', total: expected.github.data.totalBytes },
                        { key: 'time', field: 'seconds', total: expected.wakatime.data.totalSeconds },
                    ];
                    const result = { geometry: true, labels: true, headers: true,
                        repositories: true, metadata: true };
                    for (const source of sources) {
                        const header = document.querySelector(
                            '[data-language-scale="' + source.key + '"]');
                        const scale = Number(header.getAttribute('data-scale-percent'));
                        const prefix = source.key === 'code'
                            ? 'GITHUB · CODE BYTES · SCALE '
                            : 'WAKATIME · CODE TIME · SCALE ';
                        result.headers &&= header.textContent === prefix + scale.toFixed(1) + '%';
                        const ratios = [];
                        const shares = [];
                        for (const group of groups) {
                            const row = rows.get(group.dataset.languageRow);
                            const raw = source.total > 0 ? 100 * row[source.field] / source.total : 0;
                            const bar = group.querySelector('[data-' + source.key + '-bar]');
                            const track = bar.previousElementSibling;
                            const ratio = Number(bar.getAttribute('width'))
                                / Number(track.getAttribute('width'));
                            ratios.push(ratio);
                            shares.push(raw);
                            result.geometry &&= Math.abs(ratio - (scale ? raw / scale : 0)) < 0.00005;
                            const texts = group.querySelectorAll(':scope > text');
                            const label = Number.parseFloat(texts[source.key === 'code' ? 2 : 4].textContent);
                            // Named labels round to 0.1%; Others balances the remainder.
                            result.labels &&= Math.abs(label - raw)
                                <= (row.name === 'Others' ? 0.5 : 0.051);
                        }
                        const largest = Math.max(...shares);
                        result.geometry &&= scale >= largest - 0.000001
                            && scale < largest + 0.100001
                            && Math.max(...ratios) >= 0.99
                            && Math.max(...ratios) <= 1.000001;
                    }
                    for (const group of groups) {
                        const row = rows.get(group.dataset.languageRow);
                        const repo = group.querySelector('[data-repository-count]');
                        const text = group.querySelector(':scope > text');
                        const expectedRepo = row.repositoryCount === null ? '— repos'
                            : row.repositoryCount.toLocaleString('en-US')
                                + (row.repositoryCount === 1 ? ' repo' : ' repos');
                        result.repositories &&= repo.textContent === expectedRepo;
                        const code = group.querySelector('[data-code-value]');
                        const time = group.querySelector('[data-time-value]');
                        const codeBar = group.querySelector('[data-code-bar]');
                        const timeBar = group.querySelector('[data-time-bar]');
                        result.metadata &&= /^(?:[\d,]+ repos?|— repos)$/.test(repo.textContent)
                            && Number(repo.getAttribute('y')) > Number(text.getAttribute('y'))
                            && repo.getBBox().x + repo.getBBox().width < Number(codeBar.getAttribute('x'))
                            && /^[\d.]+ (?:B|KB|MB|GB|TB)$/.test(code.textContent)
                            && /^\d[\d,]*h \d+m$/.test(time.textContent)
                            && code.getAttribute('x') === codeBar.getAttribute('x')
                            && time.getAttribute('x') === timeBar.getAttribute('x')
                            && Number(code.getAttribute('y'))
                                > Number(codeBar.getAttribute('y')) + Number(codeBar.getAttribute('height'))
                            && Number(time.getAttribute('y'))
                                > Number(timeBar.getAttribute('y')) + Number(timeBar.getAttribute('height'));
                    }
                    return result;
                }, expected);
                checks.languageSubtitles &&= chart.metadata;
                checks.maxNormalizedBars &&= chart.geometry;
                checks.trueSourcePercentLabels &&= chart.labels;
                checks.scaleHeaders &&= chart.headers;
                checks.svgRepositoryCounts &&= chart.repositories;
            }
            checks.footerLayout &&= await svgPage.evaluate(({ rank, username, usage }) => {
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
                const iconGaps = [ratingBox.left - trophy.right,
                    times.left - clock.right, text.left - logo.right];
                const identity = rating.textContent === '@' + username + ' · Top '
                    + (rank.percentile < 0.01 ? '<0.01' : rank.percentile.toFixed(2))
                    + '% · ' + rank.level
                    && iconGaps.every(gap => Math.abs(gap - 6) < 0.5);
                const configured = ['openrouter', 'codex', 'anthropic']
                    .filter(service => usage?.[service]);
                if (!configured.length) return identity
                    && ratingBox.right + 16 <= clock.left
                    && times.right + 16 <= logo.left
                    && Math.abs(ratingBox.bottom - times.bottom) < 2;
                const bounds = document.querySelector('svg').getBoundingClientRect();
                return identity && ratingBox.right + 16 <= logo.left
                    && times.top > ratingBox.bottom + 6
                    && Math.abs(ratingBox.bottom - text.bottom) < 2
                    && [...refresh.querySelectorAll('[data-refresh-line]')].every(line => {
                        const icon = line.querySelector('svg').getBoundingClientRect();
                        const copy = line.querySelector('text').getBoundingClientRect();
                        return Math.abs(copy.left - icon.right - 6) < 0.5
                            && copy.right < bounds.right;
                    })
                    && configured.every(service => refresh.textContent.includes({
                        openrouter: 'OpenRouter:', codex: 'Codex:', anthropic: 'Anthropic API:',
                    }[service]));
            }, { rank, username: expected.github.data.username, usage: expected.aiUsage });
            const suffix = view === 'overview' ? theme : 'activity-' + theme;
            await svgPage.locator('svg').first().screenshot({
                path: 'artifacts/card-' + suffix + '.png',
            });
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
                && !root.querySelector('[data-avatar-rank-ring]')
                && !!root.querySelector('[data-profile-rank] [data-rank-icon]')
                && (() => {
                    const rank = root.querySelector('[data-profile-rank]').getBoundingClientRect();
                    const refresh = root.querySelector('[data-refresh-times]').getBoundingClientRect();
                    return rank.right < refresh.left || rank.bottom + 6 < refresh.top;
                })()
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
