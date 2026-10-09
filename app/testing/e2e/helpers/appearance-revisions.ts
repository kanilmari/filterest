// appearance-revisions.ts
// Loads appearance revisions immediately before API writes and bounded restore retries.
// Connects E2E setup/cleanup to the same strict contracts used by the administrator UI.
// Preserves sparse inheritance and refuses cleanup against a replacement dataset.
import type { APIRequestContext, APIResponse } from '@playwright/test';
import type {
  CardVisibilityResponse, DatasetAppearanceResponse, DatasetCoverThemeConfig,
} from '../../../frontend/generated/go_contract_types';
import { fetchCsrfTokenForRequest } from './temp-dataset';

export type SitePresentationSettings = {
  version: string;
  dataset_cover_theme: DatasetCoverThemeConfig;
  row_article_timestamp_display_mode: string;
};

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
  if (visibility.table_name !== datasetName || !Number.isSafeInteger(appearance?.dataset_uid)
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

/** Restore the saved shared values; a concurrent revision change gets exactly one fresh retry. */
export async function restoreSitePresentationSettings(
  request: APIRequestContext, original: SitePresentationSettings,
): Promise<void> {
  const response = await postWithFreshRevisions(request, '/api/admin/site-presentation-settings', async () => {
    const latest = await loadSitePresentationSettings(request);
    return { ...original, version: latest.version };
  }, true);
  const restored = await response.json() as SitePresentationSettings;
  if (JSON.stringify(restored.dataset_cover_theme) !== JSON.stringify(original.dataset_cover_theme)
      || restored.row_article_timestamp_display_mode !== original.row_article_timestamp_display_mode) {
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
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const path of paths) {
    if (Object.hasOwn(original.overrides, path)) set[path] = original.overrides[path];
    else unset.push(path);
  }
  const response = await postWithFreshRevisions(request, '/api/admin/dataset-appearance', async () => {
    const latest = (await loadDatasetCardVisibility(request, datasetName)).dataset_appearance;
    if (latest.dataset_uid !== original.dataset_uid) {
      throw new Error(`Refusing appearance restore: dataset "${datasetName}" was replaced.`);
    }
    return { dataset_uid: original.dataset_uid, set, unset,
      version: latest.version, shared_version: latest.shared_version };
  }, true);
  const restored = await response.json() as DatasetAppearanceResponse;
  if (restored.dataset_uid !== original.dataset_uid || paths.some(path => (
    Object.hasOwn(restored.overrides, path) !== Object.hasOwn(original.overrides, path)
      || JSON.stringify(restored.overrides[path]) !== JSON.stringify(original.overrides[path])
  ))) {
    throw new Error(`Dataset "${datasetName}" appearance restore returned different overrides.`);
  }
}
