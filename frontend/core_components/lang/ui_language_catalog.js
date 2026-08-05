// ui_language_catalog.js
// Defines the languages offered by shared interface-language selectors.
// Bridges reusable selectors with surface-specific language availability.
// Exists so forms and application chrome do not copy language lists or labels.

const UI_LANGUAGE_CATALOG = Object.freeze([
    Object.freeze({
        id: "lang-en",
        value: "en",
        shortLabel: "EN",
        label: "English (US)",
        title: "Show menus in English",
        surfaces: Object.freeze(["application", "auth"]),
    }),
    Object.freeze({
        id: "lang-fi",
        value: "fi",
        shortLabel: "FI",
        label: "Finnish (Suomi)",
        title: "Näytä valikot suomeksi",
        surfaces: Object.freeze(["application", "auth"]),
    }),
    Object.freeze({
        id: "lang-yue",
        value: "yue",
        shortLabel: "粵",
        label: "Cantonese (廣東話)",
        title: "以廣東話顯示選單",
        surfaces: Object.freeze(["application", "auth"]),
    }),
    Object.freeze({
        id: "lang-ch",
        value: "ch",
        shortLabel: "中",
        label: "Chinese (中文)",
        title: "以中文显示菜单",
        surfaces: Object.freeze(["auth"]),
    }),
]);

/**
 * Returns immutable language definitions enabled for one interface surface.
 *
 * @param {"application"|"auth"} surface
 * @returns {Array<{id: string, value: string, shortLabel: string, label: string, title: string}>}
 */
export function getUiLanguageOptions(surface = "application") {
    return UI_LANGUAGE_CATALOG.filter((language) => language.surfaces.includes(surface));
}

export { UI_LANGUAGE_CATALOG };
