// theme.js
// Manages application theme (light, dark, system) including persistence and icon updates.
// Bridges the themes array and themeIcons map with localStorage and DOM class toggling.
// Exists to centralise all theme-switching logic away from individual UI components.
import { createMaskIconSpan } from "../icons/icon_mask_builder.js";

export const themes = ['system', 'dark', 'light'];

export const themeIcons = {
    light: "/frontend/icons/navigation/theme-light-icon.svg",
    dark: "/frontend/icons/navigation/theme-dark-icon.svg",
    system: "/frontend/icons/navigation/theme-system-icon.svg",
    lockedLight: "/frontend/icons/navigation/theme-locked-light-icon.svg",
    lockedDark: "/frontend/icons/navigation/theme-locked-dark-icon.svg",
    "locked-light": "/frontend/icons/navigation/theme-locked-light-icon.svg",
    "locked-dark": "/frontend/icons/navigation/theme-locked-dark-icon.svg",
};

let currentThemeIndex;
let systemThemeMediaQuery = null;
let systemThemeChangeHandler = null;
const initializedThemeButtons = new WeakSet();

document.addEventListener('DOMContentLoaded', () => {
    currentThemeIndex = initializeTheme(themes, applyTheme);

    // Enable theme transitions only after the initial themed paint has landed,
    // so the page does not animate from the browser default into the saved theme.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            document.body?.classList.add('theme-transitions-ready');
        });
    });

    document.querySelectorAll('[data-theme-toggle], #themeToggleBtn').forEach((button) => {
        initializeThemeToggle(button);
    });
});

/**
 * Binds one reusable theme button to the shared light/dark/system state.
 *
 * @param {HTMLElement} themeToggleButton
 */
export function initializeThemeToggle(themeToggleButton) {
    if (!(themeToggleButton instanceof HTMLElement) || initializedThemeButtons.has(themeToggleButton)) {
        return;
    }

    initializedThemeButtons.add(themeToggleButton);
    if (!Number.isInteger(currentThemeIndex)) {
        currentThemeIndex = initializeTheme(themes, applyTheme);
    } else {
        void updateThemeButton(themes[currentThemeIndex], themeToggleButton);
    }

    themeToggleButton.addEventListener('click', function(event) {
        event.stopPropagation();
        currentThemeIndex = (currentThemeIndex + 1) % themes.length;
        const newTheme = themes[currentThemeIndex];
        applyTheme(newTheme);
        localStorage.setItem('theme', newTheme);
        void updateThemeButton(newTheme);
    });
}


/**
 * applyTheme — switches the active theme classes and system-theme listener.
 * Operates between persisted theme choice, document body classes, and OS color-scheme changes.
 * Exists so explicit light/dark choices cannot be overwritten by stale system-mode listeners.
 *
 * @param {string} theme
 */
export function applyTheme(theme) {
    const body = document.body;
    detachSystemThemeListener();
    body.classList.remove('light-mode', 'dark-mode', 'system-mode');

    if (theme === 'light' || theme === 'locked-light' || theme === 'lockedLight') {
        body.classList.add('light-mode');
    } else if (theme === 'dark' || theme === 'locked-dark' || theme === 'lockedDark') {
        body.classList.add('dark-mode');
    } else if (theme === 'system') {
        const prefersDarkScheme = window.matchMedia("(prefers-color-scheme: dark)");
        body.classList.add('system-mode');
        applyResolvedThemeClass(body, prefersDarkScheme.matches);
        attachSystemThemeListener(body, prefersDarkScheme);
    }
}

/**
 * updateThemeButton — redraws the theme toggle icon and accessible label.
 * Operates between the current theme key and the navbar/login theme button.
 * Exists to keep icon state synchronized after initialization and user toggles.
 *
 * @param {string} theme
 * @param {HTMLElement|null} targetButton
 * @returns {Promise<void>}
 */
export async function updateThemeButton(theme, targetButton = null) {
    const themeToggleButtons = targetButton
        ? [targetButton]
        : Array.from(document.querySelectorAll('[data-theme-toggle], #themeToggleBtn'));

    themeToggleButtons.forEach((themeToggleButton) => {
        themeToggleButton.replaceChildren();
        themeToggleButton.setAttribute('aria-label', `Theme: ${theme}`);
        themeToggleButton.title = `Theme: ${theme}`;
        themeToggleButton.appendChild(
            createMaskIconSpan(themeIcons[theme] || themeIcons.system, ["theme-toggle-icon"])
        );
    });
}


/**
 * initializeTheme — reads the saved theme and applies the matching theme index.
 * Operates between localStorage, the supported theme list, and the theme applier.
 * Exists to make startup theme selection deterministic and reusable in tests.
 *
 * @param {string[]} themes
 * @param {(theme: string) => void} applyTheme
 * @returns {number}
 */
export function initializeTheme(themes, applyTheme) {
    let currentThemeIndex = 0;
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme && themes.includes(savedTheme)) {
        currentThemeIndex = themes.indexOf(savedTheme);
    } else {
        currentThemeIndex = 0;
    }
    const currentTheme = themes[currentThemeIndex];
    applyTheme(currentTheme);
    void updateThemeButton(currentTheme);
    return currentThemeIndex;
}

/**
 * applyResolvedThemeClass — applies the concrete light/dark body class.
 * Operates between a resolved dark-mode boolean and document body class state.
 * Exists so initial system mode and later media-query changes share one class update path.
 *
 * @param {HTMLElement} body
 * @param {boolean} isDarkMode
 */
function applyResolvedThemeClass(body, isDarkMode) {
    body.classList.toggle('dark-mode', isDarkMode);
    body.classList.toggle('light-mode', !isDarkMode);
}

/**
 * attachSystemThemeListener — tracks OS color-scheme changes while system mode is active.
 * Operates between matchMedia's change event and the document body theme classes.
 * Exists so system mode remains live without accumulating stale listeners.
 *
 * @param {HTMLElement} body
 * @param {MediaQueryList} mediaQuery
 */
function attachSystemThemeListener(body, mediaQuery) {
    systemThemeMediaQuery = mediaQuery;
    systemThemeChangeHandler = (event) => {
        if (!body.classList.contains('system-mode')) return;
        applyResolvedThemeClass(body, event.matches);
    };

    if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', systemThemeChangeHandler);
        return;
    }

    if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(systemThemeChangeHandler);
    }
}

/**
 * detachSystemThemeListener — removes the previous system-theme media listener if present.
 * Operates between repeated theme changes and browser MediaQueryList listener APIs.
 * Exists to prevent OS theme events from overriding an explicit light/dark selection later.
 */
function detachSystemThemeListener() {
    if (!systemThemeMediaQuery || !systemThemeChangeHandler) {
        systemThemeMediaQuery = null;
        systemThemeChangeHandler = null;
        return;
    }

    if (typeof systemThemeMediaQuery.removeEventListener === 'function') {
        systemThemeMediaQuery.removeEventListener('change', systemThemeChangeHandler);
    } else if (typeof systemThemeMediaQuery.removeListener === 'function') {
        systemThemeMediaQuery.removeListener(systemThemeChangeHandler);
    }

    systemThemeMediaQuery = null;
    systemThemeChangeHandler = null;
}
