// theme.js
// Manages application theme (light, dark, system) including persistence and icon updates.
// Bridges the themes array and themeIcons map with localStorage and DOM class toggling.
// Exists to centralise all theme-switching logic away from individual UI components.
import { createMaskIconSpan } from "../icons/icon_mask_builder.js";
import { getTranslationForKey } from "./lang/translation_handler.js";
import {
    fetchUserVisualPreference,
    saveUserVisualPreference,
} from "./theme_preference_api.js";

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
let themeSynchronizationRevision = 0;

const THEME_STORAGE_KEY = 'theme';
const AUTHENTICATED_BUTTON_STATE = 'logout';
const THEME_LABEL_KEYS = Object.freeze({
    system: 'theme_toggle_system',
    dark: 'theme_toggle_dark',
    light: 'theme_toggle_light',
    'locked-light': 'theme_toggle_locked_light',
    'locked-dark': 'theme_toggle_locked_dark',
    lockedLight: 'theme_toggle_locked_light',
    lockedDark: 'theme_toggle_locked_dark',
});

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

    themeToggleButton.addEventListener('click', async function(event) {
        event.stopPropagation();
        const previousTheme = themes[currentThemeIndex];
        currentThemeIndex = (currentThemeIndex + 1) % themes.length;
        const newTheme = themes[currentThemeIndex];
        applyTheme(newTheme);
        void updateThemeButton(newTheme);

        if (!isAuthenticatedThemeOwner()) {
            localStorage.setItem(THEME_STORAGE_KEY, newTheme);
            return;
        }

        setThemeButtonsBusy(true);
        try {
            const savedPreference = await saveUserVisualPreference(newTheme);
            const savedTheme = normalizeThemeChoice(savedPreference?.theme_mode);
            if (savedTheme) {
                setCurrentThemeChoice(savedTheme);
            }
        } catch (error) {
            console.warn('Account theme preference save failed', error);
            setCurrentThemeChoice(previousTheme);
        } finally {
            setThemeButtonsBusy(false);
        }
    });
}

/**
 * Synchronizes the active theme after the authentication state is known.
 * Logged-in users load the server-owned value; guests return to their device value.
 *
 * @param {boolean} authenticated
 * @returns {Promise<string>}
 */
export async function synchronizeThemePreferenceForAuthState(authenticated) {
    const synchronizationRevision = ++themeSynchronizationRevision;
    if (!authenticated) {
        const guestTheme = readGuestThemeChoice();
        setCurrentThemeChoice(guestTheme);
        return guestTheme;
    }

    try {
        const preference = await fetchUserVisualPreference();
        if (synchronizationRevision !== themeSynchronizationRevision) {
            return themes[currentThemeIndex] || defaultUserThemeChoice();
        }
        const accountTheme = normalizeThemeChoice(preference?.theme_mode) || defaultUserThemeChoice();
        setCurrentThemeChoice(accountTheme);
        return accountTheme;
    } catch (error) {
        console.warn('Account theme preference load failed', error);
        return themes[currentThemeIndex] || defaultUserThemeChoice();
    }
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
        const labelKey = THEME_LABEL_KEYS[theme] || THEME_LABEL_KEYS.system;
        const fallbackLabel = `Theme: ${theme}`;
        const translatedLabel = getTranslationForKey(labelKey, {
            fallback: fallbackLabel,
            countUsage: false,
        });
        themeToggleButton.replaceChildren();
        themeToggleButton.dataset.ariaLabelLangKey = labelKey;
        themeToggleButton.dataset.titleLangKey = labelKey;
        themeToggleButton.setAttribute('aria-label', translatedLabel);
        themeToggleButton.title = translatedLabel;
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
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
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

function isAuthenticatedThemeOwner() {
    return localStorage.getItem('button_state') === AUTHENTICATED_BUTTON_STATE;
}

function normalizeThemeChoice(theme) {
    return themes.includes(theme) ? theme : '';
}

function defaultUserThemeChoice() {
    return themes[0];
}

function readGuestThemeChoice() {
    return normalizeThemeChoice(localStorage.getItem(THEME_STORAGE_KEY)) || defaultUserThemeChoice();
}

function setCurrentThemeChoice(theme) {
    const normalizedTheme = normalizeThemeChoice(theme) || defaultUserThemeChoice();
    currentThemeIndex = themes.indexOf(normalizedTheme);
    applyTheme(normalizedTheme);
    void updateThemeButton(normalizedTheme);
}

function setThemeButtonsBusy(busy) {
    document.querySelectorAll('[data-theme-toggle], #themeToggleBtn').forEach((button) => {
        if (button instanceof HTMLButtonElement) {
            button.disabled = busy;
        }
    });
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
