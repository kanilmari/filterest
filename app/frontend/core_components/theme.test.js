// @vitest-environment jsdom
// theme.test.js
// Verifies theme class switching and system color-scheme listener lifecycle.
// Bridges the theme module, document body classes, and mocked matchMedia events.
// Exists to prevent stale system-mode listeners from overriding explicit theme choices.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function installMatchMediaMock(initialMatches = false) {
    const listeners = new Set();
    const mediaQuery = {
        matches: initialMatches,
        addEventListener: vi.fn((eventName, handler) => {
            if (eventName === 'change') listeners.add(handler);
        }),
        removeEventListener: vi.fn((eventName, handler) => {
            if (eventName === 'change') listeners.delete(handler);
        }),
        dispatch(nextMatches) {
            mediaQuery.matches = nextMatches;
            listeners.forEach((handler) => handler({ matches: nextMatches }));
        },
        get listenerCount() {
            return listeners.size;
        },
    };

    vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery));
    return mediaQuery;
}

async function loadModule() {
    vi.resetModules();
    return import('./theme.js');
}

describe('theme', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        document.body.className = '';
        document.body.innerHTML = '<button id="themeToggleBtn"></button>';
        localStorage.clear();
        installMatchMediaMock(false);
    });

    test('system theme follows the active media query while system mode is selected', async () => {
        const mediaQuery = installMatchMediaMock(false);
        const { applyTheme } = await loadModule();

        applyTheme('system');

        expect(document.body.classList.contains('system-mode')).toBe(true);
        expect(document.body.classList.contains('light-mode')).toBe(true);
        expect(mediaQuery.listenerCount).toBe(1);

        mediaQuery.dispatch(true);

        expect(document.body.classList.contains('dark-mode')).toBe(true);
        expect(document.body.classList.contains('light-mode')).toBe(false);
    });

    test('explicit theme removes stale system listener before OS theme changes fire', async () => {
        const mediaQuery = installMatchMediaMock(false);
        const { applyTheme } = await loadModule();

        applyTheme('system');
        applyTheme('light');
        mediaQuery.dispatch(true);

        expect(mediaQuery.removeEventListener).toHaveBeenCalledTimes(1);
        expect(mediaQuery.listenerCount).toBe(0);
        expect(document.body.classList.contains('light-mode')).toBe(true);
        expect(document.body.classList.contains('dark-mode')).toBe(false);
        expect(document.body.classList.contains('system-mode')).toBe(false);
    });

    test('locked theme icon keys resolve to packaged source assets', async () => {
        const { themeIcons } = await loadModule();

        expect(themeIcons["locked-light"]).toBe(
            "/frontend/icons/navigation/theme-locked-light-icon.svg"
        );
        expect(themeIcons["locked-dark"]).toBe(
            "/frontend/icons/navigation/theme-locked-dark-icon.svg"
        );
        expect(themeIcons.lockedLight).toBe(themeIcons["locked-light"]);
        expect(themeIcons.lockedDark).toBe(themeIcons["locked-dark"]);

        [
            themeIcons.light,
            themeIcons.dark,
            themeIcons.system,
            themeIcons["locked-light"],
            themeIcons["locked-dark"],
        ].forEach((iconPath) => {
            expect(existsSync(resolve(repoRoot, iconPath.slice(1)))).toBe(true);
        });
    });

    test('locked theme states reuse concrete light and dark classes', async () => {
        const { applyTheme, updateThemeButton } = await loadModule();

        applyTheme('locked-light');
        await updateThemeButton('locked-light');

        expect(document.body.classList.contains('light-mode')).toBe(true);
        expect(document.body.classList.contains('dark-mode')).toBe(false);
        expect(document.querySelector('.theme-toggle-icon')?.style.maskImage)
            .toContain('theme-locked-light-icon.svg');

        applyTheme('locked-dark');
        await updateThemeButton('locked-dark');

        expect(document.body.classList.contains('dark-mode')).toBe(true);
        expect(document.body.classList.contains('light-mode')).toBe(false);
        expect(document.querySelector('.theme-toggle-icon')?.style.maskImage)
            .toContain('theme-locked-dark-icon.svg');
    });

    test('reusable data-theme buttons cycle the shared theme state', async () => {
        document.body.innerHTML = '<button data-theme-toggle></button>';
        const { initializeThemeToggle } = await loadModule();
        const themeButton = document.querySelector('[data-theme-toggle]');

        initializeThemeToggle(themeButton);
        themeButton.click();

        expect(localStorage.getItem('theme')).toBe('dark');
        expect(document.body.classList.contains('dark-mode')).toBe(true);
        expect(themeButton.getAttribute('aria-label')).toBe('Theme: dark');
    });
});
