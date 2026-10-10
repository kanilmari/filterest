// temp-dataset-card-readiness.test.ts
// Checks empty-card readiness without an application server or browser transport.
// Connects the real page helper's predicates with visible dataset and count DOM.
// Keeps row-based readiness strict while allowing an explicit zero-row proof.
import { beforeEach, expect, test, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { openTempDataset } from './temp-dataset';

vi.mock('./navigation', () => ({
  navigateToDataset: vi.fn(), waitForAppReady: vi.fn(), waitForDataLoaded: vi.fn(),
}));
vi.mock('./tree-data-cache', () => ({ hydrateAuthenticatedTreeDataCache: vi.fn() }));

function pageFixture() {
  return {
    goto: vi.fn(), evaluate: vi.fn(async () => true), waitForSelector: vi.fn(),
    waitForFunction: vi.fn(async (predicate, argument) => {
      if (!predicate(argument)) throw new Error('Dataset view is not ready');
    }),
  } as unknown as Page;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('table_specs', JSON.stringify({ empty: { table_uid: 11 } }));
  document.body.innerHTML = `<div id="empty_card_view_container" class="scrollable_content">
    <div id="empty_card_top_controls"><div data-results-count-for="empty" data-result-count="0"></div></div>
    <div class="card_view_wrapper"></div>
  </div>`;
  vi.spyOn(document.getElementById('empty_card_view_container')!, 'getBoundingClientRect')
    .mockReturnValue({ width: 400, height: 30 } as DOMRect);
});

test('an explicitly empty card view waits for its completed zero count', async () => {
  await expect(openTempDataset(pageFixture(), 'empty', 'card', { expectEmpty: true })).resolves.toBeUndefined();
});

test('ordinary card readiness still requires a visible card wrapper with height', async () => {
  await expect(openTempDataset(pageFixture(), 'empty', 'card')).rejects.toThrow('not ready');
});

test.each(['missing count', 'wrong dataset', 'nonzero count', 'hidden view', 'hidden wrapper', 'unexpected card'])(
  'empty card readiness refuses %s', async failure => {
    const count = document.querySelector<HTMLElement>('[data-results-count-for]')!;
    if (failure === 'missing count') count.remove();
    if (failure === 'wrong dataset') count.dataset.resultsCountFor = 'other';
    if (failure === 'nonzero count') count.dataset.resultCount = '1';
    if (failure === 'hidden view') document.getElementById('empty_card_view_container')!.style.display = 'none';
    if (failure === 'hidden wrapper') document.querySelector<HTMLElement>('.card_view_wrapper')!.style.display = 'none';
    if (failure === 'unexpected card') document.querySelector('.card_view_wrapper')!.innerHTML = '<div class="card"></div>';
    await expect(openTempDataset(pageFixture(), 'empty', 'card', { expectEmpty: true })).rejects.toThrow('not ready');
  },
);
