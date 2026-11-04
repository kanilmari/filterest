// image-first-article.test.ts
// Proves the shared role helper preserves its default and accepts a marked fixture detail column.
// Connects the real role mapping to a controlled appearance write, without a browser.
// Keeps C32's marker change from changing the other callers' field roles.
import { beforeEach, expect, test, vi } from 'vitest';
import type { Page } from '@playwright/test';

const { saveVisibility } = vi.hoisted(() => ({ saveVisibility: vi.fn() }));
vi.mock('./appearance-revisions', () => ({ saveCardVisibilityWithFreshRevisions: saveVisibility }));
import { configureArticleFieldRoles } from './image-first-article';

beforeEach(() => { saveVisibility.mockReset(); });

test.each([undefined, 'e2e_detail_note'])('role configuration keeps the requested detail column: %s', async column => {
  const detail = column ?? 'detail_note';
  const untouched = { column_name: 'id', card_element: 'id' };
  const visibility = {
    card_details_layout: 'inline', card_style_variant: 'standard',
    columns: [untouched, ...['title', 'description', detail].map(column_name => ({ column_name }))],
  };
  let configured: typeof visibility | undefined;
  saveVisibility.mockImplementation(async (_request, _dataset, configure) => { configured = configure(visibility); });
  const page = { request: {} } as Page;
  await configureArticleFieldRoles(page, 'e2e_role_helper', column);
  expect(saveVisibility).toHaveBeenCalledWith(page.request, 'e2e_role_helper', expect.any(Function));
  expect(configured).toEqual({
    card_details_layout: 'inline', card_style_variant: 'standard',
    columns: [untouched, ...[
      ['title', 'header'], ['description', 'description'], [detail, 'details'],
    ].map(([column_name, card_element]) => ({ column_name, card_element, show_value_on_card: true, hide_on_big_card: false }))],
  });
});
