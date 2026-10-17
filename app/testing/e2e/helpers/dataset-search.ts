// dataset-search.ts
// Reveals the active dataset's text search through its visible search button.
// Connects E1 and responsive toolbar proofs to the shared search surfaces.
// Avoids hidden duplicate inputs and fails when neither field nor button is reachable.
import { expect, type Locator, type Page } from '@playwright/test';
import { waitForActiveFilterbarLayout } from './filterbar';
import { getActiveDatasetContainer } from './active-dataset';

/**
 * Returns a usable search field in the active dataset, opening phone search if needed.
 * Uses the person's click/tap path after layout readiness, without changing filter settings.
 */
export async function openActiveDatasetSearch(
  page: Page,
  activation: 'click' | 'tap' = 'click',
): Promise<Locator> {
  const activeDataset = await getActiveDatasetContainer(page);
  await waitForActiveFilterbarLayout(page, activeDataset);
  // Each host has its own input; DOM order does not identify the current search surface.
  const input = activeDataset.locator(
    '[data-testid="dataset-search-input"]:visible, [data-testid^="dataset-search-input-"]:visible',
  ).first();
  const toggle = activeDataset.getByTestId('mobile-search-toggle');
  await expect.poll(async () => await input.isVisible() || await toggle.isVisible(), {
    message: 'The active dataset must expose a search field or its search button.',
    timeout: 5000,
  }).toBe(true);

  if (!await input.isVisible()) {
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute('aria-hidden', 'false');
    if (activation === 'tap') await toggle.tap();
    else await toggle.click();
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
  }
  await expect(input).toBeVisible();
  await expect(input).toBeEditable();
  return input;
}
