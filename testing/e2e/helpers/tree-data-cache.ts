/**
 * tree-data-cache.ts
 * Hydrates authenticated database-tree and table-spec caches for Playwright pages.
 * Bridges /api/tree_data responses and the localStorage metadata used by dataset views.
 * Exists so global setup and API-created temp datasets share one cache contract.
 */

import { type Page } from '@playwright/test';

type TreeCacheRefreshResult = {
  ok: boolean;
  status: number;
  body: string;
};

/**
 * Refreshes the authenticated tree payload and derives the complete table_specs map.
 * Bridges the current browser session and metadata-dependent dataset UI code.
 * Exists so saved E2E storage state and newly created datasets use the same fresh cache.
 */
export async function hydrateAuthenticatedTreeDataCache(
  page: Page,
  requiredDatasetName?: string,
): Promise<void> {
  const result = await page.evaluate(async (expectedDatasetName): Promise<TreeCacheRefreshResult> => {
    const response = await fetch('/api/tree_data', { credentials: 'include' });
    const responseBody = await response.text();
    if (!response.ok) {
      return { ok: false, status: response.status, body: responseBody };
    }

    let treeData: unknown;
    try {
      treeData = JSON.parse(responseBody);
    } catch {
      return {
        ok: false,
        status: response.status,
        body: 'tree_data response was not valid JSON',
      };
    }

    if (!treeData || typeof treeData !== 'object' || Array.isArray(treeData)) {
      return {
        ok: false,
        status: response.status,
        body: 'tree_data response was not a JSON object',
      };
    }

    const nodesValue = (treeData as { nodes?: unknown }).nodes;
    if (!Array.isArray(nodesValue)) {
      return {
        ok: false,
        status: response.status,
        body: 'tree_data response did not include a nodes array',
      };
    }

    const nodes = nodesValue as Array<Record<string, unknown>>;
    if (expectedDatasetName) {
      const requiredDatasetNode = nodes.find((node) => node?.name === expectedDatasetName);
      if (!requiredDatasetNode || requiredDatasetNode.table_uid == null) {
        return {
          ok: false,
          status: response.status,
          body: `tree_data did not include table_uid metadata for "${expectedDatasetName}"`,
        };
      }
    }

    const tableSpecs: Record<string, Record<string, unknown>> = {};
    for (const node of nodes) {
      const datasetName = typeof node?.name === 'string' ? node.name : '';
      if (!datasetName || node.table_uid == null) {
        continue;
      }

      const bannerIconUrlsByLanguage = node.banner_icon_urls_by_lang ?? node.banner_icons_by_lang;
      tableSpecs[datasetName] = {
        table_uid: node.table_uid,
        default_view_name: node.default_view_name,
        filterbar_visible_by_default: node.filterbar_visible_by_default,
        ...(node.banner_icon_url ? { banner_icon_url: node.banner_icon_url } : {}),
        ...(bannerIconUrlsByLanguage
          ? { banner_icon_urls_by_lang: bannerIconUrlsByLanguage }
          : {}),
        ...(node.dataset_icon_url ? { dataset_icon_url: node.dataset_icon_url } : {}),
        ...(node.icon_key ? { icon_key: node.icon_key } : {}),
        ...(node.display_name ? { display_name: node.display_name } : {}),
        ...(node.search_slogan ? { search_slogan: node.search_slogan } : {}),
        ...(node.search_placeholder ? { search_placeholder: node.search_placeholder } : {}),
      };
    }

    localStorage.setItem('full_tree_data', JSON.stringify(treeData));
    localStorage.setItem('full_tree_data_cached_at', String(Date.now()));
    localStorage.setItem('table_specs', JSON.stringify(tableSpecs));

    return { ok: true, status: response.status, body: '' };
  }, requiredDatasetName);

  if (!result.ok) {
    const expectedDatasetContext = requiredDatasetName
      ? ` for "${requiredDatasetName}"`
      : '';
    throw new Error(
      `Failed to hydrate authenticated database-tree cache${expectedDatasetContext}: ` +
        `${result.status} ${result.body}`,
    );
  }
}
