// permission_icons.test.js
// Verifies permission editor icon loading and exported cached SVG bindings.
// Bridges the shared icon loader and admin permission visuals in module isolation.
// Exists to catch regressions in icon ordering, caching, and exported state updates.

import { describe, test, expect, beforeEach, vi } from 'vitest';

const loadSvgIconMock = vi.fn();

async function loadModule() {
  vi.resetModules();
  vi.doMock('../../icons/icon_loader.js', () => ({
    loadSvgIcon: loadSvgIconMock,
  }));
  return import('./permission_icons.js');
}

describe('permission_icons', () => {
  beforeEach(() => {
    loadSvgIconMock.mockReset();
  });

  test('loads all permission icons once and updates exported SVG bindings', async () => {
    const loadedIcons = [
      '<svg>table</svg>',
      '<svg>user</svg>',
      '<svg>ui</svg>',
      '<svg>edit</svg>',
      '<svg>global</svg>',
      '<svg>checked</svg>',
      '<svg>unchecked</svg>',
      '<svg>ambiguous</svg>',
    ];
    loadSvgIconMock.mockImplementation((path) => Promise.resolve(`<svg>${path}</svg>`));
    const mod = await loadModule();

    await mod.ensurePermissionIconsLoaded();
    await mod.ensurePermissionIconsLoaded();

    expect(loadSvgIconMock).toHaveBeenCalledTimes(8);
    expect(mod.table_icon_svg).toBe('<svg>/frontend/icons/admin/permission-table-icon.svg</svg>');
    expect(mod.user_icon_svg).toBe('<svg>/frontend/icons/admin/permission-user-icon.svg</svg>');
    expect(mod.ui_icon_svg).toBe('<svg>/frontend/icons/admin/permission-ui-icon.svg</svg>');
    expect(mod.edit_icon_svg).toBe('<svg>/frontend/icons/admin/permission-edit-icon.svg</svg>');
    expect(mod.global_icon_svg).toBe('<svg>/frontend/icons/admin/permission-global-icon.svg</svg>');
    expect(mod.static_checked_svg).toBe('<svg>/frontend/icons/admin/permission-checkbox-checked-icon.svg</svg>');
    expect(mod.static_unchecked_svg).toBe('<svg>/frontend/icons/admin/permission-checkbox-unchecked-icon.svg</svg>');
    expect(mod.static_ambiguous_svg).toBe('<svg>/frontend/icons/admin/permission-checkbox-ambiguous-icon.svg</svg>');
    expect(loadedIcons).toHaveLength(8);
  });
});
