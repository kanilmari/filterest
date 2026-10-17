// active-dataset.ts
// Resolves the selected dataset only after its mounted surface owns the page.
// Connects navigation, view, filterbar and search helpers to one visibility rule.
// Uses internal table identities, independently of public aliases in the address.
import { type Locator, type Page } from '@playwright/test';

/** Wait for the requested/selected dataset and the departure of every other dataset. */
export async function getActiveDatasetContainer(page: Page, tableName?: string): Promise<Locator> {
  const activeId = await page.waitForFunction((requestedName) => {
    const selectedName = requestedName || sessionStorage.getItem('selected_dataset');
    // Keep the rendered-surface definition shared with view detection: visibility,
    // display and client rects, including display:none on an ancestor.
    const visible = Array.from(document.querySelectorAll('.tab_parts_container'))
      .filter((candidate): candidate is HTMLElement => {
        if (!(candidate instanceof HTMLElement)) return false;
        const style = getComputedStyle(candidate);
        return style.display !== 'none' && style.visibility !== 'hidden'
          && candidate.getClientRects().length > 0;
      });
    if (visible.length !== 1) return false;
    const container = visible[0];
    if (!container.id.endsWith('_tab_parts_container')) return false;
    if (selectedName && container.id !== `${selectedName}_tab_parts_container`) return false;
    return container.id;
  }, tableName ?? null, { timeout: 15000 });
  const id = await activeId.jsonValue();
  await activeId.dispose();
  return page.locator(`[id=${JSON.stringify(id)}]`);
}
