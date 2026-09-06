// @vitest-environment jsdom
// theme.test.js
// Verifies theme class switching and system color-scheme listener lifecycle.
// Bridges the theme module, document body classes, and mocked matchMedia events.
// Exists to prevent stale system-mode listeners from overriding explicit theme choices.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { fetchUserVisualPreferenceMock, saveUserVisualPreferenceMock } = vi.hoisted(() => ({
    fetchUserVisualPreferenceMock: vi.fn(),
    saveUserVisualPreferenceMock: vi.fn(),
}));

vi.mock('./theme_preference_api.js', () => ({
    fetchUserVisualPreference: fetchUserVisualPreferenceMock,
    saveUserVisualPreference: saveUserVisualPreferenceMock,
}));

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
        fetchUserVisualPreferenceMock.mockReset();
        saveUserVisualPreferenceMock.mockReset();
        fetchUserVisualPreferenceMock.mockResolvedValue({ theme_mode: 'system' });
        saveUserVisualPreferenceMock.mockImplementation(async (themeMode) => ({ theme_mode: themeMode }));
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

    test('loads the account theme without overwriting the guest device choice', async () => {
        localStorage.setItem('theme', 'light');
        const { synchronizeThemePreferenceForAuthState } = await loadModule();
        fetchUserVisualPreferenceMock.mockResolvedValue({ theme_mode: 'dark' });

        const resolvedTheme = await synchronizeThemePreferenceForAuthState(true);

        expect(resolvedTheme).toBe('dark');
        expect(document.body.classList.contains('dark-mode')).toBe(true);
        expect(localStorage.getItem('theme')).toBe('light');
    });

    test('ignores a late account response after the user has returned to guest mode', async () => {
        localStorage.setItem('theme', 'light');
        let resolveAccountTheme;
        fetchUserVisualPreferenceMock.mockImplementation(() => new Promise((resolve) => {
            resolveAccountTheme = resolve;
        }));
        const { synchronizeThemePreferenceForAuthState } = await loadModule();

        const accountSynchronization = synchronizeThemePreferenceForAuthState(true);
        await synchronizeThemePreferenceForAuthState(false);
        resolveAccountTheme({ theme_mode: 'dark' });
        await accountSynchronization;

        expect(document.body.classList.contains('light-mode')).toBe(true);
        expect(document.body.classList.contains('dark-mode')).toBe(false);
    });

    test('keeps guest changes device-local and saves authenticated changes to the account', async () => {
        document.body.innerHTML = '<button data-theme-toggle></button>';
        localStorage.setItem('theme', 'system');
        const { initializeThemeToggle } = await loadModule();
        const themeButton = document.querySelector('[data-theme-toggle]');

        initializeThemeToggle(themeButton);
        themeButton.click();
        await Promise.resolve();
        expect(localStorage.getItem('theme')).toBe('dark');
        expect(saveUserVisualPreferenceMock).not.toHaveBeenCalled();

        localStorage.setItem('button_state', 'logout');
        themeButton.click();
        await vi.waitFor(() => expect(saveUserVisualPreferenceMock).toHaveBeenCalledWith('light'));
        expect(localStorage.getItem('theme')).toBe('dark');
    });

    test('restores the previous account theme when persistence fails', async () => {
        document.body.innerHTML = '<button data-theme-toggle></button>';
        localStorage.setItem('button_state', 'logout');
        saveUserVisualPreferenceMock.mockRejectedValue(new Error('offline'));
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { initializeThemeToggle } = await loadModule();
        const themeButton = document.querySelector('[data-theme-toggle]');

        initializeThemeToggle(themeButton);
        themeButton.click();

        await vi.waitFor(() => expect(themeButton.disabled).toBe(false));
        expect(document.body.classList.contains('light-mode')).toBe(true);
        expect(warnSpy).toHaveBeenCalledWith('Account theme preference save failed', expect.any(Error));
    });
});
