// appearance-revisions.ts
// Loads appearance revisions immediately before API writes and bounded restore retries.
// Connects E2E setup/cleanup to the same strict contracts used by the administrator UI.
// Preserves sparse inheritance and refuses cleanup against a replacement dataset.
import type { APIRequestContext, APIResponse } from '@playwright/test';
import type {
  CardVisibilityResponse, DatasetAppearanceResponse, SitePresentationSettingsResponse,
} from '../../../frontend/generated/go_contract_types';
import { fetchCsrfTokenForRequest } from './temp-dataset';

// Follows dataset_appearance_palette_state.js and site_presentation_state.js:
// tab patches own 28 cover values plus nine overrides; site patches own 7/9 maps.
export type SitePresentationSettings = SitePresentationSettingsResponse;

async function readJson<T>(request: APIRequestContext, url: string): Promise<T> {
  const response = await request.get(url);
  const body = await response.text();
  if (!response.ok()) throw new Error(`Appearance GET ${url} failed: ${response.status()} ${body}`);
  return JSON.parse(body) as T;
}

function requireRevision(value: unknown, scope: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing ${scope} appearance revision; no write was sent.`);
  }
}

/** Read both dataset revisions from one authorized response, including the absent-row token. */
export async function loadDatasetCardVisibility(
  request: APIRequestContext, datasetName: string,
): Promise<CardVisibilityResponse> {
  const visibility = await readJson<CardVisibilityResponse>(
    request, `/api/card-visibility/${encodeURIComponent(datasetName)}`,
  );
  const appearance = visibility.dataset_appearance;
  if (appearance?.schema_version !== 2 || visibility.table_name !== datasetName || !Number.isSafeInteger(appearance?.dataset_uid)
      || appearance.dataset_uid <= 0 || !Array.isArray(visibility.columns)) {
    throw new Error(`Invalid appearance identity/metadata for dataset "${datasetName}"; no write was sent.`);
  }
  requireRevision(appearance.version, 'dataset');
  requireRevision(appearance.shared_version, 'shared');
  return visibility;
}

/** Read the shared settings and their revision together, rather than reusing a pre-test version. */
export async function loadSitePresentationSettings(
  request: APIRequestContext,
): Promise<SitePresentationSettings> {
  const settings = await readJson<SitePresentationSettings>(request, '/api/admin/site-presentation-settings');
  if (settings.schema_version !== 2 || !settings.site_values || !settings.defaults) throw new Error('Invalid site appearance maps.');
  requireRevision(settings.version, 'shared');
  return settings;
}

async function postWithFreshRevisions(
  request: APIRequestContext,
  url: string,
  loadPayload: () => Promise<Record<string, unknown>>,
  restoring: boolean,
): Promise<APIResponse> {
  // Obtain CSRF first so the revision read is the last API call before every POST.
  const csrfToken = await fetchCsrfTokenForRequest(request);
  const attempts = restoring ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const data = await loadPayload();
    const response = await request.post(url, { data, headers: { 'X-CSRF-Token': csrfToken } });
    if (response.ok()) return response;
    if (restoring && attempt === 0 && response.status() === 409) {
      await response.dispose();
      continue;
    }
    throw new Error(`Appearance ${restoring ? 'restore' : 'save'} ${url} failed after ${attempt + 1} attempt(s): `
      + `${response.status()} ${await response.text()}`);
  }
  throw new Error(`Appearance restore ${url} did not complete.`);
}

/** Build a field-editor write from current metadata and attach both freshly loaded revisions. */
export async function saveCardVisibilityWithFreshRevisions(
  request: APIRequestContext,
  datasetName: string,
  buildPayload: (visibility: CardVisibilityResponse) => Record<string, unknown>,
): Promise<APIResponse> {
  return postWithFreshRevisions(request, '/api/card-visibility/update', async () => {
    const visibility = await loadDatasetCardVisibility(request, datasetName);
    return { ...buildPayload(visibility), table_name: datasetName,
      version: visibility.dataset_appearance.version,
      shared_version: visibility.dataset_appearance.shared_version };
  }, false);
}

/** Restore only this test's site paths; unrelated concurrent edits remain intact. */
export async function restoreSitePresentationSettings(
  request: APIRequestContext, original: SitePresentationSettings, paths: string[],
): Promise<void> {
  const originalValues = { ...original.site_values, ...original.defaults };
  if (paths.some(path => !Object.hasOwn(originalValues, path))) throw new Error('Invalid site restore path.');
  const set = Object.fromEntries(paths.map(path => [path, originalValues[path]]));
  const response = await postWithFreshRevisions(request, '/api/admin/site-presentation-settings', async () => {
    const latest = await loadSitePresentationSettings(request);
    return { schema_version: 2, version: latest.version, set };
  }, true);
  const restored = await response.json() as SitePresentationSettings;
  const actual = { ...restored.site_values, ...restored.defaults };
  if (paths.some(path => actual[path] !== originalValues[path])) {
    throw new Error('Shared appearance restore returned different settings.');
  }
}

/** Restore only the leaves changed by a test, retaining absent overrides as inheritance. */
export async function restoreDatasetAppearance(
  request: APIRequestContext,
  datasetName: string,
  original: DatasetAppearanceResponse,
  paths: string[],
): Promise<void> {
  const tab_set: Record<string, unknown> = {};
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const path of paths) {
    if (Object.hasOwn(original.tab_values, path)) tab_set[path] = original.tab_values[path];
    else if (!Object.hasOwn(original.defaults, path)) throw new Error('Invalid tab restore path.');
    else if (Object.hasOwn(original.overrides, path)) set[path] = original.overrides[path];
    else unset.push(path);
  }
  const response = await postWithFreshRevisions(request, '/api/admin/dataset-appearance', async () => {
    const latest = (await loadDatasetCardVisibility(request, datasetName)).dataset_appearance;
    if (latest.dataset_uid !== original.dataset_uid) {
      throw new Error(`Refusing appearance restore: dataset "${datasetName}" was replaced.`);
    }
    return { schema_version: 2, dataset_uid: original.dataset_uid, tab_set, set, unset,
      version: latest.version, shared_version: latest.shared_version };
  }, true);
  const restored = await response.json() as DatasetAppearanceResponse;
  if (restored.dataset_uid !== original.dataset_uid || paths.some(path => (
    Object.hasOwn(original.tab_values, path) ? restored.tab_values[path] !== original.tab_values[path]
      : Object.hasOwn(restored.overrides, path) !== Object.hasOwn(original.overrides, path)
      || JSON.stringify(restored.overrides[path]) !== JSON.stringify(original.overrides[path])
  ))) {
    throw new Error(`Dataset "${datasetName}" appearance restore returned different overrides.`);
  }
}
