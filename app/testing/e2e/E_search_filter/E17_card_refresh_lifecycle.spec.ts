// E17_card_refresh_lifecycle.spec.ts
// Verifies one listing/swap per action, keyword measurement, observer disposal and failure recovery.
// Connects an existing native category fixture with real browser card construction and guarded swaps.
// Uses synthetic listing rows in read-only intercepted responses; it writes no dataset records.
import { test, expect } from '@playwright/test';

const DATASET = process.env.FILTEREST_E2E_CATEGORY_DATASET || '';
const LANGUAGES = (process.env.FILTEREST_E2E_CATEGORY_LANGUAGES || 'fi,en').split(',');
const CONTAINER = `#${DATASET}_card_view_container`;
test.use({ storageState: { cookies: [], origins: [] } });

function firstPage(url: string) {
  const parsed = new URL(url);
  return parsed.pathname === '/api/get-results' && parsed.searchParams.get('dataset') === DATASET
    && Number(parsed.searchParams.get('offset') || 0) === 0;
}

for (const language of LANGUAGES) for (const theme of ['light', 'dark'] as const) {
  for (const searched of [false, true]) {
    test(`WL103 lifecycle: keywords, cleanup and rejected ${searched ? 'searched' : 'ordinary'} cards (${language}, ${theme})`,
      async ({ page }, testInfo) => {
        test.setTimeout(120_000);
        test.skip(!/^[a-z][a-z0-9_]{0,62}$/.test(DATASET), 'Set FILTEREST_E2E_CATEGORY_DATASET to an existing readable categorized dataset.');
        test.skip(testInfo.project.metadata.cardView === 'big', 'Exercises the shared result listing.');
        await page.addInitScript(({ language, theme }) => {
          localStorage.setItem('chosen_language', language); localStorage.setItem('theme', theme);
          const targets = new Set<Element>();
          const mounts: boolean[] = [];
          const probe = { targets, mounts, swaps: 0, rejectAvatar: false };
          (window as any).__cardLifecycleProbe = probe;
          const NativeResizeObserver = window.ResizeObserver;
          window.ResizeObserver = class extends NativeResizeObserver {
            private ownedTargets = new Set<Element>();
            observe(target: Element, options?: ResizeObserverOptions) {
              this.ownedTargets.add(target); targets.add(target); super.observe(target, options);
            }
            unobserve(target: Element) {
              this.ownedTargets.delete(target); targets.delete(target); super.unobserve(target);
            }
            disconnect() {
              this.ownedTargets.forEach(target => targets.delete(target)); this.ownedTargets.clear(); super.disconnect();
            }
          };
          const dispatch = HTMLElement.prototype.dispatchEvent;
          HTMLElement.prototype.dispatchEvent = function (event: Event) {
            if (event.type === 'easelect:card-mounted') mounts.push(this.isConnected);
            return dispatch.call(this, event);
          };
          const digest = crypto.subtle.digest.bind(crypto.subtle);
          crypto.subtle.digest = function (algorithm, bytes) {
            if (probe.rejectAvatar && new TextDecoder().decode(bytes).startsWith('810302_')) {
              probe.rejectAvatar = false;
              return Promise.reject(new Error('Fixture avatar build rejected'));
            }
            return digest(algorithm, bytes);
          };
        }, { language, theme });
        await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
        const listingRequests: string[] = [];
        let pendingListings = 0;
        // Count outgoing requests independently of interception, including late
        // retries. Later-page scroll requests are outside this refresh contract.
        page.on('request', request => { if (firstPage(request.url())) listingRequests.push(request.url()); });
        await page.route('**/api/get-results?**', async route => {
          if (!firstPage(route.request().url())) {
            await route.continue(); return;
          }
          pendingListings += 1;
          try {
            const response = await route.fetch();
            if (!response.ok()) { await route.fulfill({ response }); return; }
            const listing = await response.json();
            await route.fulfill({ response, json: {
              ...listing, columns: ['id', 'lifecycle_keywords', 'lifecycle_detail'], row_count: 2,
              types: { id: { data_type: 'integer' },
                lifecycle_keywords: { data_type: 'text', card_element: 'keywords', show_value_on_card: true },
                lifecycle_detail: { data_type: 'text', card_element: 'details', show_value_on_card: true } },
              data: [810301, 810302].map(id => ({ id, lifecycle_keywords: 'alpha, beta, gamma', lifecycle_detail: 'Lifecycle fixture' })),
            } });
          } finally { pendingListings -= 1; }
        });
        await page.goto(`/${DATASET}?view=card${searched ? '&search=lifecycle' : ''}`);
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
        const panel = page.locator(`#${DATASET}_row_group_facets`);
        await expect(panel).toBeVisible(); await expect(panel).not.toHaveAttribute('aria-busy', 'true');
        await expect(page.locator(`${CONTAINER} .card`)).toHaveCount(2);
        await page.evaluate(container => {
          // CSSOM works with the page's nonce-only style CSP. An adopted sheet
          // also constrains cards constructed by every later replacement.
          const sheet = new CSSStyleSheet();
          sheet.insertRule(`${container} .card_keywords_tags {}`);
          sheet.insertRule(`${container} .keyword_tag {}`, 1);
          (sheet.cssRules[0] as CSSStyleRule).style.setProperty('width', '100px', 'important');
          const tagStyle = (sheet.cssRules[1] as CSSStyleRule).style;
          tagStyle.setProperty('width', '80px', 'important');
          tagStyle.setProperty('box-sizing', 'border-box', 'important');
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        }, CONTAINER);
        let option;
        for (const heading of await panel.locator('[data-heading-id]').all()) {
          if (!await heading.isVisible()) continue;
          await heading.click();
          const popupId = await heading.getAttribute('aria-controls');
          const candidate = page.locator(`#${popupId} [role="option"]:not([aria-disabled="true"])`).first();
          if (await candidate.isVisible()) { option = candidate; break; }
          await heading.click();
        }
        expect(option, 'Fixture needs a readable category').toBeTruthy();
        const slug = await option!.getAttribute('data-option-value');
        await expect.poll(() => pendingListings).toBe(0);
        await page.locator(CONTAINER).evaluate(container => {
          const probe = (window as any).__cardLifecycleProbe;
          // Ordinary/recovery builds replace a surface; searched replacements
          // swap cards inside the retained host. Pagination only adds cards;
          // a replacement removes the previous cards in the same mutation.
          const observer = new MutationObserver(records => {
            probe.swaps += records.filter(record =>
              (record.target === container && [...record.addedNodes].some(node =>
                (node as HTMLElement).classList?.contains('dataset-results-surface')))
              || ((record.target as HTMLElement).classList?.contains('card_container')
                && (record.target as HTMLElement).closest('.scrollable_content') === container
                && [...record.removedNodes].some(node => (node as HTMLElement).classList?.contains('card'))
                && [...record.addedNodes].some(node => (node as HTMLElement).classList?.contains('card')))).length;
          });
          observer.observe(container, { childList: true, subtree: true });
          probe.observer = observer;
        });
        const beforeAction = async () => ({ requests: listingRequests.length,
          ...await page.evaluate(() => {
            const probe = (window as any).__cardLifecycleProbe;
            return { swaps: probe.swaps, mounts: probe.mounts.length };
          }) });
        const initial = await beforeAction();
        const assertAction = async (before: Awaited<ReturnType<typeof beforeAction>>, label: string, mounts: number) => {
          await expect(panel).not.toHaveAttribute('aria-busy', 'true');
          await expect.poll(() => pendingListings).toBe(0);
          await expect.poll(async () => (await beforeAction()).swaps - before.swaps, `${label}: result swaps`).toBe(1);
          // Give observer/fill-screen ticks time to expose an automatic retry,
          // then count after the category action and routed replies settle.
          await page.waitForTimeout(250);
          await expect(panel).not.toHaveAttribute('aria-busy', 'true');
          await expect.poll(() => pendingListings).toBe(0);
          const after = await beforeAction();
          expect(listingRequests.slice(before.requests), `${label}: first-page requests`).toHaveLength(1);
          expect(after.swaps - before.swaps, `${label}: result swaps`).toBe(1);
          expect(after.mounts - before.mounts, `${label}: mounted cards`).toBe(mounts);
        };
        for (let iteration = 0; iteration < 4; iteration++) {
          const before = await beforeAction();
          await option!.click();
          await expect(panel).not.toHaveAttribute('aria-busy', 'true');
          await expect.poll(() => page.locator(`${CONTAINER} .card_keywords_tags`).evaluateAll(groups =>
            groups.map(group => [...group.children].filter(tag => getComputedStyle(tag).display !== 'none').length)))
            .toEqual([1, 1]);
          await expect.poll(() => page.evaluate(() => [...(window as any).__cardLifecycleProbe.targets]
            .filter((target: any) => target.matches('.card_keywords_container,.card_details_kv') && !target.isConnected).length)).toBe(0);
          await assertAction(before, `category click ${iteration + 1}`, 2);
        }
        expect(await page.evaluate(() => (window as any).__cardLifecycleProbe.mounts.every(Boolean))).toBe(true);
        const beforeRejection = await beforeAction();
        await page.evaluate(() => { (window as any).__cardLifecycleProbe.rejectAvatar = true; });
        await option!.click();
        await expect(page.locator(`${CONTAINER} .dataset-results-error [data-lang-key="request_failed_notice"]`)).toBeVisible();
        await expect(page.locator(`${CONTAINER} .card`)).toHaveCount(0);
        await expect(page.locator(`${CONTAINER} [data-row-group-slug="${slug}"]`)).toBeVisible();
        expect(new URL(page.url()).searchParams.get('row_group')?.split(',')).toContain(slug);
        await expect.poll(() => page.evaluate(() => [...(window as any).__cardLifecycleProbe.targets]
          .filter((target: any) => target.matches('.card_keywords_container,.card_details_kv') && !target.isConnected).length)).toBe(0);
        await assertAction(beforeRejection, 'rejected build', 0);
        // The retained controls let the person recover with another selection.
        const beforeRecovery = await beforeAction();
        await option!.click(); await expect(page.locator(`${CONTAINER} .card`)).toHaveCount(2);
        await expect(page.locator(`${CONTAINER} .dataset-results-error`)).toHaveCount(0);
        await assertAction(beforeRecovery, 'recovery click', 2);
        expect(listingRequests.slice(initial.requests), 'all six actions: first-page requests').toHaveLength(6);
        expect((await beforeAction()).swaps - initial.swaps, 'all six actions: result swaps').toBe(6);
        await page.evaluate(() => { (window as any).__cardLifecycleProbe.observer.disconnect(); });
        await page.unrouteAll({ behavior: 'ignoreErrors' });
      });
  }
}
