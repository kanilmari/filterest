// row-opening-override.ts
// Sets how one disposable dataset opens its rows, and the sort its visitors start with, through the administrator's own API.
// Connects the row presentation proofs to the dataset's current revisions, so each write names the version it read.
// Exists so the proofs that need an image-first dataset do not each keep their own copy of the same request.
import { expect, type Page } from '@playwright/test';
import { loadDatasetCardVisibility } from './appearance-revisions';
import { postJsonWithCsrf } from './image-first-article';

/** The dataset appearance setting that says how a row opens. */
export const ROW_OPENING_PATH = 'shared.row_article_default_presentation';

/** Only patch this disposable table, using its current UID and both revisions. */
export async function setRowOpeningOverride(page: Page, dataset: string, mode: string | null) {
  const { dataset_appearance: appearance } = await loadDatasetCardVisibility(page.request, dataset);
  const response = await postJsonWithCsrf(page, '/api/admin/dataset-appearance', {
    schema_version: 2, dataset_uid: appearance.dataset_uid, version: appearance.version,
    shared_version: appearance.shared_version, tab_set: {},
    set: mode ? { [ROW_OPENING_PATH]: mode } : {}, unset: mode ? [] : [ROW_OPENING_PATH],
  });
  expect(response.status, response.body).toBe(200);
}

/** Saves the sort every visitor of the dataset starts with, as "Set default" does for everyone. */
export async function saveSiteSortDefault(page: Page, dataset: string, value: string) {
  const saved = await postJsonWithCsrf(page, '/api/admin/dataset-sort-default', { dataset, value, scope: 'site' });
  expect(saved.status, saved.body).toBe(200);
}
