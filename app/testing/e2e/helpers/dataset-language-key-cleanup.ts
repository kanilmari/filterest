// dataset-language-key-cleanup.ts
// Removes language keys introduced by one disposable dataset fixture.
// Connects its pre-creation baseline and exact generated shapes to supported row APIs.
// Preserves existing/shared keys and verifies each deletion after dataset cleanup.
import type { APIRequestContext } from '@playwright/test';
import { readLangKeyInventory } from './test-artifact-cleanup';
import { readLangKeySources } from './lang-key-source-inventory';
import { fetchCsrfTokenForRequest } from './test-artifact-csrf-reader';
import { isOwnRunDatasetKey, sourceBelongsToRun } from './lang-key-drift-attribution';

export type DatasetLanguageKeys = ReadonlyMap<string, readonly string[]>;

/** Call after all fixture datasets are absent; the baseline must precede every create. */
export async function cleanupDatasetLanguageKeys(
  request: APIRequestContext, baseline: ReadonlySet<string>, datasets: DatasetLanguageKeys,
): Promise<void> {
  const names = [...datasets.keys()];
  // Several datasets in one fixture can share a newly generated column label.
  // Use the teardown's exact naming rules for each owner, without inventing
  // another generator or granting this fixture ownership of other run datasets.
  const ownsKey = (key: string) => names.some(name => isOwnRunDatasetKey(key, [name], datasets));
  const current = await readLangKeyInventory(request);
  const introduced = current.allLangKeys.filter(key => !baseline.has(key) && ownsKey(key));
  const sources = await readLangKeySources(request, introduced);
  const errors: unknown[] = [];
  for (const key of introduced) {
    try {
      // Sources on a dropped fixture can disappear. Surviving uses elsewhere
      // protect a new shared column key from deletion by this fixture.
      if (sources.get(key)?.some(source => !sourceBelongsToRun(source, names))) {
        throw new Error(`Fixture language key "${key}" is still used outside its datasets.`);
      }
      const params = { dataset: 'system_lang_keys', view_key: 'table', lang_key_from: key, lang_key_to: key };
      const read = await request.get('/api/get-results', { params });
      if (!read.ok()) throw new Error(`Could not read fixture language key "${key}".`);
      const payload = await read.json() as { data: Array<{ id: number; lang_key: string }>; row_count: number };
      if (payload.row_count !== 1 || payload.data.length !== 1 || payload.data[0].lang_key !== key
        || !Number.isSafeInteger(payload.data[0].id) || payload.data[0].id <= 0) {
        throw new Error(`Fixture language key "${key}" has an ambiguous identity.`);
      }
      const deletion = await request.post('/api/delete-rows?dataset=system_lang_keys', {
        headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(request) },
        data: { ids: [payload.data[0].id] },
      });
      if (!deletion.ok()) throw new Error(`Could not delete fixture language key "${key}".`);
      const verify = await request.get('/api/get-results', { params });
      if (!verify.ok()) throw new Error(`Could not verify fixture language key "${key}" removal.`);
      const remaining = await verify.json();
      if (remaining.row_count !== 0 || !Array.isArray(remaining.data) || remaining.data.length !== 0) {
        throw new Error(`Fixture language key "${key}" remains after deletion.`);
      }
    } catch (error) { errors.push(error); }
  }
  const remaining = (await readLangKeyInventory(request)).allLangKeys
    .filter(key => !baseline.has(key) && ownsKey(key));
  if (remaining.length) errors.push(new Error(`Fixture language keys remain: ${remaining.join(', ')}.`));
  if (errors.length) throw new AggregateError(errors, 'Dataset fixture language-key cleanup failed');
}
