// retired_reference_route.test.js
// Imports the real frontend route modules after retiring the unrestricted option route.
// Bridges the generated backend manifest, pipeline aliases and endpoint consumers.
// Exists to catch stale aliases that otherwise throw while the application loads.

import { expect, test } from 'vitest';

test('loads the pipeline and endpoints with only the policy-aware option route', async () => {
    const pipeline = await import('../pipeline/api_pipeline.js');
    const router = await import('./endpoint_router.js');
    const fetcher = await import('./endpoint_data_fetcher.js');
    const rowFetcher = await import('../general_tables/gt_1_row_crud/gt_1_1_row_create/row_api_fetcher.js');
    const inventory = await import('./stable_api_inventory.js');
    expect(typeof router.endpoint_router).toBe('function');
    expect(typeof fetcher.fetchFilterOptions).toBe('function');
    expect(typeof rowFetcher.fetchLinkableRows).toBe('function');
    expect(rowFetcher).not.toHaveProperty('fetchReferencedData');
    expect(pipeline.ENDPOINT_ROUTE_NAMES).not.toContain('referencedData');
    expect(inventory.CLASSIFIED_ROUTE_NAMES).not.toContain('referencedData');
    expect(pipeline.getEndpointUrl('getFilterOptions')).toBe('/api/get-filter-options');
});
