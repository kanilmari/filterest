// view_permission_routes.test.js
// Verifies the mapping from frontend view keys to UI permission routes.
// Bridges view selection and permission checks by locking down the exported registry.
// Exists to catch accidental route drift in a shared access-control map.

import { describe, test, expect } from 'vitest';
import { DATASET_VIEW_PERMISSION_ROUTES } from './dataset_view_registry.js';
import { VIEW_PERMISSION_ROUTES } from './view_permission_routes.js';

describe('VIEW_PERMISSION_ROUTES', () => {
  test('contains the expected view-to-route mappings', () => {
    expect(VIEW_PERMISSION_ROUTES).toBe(DATASET_VIEW_PERMISSION_ROUTES);
    expect(VIEW_PERMISSION_ROUTES).toEqual({
      card: '/ui/view/card',
      table: '/ui/view/table',
      normal: '/ui/view/list',
      transposed: '/ui/view/transposed',
      tree: '/ui/view/tree',
      ticket: '/ui/view/ticket',
      settings: '/ui/view/settings',
      cloud_management: '/ui/view/cloud_management',
    });
  });

  test('uses unique route values', () => {
    const routes = Object.values(VIEW_PERMISSION_ROUTES);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
