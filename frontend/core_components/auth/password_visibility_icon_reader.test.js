// password_visibility_icon_reader.test.js
// Verifies password visibility icon loading and cache reuse in auth UI helpers.
// Bridges the icon loader dependency and exported cached SVG accessors in isolation.
// Exists to prevent duplicate icon fetches and broken toggle icon state.

import { describe, test, expect, beforeEach, vi } from 'vitest';

const loadSvgIconMock = vi.fn();

async function loadModule() {
  vi.resetModules();
  vi.doMock('../../icons/icon_loader.js', () => ({
    loadSvgIcon: loadSvgIconMock,
  }));
  return import('./password_visibility_icon_reader.js');
}

describe('password_visibility_icon_reader', () => {
  beforeEach(() => {
    loadSvgIconMock.mockReset();
  });

  test('returns empty SVG strings before loading', async () => {
    const mod = await loadModule();
    expect(mod.getPasswordVisibilityIcons()).toEqual({
      visibilityOffSvg: '',
      visibilityOnSvg: '',
    });
  });

  test('loads both icons once and exposes the cached SVG strings', async () => {
    loadSvgIconMock
      .mockResolvedValueOnce('<svg>off</svg>')
      .mockResolvedValueOnce('<svg>on</svg>');
    const mod = await loadModule();

    await mod.ensurePasswordVisibilityIconsLoaded();
    await mod.ensurePasswordVisibilityIconsLoaded();

    expect(loadSvgIconMock).toHaveBeenCalledTimes(2);
    expect(loadSvgIconMock).toHaveBeenNthCalledWith(
      1,
      '/frontend/icons/auth/password-visibility-off-icon.svg'
    );
    expect(loadSvgIconMock).toHaveBeenNthCalledWith(
      2,
      '/frontend/icons/auth/password-visibility-on-icon.svg'
    );
    expect(mod.getPasswordVisibilityIcons()).toEqual({
      visibilityOffSvg: '<svg>off</svg>',
      visibilityOnSvg: '<svg>on</svg>',
    });
  });
});
