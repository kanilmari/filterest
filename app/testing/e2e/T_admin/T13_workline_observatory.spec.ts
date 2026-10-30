/**
 * T13_workline_observatory.spec.ts
 *
 * Verifies the shared board in standalone and composed native applications.
 * Bridges authenticated navigation with aligned workline, phase, and publication-target rows.
 */

import { test, expect, type Page } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';

test.describe('T13 — Workline observatory', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
    await page.evaluate(() => {
      window.localStorage.removeItem('easelect.workline-observatory.selection.v1');
    });
  });

  test('aligns every current-phase row with one release-target row', async ({ page }) => {
    await page.goto('/admin/workline_observatory', { waitUntil: 'domcontentloaded' });

    const board = page.locator('.workline-observatory__board');
    await expect(board).toBeVisible();
    const nowHeading = page.locator('.workline-observatory__now');
    await expect(nowHeading).toBeVisible();

    const worklines = page.locator('.workline-observatory__workline-row');
    const tracks = page.locator('.workline-observatory__track');
    const targets = page.locator('.workline-observatory__target-row');
    const worklineCount = await worklines.count();
    const openWorklineCount = await worklines.evaluateAll((rows) => rows.filter((row) => {
      const status = row.getAttribute('data-lifecycle-status');
      return status === 'active' || status === 'paused';
    }).length);

    expect(worklineCount).toBeGreaterThan(0);
    await expect(nowHeading).toHaveText(`NOW (${openWorklineCount})`);
    await expect(tracks).toHaveCount(worklineCount);
    await expect(targets).toHaveCount(worklineCount);
    await expect(page.locator('[data-release-goal-details]')).toContainText('Publications');
    await page.locator('[data-release-goal-details]').click();
    await expect(page.locator('#custom_modal .workline-observatory__goal')).toBeVisible();
    await page.keyboard.press('Escape');
    for (let index = 0; index < worklineCount; index += 1) {
      const phaseNodes = tracks.nth(index).locator('.workline-observatory__phase-node');
      const phaseLabels = await phaseNodes.allTextContents();
      expect(phaseLabels.slice(-6)).toEqual(['1', '2', '3', '4', '5', '6']);
      const lifecycle = await worklines.nth(index).getAttribute('data-lifecycle-status');
      const currentNode = tracks.nth(index).locator('.workline-observatory__phase-node[data-current="true"]');
      if (lifecycle === 'closed' || lifecycle === 'archived') {
        await expect(currentNode).toHaveCount(0);
        await expect(phaseNodes).toHaveCount(6);
        await expect(phaseNodes.nth(0)).toHaveCSS('grid-column-start', '1');
        await expect(phaseNodes.nth(5)).toHaveCSS('grid-column-start', '6');
        expect(await phaseNodes.evaluateAll((nodes) => nodes.every((node) => node.getAttribute('data-state') === 'completed'))).toBe(true);
      } else {
        await expect(currentNode).toHaveCount(1);
        await expect(currentNode).toHaveCSS('grid-column-start', '7');
      }
      await expect(targets.nth(index)).not.toHaveText('');
    }
  });

  test('supports multi-selection, pointer context actions, and a confirmation gate', async ({ page }) => {
    await page.goto('/admin/workline_observatory', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.workline-observatory__board')).toBeVisible();

    const rows = page.locator('.workline-observatory__workline-row');
    const labels = page.locator('.workline-observatory__workline-button');
    const checkboxes = page.locator('.workline-observatory__workline-checkbox');
    const firstSelectionArea = rows.nth(0).locator('.workline-observatory__selection-area');
    expect(await rows.count()).toBeGreaterThan(1);

    const selectionToggle = page.locator('.workline-observatory__selection-toggle');
    await expect(selectionToggle).not.toBeChecked();
    await selectionToggle.click();
    await expect(page.locator('.workline-observatory__selection-count')).toHaveText(`${await rows.count()} selected`);
    await expect(selectionToggle).toBeChecked();
    await selectionToggle.click();
    await expect(page.locator('.workline-observatory__selection-count')).toHaveText('');
    await expect(selectionToggle).not.toBeChecked();

    await page.locator('[data-selection-action="select-all"]').click();
    await expect(selectionToggle).toBeChecked();
    await page.locator('[data-selection-action="deselect-all"]').click();
    await expect(selectionToggle).not.toBeChecked();

    // Bring the selection control into view before measuring, so the click below
    // does not scroll the page and only a real selection effect can move a row.
    await firstSelectionArea.scrollIntoViewIfNeeded();
    const initialRowBoxes = await rows.evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }));
    const toolbar = page.locator('.workline-observatory__status-toolbar');
    const initialToolbarHeight = await toolbar.evaluate((element) => element.getBoundingClientRect().height);

    await firstSelectionArea.click();
    await expect(checkboxes.nth(0)).toBeChecked();
    const selectedRowBoxes = await rows.evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }));
    // Selecting may re-render toolbar text (count, guidance); glyph metrics can move a line box by a
    // fraction of a pixel. A real layout shift is whole pixels, so compare with a half-pixel tolerance.
    expect(selectedRowBoxes.length).toBe(initialRowBoxes.length);
    selectedRowBoxes.forEach((box, index) => {
      const initial = initialRowBoxes[index];
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        expect(Math.abs(box[key] - initial[key]), `row ${index} ${key}`).toBeLessThanOrEqual(0.5);
      }
    });
    const selectedToolbarHeight = await toolbar.evaluate((element) => element.getBoundingClientRect().height);
    expect(Math.abs(selectedToolbarHeight - initialToolbarHeight)).toBeLessThanOrEqual(0.5);

    // The row label shows "#<id> <title>"; status actions name the bare workline title.
    const firstTitle = ((await labels.nth(0).locator('.workline-observatory__workline-title').textContent())?.trim() ?? '')
      .replace(/^#\d+\s+/, '');
    const firstLifecycle = await rows.nth(0).getAttribute('data-lifecycle-status');
    const targetStatus = firstLifecycle === 'paused' ? 'active' : 'paused';
    const targetStateLabel = targetStatus === 'active' ? 'Active' : 'Paused';
    const targetAction = page.locator(`.workline-observatory__status-actions [data-status-action="${targetStatus}"]`);
    await expect(targetAction).toBeEnabled();
    await expect(targetAction).toHaveAttribute('title', `Move “${firstTitle}” to ${targetStateLabel}.`);
    await checkboxes.nth(0).uncheck();

    await firstSelectionArea.click();
    await expect(checkboxes.nth(0)).toBeChecked();
    await checkboxes.nth(1).check();
    await expect(page.locator('.workline-observatory__selection-count')).toContainText('2');
    await expect(page.locator('.workline-observatory__status-actions [data-status-action="closed"]'))
      .toHaveAttribute('title', /^Move all 2 selected worklines to Done(?:; 1 already have that state)?\.$/);
    const selectionBackground = await rows.nth(0)
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(selectionBackground).not.toBe('rgba(0, 0, 0, 0)');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.workline-observatory__board')).toBeVisible();
    await expect(page.locator('.workline-observatory__workline-checkbox').nth(0)).toBeChecked();
    await expect(page.locator('.workline-observatory__workline-checkbox').nth(1)).toBeChecked();
    await expect(page.locator('.workline-observatory__selection-count')).toContainText('2');

    await page.evaluate(() => {
      document.body.classList.remove('dark-mode');
      document.body.classList.add('light-mode');
    });
    await page.waitForTimeout(180);
    const contextRow = page.locator('.workline-observatory__workline-row').nth(1);
    // Any scroll dismisses the portaled menu (a capture-phase window scroll listener), and a click
    // scrolls its row into view first. Scroll now and let that event settle, so the click scrolls nothing.
    await contextRow.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
    await contextRow.click({ button: 'right', position: { x: 40, y: 30 } });
    const contextMenu = page.locator('.workline-observatory__context-menu');
    await expect(contextMenu).toBeVisible();
    await expect(contextMenu.locator('[data-status-action]')).toHaveCount(4);
    await expect(page.locator('.workline-observatory__selection-count')).toContainText('2');
    // The row box is read after the click, which may have scrolled the row into view first.
    const contextRowBox = (await contextRow.boundingBox())!;
    const contextMenuBox = (await contextMenu.boundingBox())!;
    // Since #908 (d5c33f78) the shared positioner keeps the menu on screen: it opens at the pointer,
    // clamped to an 8 px margin inside the viewport (viewport_context_menu_positioner.js).
    const viewport = page.viewportSize()!;
    const menuMargin = 8;
    const expectedMenuX = Math.min(Math.max(menuMargin, contextRowBox.x + 40),
      Math.max(menuMargin, viewport.width - contextMenuBox.width - menuMargin));
    const expectedMenuY = Math.min(Math.max(menuMargin, contextRowBox.y + 30),
      Math.max(menuMargin, viewport.height - contextMenuBox.height - menuMargin));
    expect(Math.abs(contextMenuBox.x - expectedMenuX)).toBeLessThan(3);
    expect(Math.abs(contextMenuBox.y - expectedMenuY)).toBeLessThan(3);
    expect(contextMenuBox.y + contextMenuBox.height).toBeLessThanOrEqual(viewport.height);
    await expect(contextMenu).toHaveCSS('position', 'fixed');
    const lightContextMenuLuminance = await contextMenu.evaluate(readButtonLuminance);
    expect(lightContextMenuLuminance.background).toBeGreaterThan(0.9);
    expect(lightContextMenuLuminance.text).toBeLessThan(0.25);
    const contextGuidance = contextMenu.locator('.workline-observatory__context-guidance');
    await expect(contextGuidance).toHaveCSS('border-top-width', '0px');
    await expect(contextGuidance).toHaveCSS('box-shadow', 'none');

    await page.evaluate(() => {
      document.body.classList.remove('light-mode');
      document.body.classList.add('dark-mode');
    });
    await page.waitForTimeout(180);
    const darkContextMenuLuminance = await contextMenu.evaluate(readButtonLuminance);
    expect(darkContextMenuLuminance.background).toBeLessThan(0.3);
    expect(darkContextMenuLuminance.text).toBeGreaterThan(0.8);

    await page.keyboard.press('Escape');
    await expect(contextMenu).toBeHidden();

    let confirmationSeen = false;
    page.once('dialog', async (dialog) => {
      confirmationSeen = true;
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message().length).toBeGreaterThan(10);
      await dialog.dismiss();
    });
    await page.locator('.workline-observatory__status-actions [data-status-action="closed"]').click();
    await expect.poll(() => confirmationSeen).toBe(true);
  });

  test('a workline number finds that workline first, ordered by search relevance', async ({ page }) => {
    await page.goto('/admin/workline_observatory', { waitUntil: 'domcontentloaded' });
    const rows = page.locator('.workline-observatory__workline-row');
    await expect(rows.first()).toBeVisible();
    // Look up an older workline by its number, as an owner looked up WL127; the
    // board searches as every dataset does, so that number puts its row first.
    const id = await rows.last().getAttribute('data-workline-id');
    expect(id).toMatch(/^\d+$/);

    await page.goto(`/admin/workline_observatory?search=${id}`, { waitUntil: 'domcontentloaded' });
    await expect(rows.first()).toHaveAttribute('data-workline-id', id ?? '');
    // Every sort control on the page (hero and filter bar) names the order the board used.
    const sortInputs = page.locator('.sort-dropdown-wrapper .vdw-dropdown-input');
    await expect(sortInputs.first()).toBeAttached();
    await expect(page.locator('.sort-dropdown-wrapper .vdw-dropdown-input[data-lang-key="search_relevance"]'))
      .toHaveCount(await sortInputs.count());
  });

  test('compacts the centered action bar when the report content scrolls under it', async ({ page }) => {
    await page.goto('/admin/workline_observatory', { waitUntil: 'domcontentloaded' });
    // Since 649133f1 the chosen language lands after load and re-presents the page; flip the theme on the settled shell.
    await page.waitForFunction(() => (window as Window & {
      __filterestShellBoot?: { status: () => { ready: boolean } };
    }).__filterestShellBoot?.status().ready === true);
    await page.evaluate(() => {
      document.body.classList.remove('dark-mode');
      document.body.classList.add('light-mode');
    });
    const toolbar = page.locator('.workline-observatory__status-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toHaveAttribute('data-compact', 'false');
    // 4caa80a2 removed the header subtitle; selection guidance now belongs to the row context menu.
    await expect(page.locator('.workline-observatory__status-action-group--before-now button'))
      .toHaveText(['Activate', 'Pause']);
    await expect(page.locator('.workline-observatory__status-action-group--after-now button'))
      .toHaveText(['Mark done', 'Discard']);
    await expect(page.locator('.workline-observatory__status-action').first())
      .toHaveCSS('background-color', 'rgb(255, 255, 255)');
    const lightThemeLuminance = await page.locator('.workline-observatory__status-action').first()
      .evaluate(readButtonLuminance);
    expect(lightThemeLuminance.background).toBeGreaterThan(0.9);
    expect(lightThemeLuminance.text).toBeLessThan(0.2);

    await page.evaluate(() => {
      document.body.classList.remove('light-mode');
      document.body.classList.add('dark-mode');
    });
    await page.waitForTimeout(180);
    const darkThemeLuminance = await page.locator('.workline-observatory__status-action').first()
      .evaluate(readButtonLuminance);
    expect(darkThemeLuminance.background).toBeLessThan(0.3);
    expect(darkThemeLuminance.text).toBeGreaterThan(0.85);

    await page.evaluate(() => {
      document.body.classList.remove('dark-mode');
      document.body.classList.add('light-mode');
    });
    await page.waitForTimeout(180);

    const expandedHeight = await toolbar.evaluate((element) => element.getBoundingClientRect().height);
    const statusAction = page.locator('.workline-observatory__status-action').first();
    const expandedActionHeight = (await statusAction.boundingBox())!.height;
    expect(expandedActionHeight).toBeGreaterThanOrEqual(44);
    const toolbarBackground = await toolbar.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(toolbarBackground).not.toBe('rgba(0, 0, 0, 0)');
    // 4caa80a2 made the action groups a wrapping row that no longer aligns with the board's NOW axis;
    // the before-now group (Activate, Pause) still comes first in reading order.
    const beforeNowGroup = page.locator('.workline-observatory__status-action-group--before-now');
    const afterNowGroup = page.locator('.workline-observatory__status-action-group--after-now');
    await expect(beforeNowGroup).toBeVisible();
    await expect(afterNowGroup).toBeVisible();
    expect(await beforeNowGroup.evaluate((before, after) =>
      Boolean(before.compareDocumentPosition(after as Node) & Node.DOCUMENT_POSITION_FOLLOWING),
    await afterNowGroup.elementHandle())).toBe(true);
    // Reading order on screen too: on one line before-now ends left of after-now; after a wrap it sits above it.
    const beforeNowBox = (await beforeNowGroup.boundingBox())!;
    const afterNowBox = (await afterNowGroup.boundingBox())!;
    const sameLine = beforeNowBox.y < afterNowBox.y + afterNowBox.height && afterNowBox.y < beforeNowBox.y + beforeNowBox.height;
    if (sameLine) expect(beforeNowBox.x + beforeNowBox.width).toBeLessThanOrEqual(afterNowBox.x + 0.5);
    else expect(beforeNowBox.y + beforeNowBox.height).toBeLessThanOrEqual(afterNowBox.y + 0.5);

    await page.locator('.workline-observatory__workline-row').last().scrollIntoViewIfNeeded();
    await expect(toolbar).toHaveAttribute('data-compact', 'true');
    await page.waitForTimeout(220);
    await expect(page.locator('.workline-observatory__selection-count')).toHaveCSS('visibility', 'hidden');
    const compactBox = await toolbar.boundingBox();
    const compactHeight = compactBox?.height ?? expandedHeight;
    expect(compactHeight).toBeLessThan(expandedHeight);
    // Since 4caa80a2 the toolbar wraps and stacks three selection links, so it is never one row tall.
    // Compaction means slimmer padding, hidden count and guidance, and 2 rem action buttons.
    const compactActionHeight = (await statusAction.boundingBox())!.height;
    expect(compactActionHeight).toBeLessThan(expandedActionHeight);
    expect(compactActionHeight).toBeLessThanOrEqual(33);
    expect(compactHeight).toBeLessThanOrEqual(expandedHeight - (expandedActionHeight - compactActionHeight));
    // Above 900 px the bar sticks to the top edge of the content scrollport that owns the observatory
    // (workline_observatory_scroll.css, `top: 0`). Narrow screens keep their original scroll owner, where
    // the bar scrolls away with the content (recorded in the WO69 triage), so only the desktop position is pinned.
    const stickyTop = await toolbar.evaluate((element) => {
      if (window.innerWidth <= 900) return null;
      // Mirror the renderer's owner lookup: the shared scrollport, else the nearest vertical scroller, else the window.
      let owner = element.closest('.tab-content-body > .scrollable_content, .management_forms.workline-observatory-view');
      for (let parent = element.parentElement; !owner && parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (/(auto|scroll|overlay)/.test(`${style.overflow} ${style.overflowY}`) && parent.scrollHeight > parent.clientHeight) owner = parent;
      }
      const ownerTop = owner ? owner.getBoundingClientRect().top : 0;
      return ownerTop + Number.parseFloat(getComputedStyle(element).top);
    });
    // Only the narrow branch may omit the position proof.
    expect(stickyTop === null).toBe(page.viewportSize()!.width <= 900);
    if (stickyTop !== null) expect(Math.abs((compactBox?.y ?? Number.POSITIVE_INFINITY) - stickyTop)).toBeLessThanOrEqual(2);

    // Scroll the toolbar's origin marker because the sticky toolbar can already be in view.
    await page.locator('.workline-observatory__toolbar-sentinel')
      .evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await expect(toolbar).toHaveAttribute('data-compact', 'false');
    await page.waitForTimeout(220);
    const restoredHeight = await toolbar.evaluate((element) => element.getBoundingClientRect().height);
    expect(Math.abs(restoredHeight - expandedHeight)).toBeLessThan(1);
  });
  test('Publications keeps reader fields, focus and explicit themes usable on desktop and mobile', async ({ page }, testInfo) => {
    const plan = { id: 164, identity_key: 'public-desktop-mobile', version: 1, title: 'Filterestin yhdistetty julkinen desktop- ja mobiilisivusto', outcome: 'Complete the required features.', decision_state: 'locked', publication_version: '9.4.0', target_date: '2026-12-01', reader_description: 'Desktop ja mobiili yhdessä.', published: false, published_at: null, publication_revision: 3, is_current_publication: true };
    const history = { ...plan, id: 163, title: 'Earlier publication', publication_version: '9.3.0', published: true, published_at: '2026-09-01T10:00:00Z', is_current_publication: false };
    // Browser fixtures exercise the real renderer without editing installation
    // records. Disposable PostgreSQL tests prove the real API and persistence.
    await page.route('**/api/app/workline-observatory/board*', (route) => route.fulfill({
      json: { dataset_surface_provider_key: 'workline-observatory', dataset_surface_capability_keys: ['workline-board-query'], worklines: [], release_goal: plan, publications: [plan, history], total_count: 0, filtered_count: 0 },
    }));
    let saved: Record<string, unknown> | null = null;
    await page.route('**/api/app/workline-observatory/release-goals', async (route) => {
      saved = route.request().postDataJSON();
      await route.fulfill({ json: { id: 164, publication_revision: 4 } });
    });
    for (const language of ['en', 'fi']) {
      for (const theme of ['light', 'dark'] as const) {
        await serveAccountTheme(page, theme);
        await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
        await page.evaluate(({ language, theme }) => {
          window.localStorage.setItem('chosen_language', language);
          window.localStorage.setItem('theme', theme);
        }, { language, theme });
        const accountThemeLoaded = page.waitForResponse((response) =>
          isAccountThemeRequest(new URL(response.url())) && response.request().method() === 'GET' && response.ok());
        await page.goto('/admin/workline_observatory', { waitUntil: 'domcontentloaded' });
        await accountThemeLoaded;
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
        await expect(page.locator('body')).not.toHaveClass(/\bsystem-mode\b/);
        // The chosen language lands about a second after load (<html lang> en -> fi). That real change re-presents
        // the board and rebuilds an open modal, dropping a value typed before it; interact with the settled page.
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        const opener = page.locator('[data-release-goal-details]');
        await opener.click();
        const modal = page.locator('#custom_modal');
        await expect(modal).toContainText(language === 'fi' ? 'Julkaisut' : 'Publications');
        await expect(modal.locator('[data-publication-current="true"]')).toHaveText(language === 'fi' ? 'Uusin julkaisematon' : 'Newest unpublished');
        const form = modal.locator('.workline-observatory__publication-editor');
        await expect(form.locator('[name="publication_version"]')).toHaveValue('9.4.0');
        await expect(form.locator('[name="target_date"]')).toHaveValue('2026-12-01');
        await expect(form.locator('[name="reader_description"]')).toHaveValue('Desktop ja mobiili yhdessä.');
        await expect(form.locator('[name="published"]')).not.toBeChecked();
        await expect(form.locator('[name="published_at"]')).toHaveValue('');
        await expect(form.locator('[name="published_at"]')).toBeDisabled();
        const date = form.locator('[name="target_date"]');
        await expect(date).toHaveCSS('color-scheme', theme);
        // Colour-scheme changes immediately; inherited colours may still be transitioning.
        await expect.poll(async () => {
          const colours = await date.evaluate(readButtonLuminance);
          return theme === 'light'
            ? colours.background > 0.9 && colours.text < 0.25
            : colours.background < 0.3 && colours.text > 0.8;
        }).toBe(true);
        await form.locator('[name="publication_version"]').focus();
        await page.keyboard.press('Tab');
        await expect(date).toBeFocused();
        await form.locator('[name="reader_description"]').focus();
        await expect(form.locator('[name="reader_description"]')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(form.locator('[name="published"]')).toBeFocused();
        const overflow = await form.evaluate((element) => [...element.querySelectorAll('input,textarea,button')].some((field) => {
          const bounds = field.getBoundingClientRect();
          return bounds.left < 0 || bounds.right > window.innerWidth + 1;
        }));
        expect(overflow).toBe(false);
        await modal.screenshot({ path: testInfo.outputPath(`publications-${language}-${theme}.png`) });
        await page.keyboard.press('Escape');
        await expect(modal).toBeHidden();
        await expect(opener).toBeFocused();
      }
    }
    await page.locator('[data-release-goal-details]').click();
    const form = page.locator('.workline-observatory__publication-editor');
    await form.locator('[name="target_date"]').fill('2026-12-02');
    await form.locator('button[type="submit"]').click();
    await expect.poll(() => saved).toMatchObject({ id: 164, action: 'update', expected_revision: 3, publication_version: '9.4.0', target_date: '2026-12-02', reader_description: 'Desktop ja mobiili yhdessä.', published: false, published_at: null });
  });

});

/** Clicks empty label padding, with a hit test proving it cannot activate a neighbouring control. */
const isAccountThemeRequest = (url: URL): boolean => url.pathname === '/api/user-visual-preference';

/** Supplies the account-owned theme on page loads, as T15 does, without saving preferences. */
async function serveAccountTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.unroute(isAccountThemeRequest);
  await page.route(isAccountThemeRequest, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({ json: { theme_mode: theme, revision: 1, configured: true } });
  });
}

function readButtonLuminance(element: Element) {
  const style = getComputedStyle(element);
  const luminance = (value: string) => {
    const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
    return channels.reduce((sum, channel, index) => sum + (channel / 255) * [0.2126, 0.7152, 0.0722][index], 0);
  };
  return {
    background: luminance(style.backgroundColor),
    text: luminance(style.color),
  };
}
