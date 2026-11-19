// G22_robots_rendering_reads.spec.ts
// Proves robots.txt lets search engines fetch every data request a signed-out visitor's page needs to draw itself.
// Connects the generated robots.txt (robotsRenderingReads in app/backend/core_components/router/routing_builder.go)
// with real visitor page loads of Home, a menu dataset and one of its articles.
// Fails when the application starts to need a read robots.txt keeps out, which would leave crawlers a blank page (WL175).
import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from '../helpers/navigation';

test.use({ storageState: { cookies: [], origins: [] } });

// Requests a visitor's page makes that are not part of drawing it: error reports
// and the development-only translation generator. Crawlers need neither.
const notRenderingReads = new Set(['/api/log-client-error', '/api/generateTranslations']);

type RobotsRule = { allow: boolean; path: string };

// The rules of the "User-agent: *" group, in file order.
function parseRobots(document: string): RobotsRule[] {
    const rules: RobotsRule[] = [];
    let inStarGroup = false;
    for (const raw of document.split('\n')) {
        const line = raw.trim();
        const [field, ...rest] = line.split(':');
        const value = rest.join(':').trim();
        if (/^user-agent$/i.test(field)) inStarGroup = value === '*';
        else if (inStarGroup && /^(allow|disallow)$/i.test(field) && value) {
            rules.push({ allow: /^allow$/i.test(field), path: value });
        }
    }
    return rules;
}

// One rule's match: "*" is any run of characters and a final "$" ends the address.
function ruleMatches(pattern: string, address: string): boolean {
    const anchored = pattern.endsWith('$');
    const parts = (anchored ? pattern.slice(0, -1) : pattern).split('*');
    let position = 0;
    for (const [index, part] of parts.entries()) {
        const found = address.indexOf(part, position);
        if (found < 0 || (index === 0 && found !== 0)) return false;
        position = found + part.length;
    }
    return !anchored || position === address.length;
}

// Google's precedence: the longest matching rule wins; on a tie, Allow wins.
function robotsAllows(rules: RobotsRule[], address: string): boolean {
    let best: RobotsRule | null = null;
    for (const rule of rules) {
        if (!ruleMatches(rule.path, address)) continue;
        if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
    }
    return best ? best.allow : true;
}

async function dataRequestsWhileOpening(page: Page, address: string): Promise<Set<string>> {
    const paths = new Set<string>();
    const listener = (request: { url(): string }) => {
        const address = new URL(request.url());
        if (address.pathname.startsWith('/api/')) paths.add(address.pathname + address.search);
    };
    page.on('request', listener);
    await page.goto(address);
    await waitForAppReady(page);
    await page.waitForLoadState('networkidle');
    page.off('request', listener);
    return paths;
}

test('a signed-out visitor page needs only data requests robots.txt allows', async ({ page }) => {
    const robotsResponse = await page.request.get('/robots.txt');
    expect(robotsResponse.ok()).toBe(true);
    const robots = await robotsResponse.text();
    test.skip(/^Disallow: \/$/m.test(robots), 'this installation is not open to search engines');
    const rules = parseRobots(robots);
    expect(robotsAllows(rules, '/api/get-results?dataset=x')).toBe(true);
    expect(robotsAllows(rules, '/api/get-results-vector?dataset=x')).toBe(false);
    expect(robotsAllows(rules, '/api/admin/settings')).toBe(false);
    expect(robots).toMatch(/^Sitemap: https?:\/\/[^/\s]+\/sitemap\.xml$/m);

    const needed = await dataRequestsWhileOpening(page, '/');
    const catalogue = await page.request.get('/api/datasets');
    expect(catalogue.ok(), await catalogue.text()).toBe(true);
    const { datasets } = await catalogue.json() as { datasets: Array<{ dataset_name: string; preferred_name: string;
        is_top_level_in_current_project?: boolean; can_read_rows?: boolean }> };
    const menuDataset = datasets.find(dataset => dataset.is_top_level_in_current_project && dataset.can_read_rows !== false);
    test.skip(!menuDataset, 'a signed-out visitor sees no dataset in the menu');

    for (const path of await dataRequestsWhileOpening(page, `/${menuDataset!.preferred_name}`)) needed.add(path);
    const rows = await page.request.get(`/api/get-results?dataset=${encodeURIComponent(menuDataset!.dataset_name)}&row_count=0&view_key=article_view`);
    expect(rows.ok(), await rows.text()).toBe(true);
    const firstRow = ((await rows.json()) as { data: Array<{ id: unknown }> }).data[0];
    if (firstRow) {
        for (const path of await dataRequestsWhileOpening(page, `/${menuDataset!.preferred_name}/${String(firstRow.id)}`)) needed.add(path);
    }

    const keptOut = [...needed].filter(address => !notRenderingReads.has(new URL(address, 'https://x').pathname)
        && !robotsAllows(rules, address)).sort();
    expect(keptOut, 'add these reads to robotsRenderingReads, or stop the page from needing them').toEqual([]);
});
