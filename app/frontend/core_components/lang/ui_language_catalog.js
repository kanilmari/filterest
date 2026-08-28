// ui_language_catalog.js
// Defines the languages offered by shared interface-language selectors.
// Bridges reusable selectors with surface-specific language availability.
// Exists so forms and application chrome do not copy language lists or labels.

const FALLBACK_UI_LANGUAGE_CATALOG = Object.freeze([
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

const CANONICAL_SHORT_LABELS = Object.freeze({
    en: "EN",
    fi: "FI",
    "zh-CN": "简",
    "zh-TW": "繁",
    "zh-HK": "港",
});

let activeUiLanguageCatalog = FALLBACK_UI_LANGUAGE_CATALOG;
let publicCatalogLoadPromise = null;

function buildPublicLanguageOption(language) {
    const value = String(language?.language_code || "").trim();
    const nativeName = String(language?.native_name || "").trim();
    const englishName = String(language?.english_name || "").trim();
    if (!value || !nativeName || !englishName) return null;

    return Object.freeze({
        id: `lang-${value.toLowerCase()}`,
        value,
        shortLabel: CANONICAL_SHORT_LABELS[value] || value.toUpperCase(),
        label: `${nativeName} (${englishName})`,
        title: `Show menus in ${englishName}`,
        surfaces: Object.freeze(["application", "auth"]),
        isDefault: Boolean(language.is_default),
        sortOrder: Number(language.sort_order) || 100,
    });
}

/**
 * Loads the administrator-approved public language catalogue once.
 * Direct fetch is intentional: this public configuration is needed before the
 * authenticated API pipeline and shared language controls have initialized.
 *
 * @param {{fetchImpl?: typeof fetch}} options
 * @returns {Promise<Array<object>>}
 */
export async function loadPublicUiLanguageCatalog({ fetchImpl = globalThis.fetch } = {}) {
    if (publicCatalogLoadPromise) return publicCatalogLoadPromise;

    publicCatalogLoadPromise = (async () => {
        if (typeof fetchImpl !== "function") return activeUiLanguageCatalog;
        try {
            const response = await fetchImpl("/api/ui-languages", {
                credentials: "same-origin",
                headers: { Accept: "application/json" },
            });
            if (!response?.ok) return activeUiLanguageCatalog;

            const payload = await response.json();
            const publicLanguages = Array.isArray(payload?.languages) ? payload.languages : [];
            const options = publicLanguages
                .filter((language) => language?.is_enabled && language?.public_selector_ready)
                .map(buildPublicLanguageOption)
                .filter(Boolean)
                .sort((left, right) => left.sortOrder - right.sortOrder || left.value.localeCompare(right.value));

            if (options.length > 0 && options.some((language) => language.isDefault)) {
                activeUiLanguageCatalog = Object.freeze(options);
            }
        } catch (error) {
            console.warn("UI language catalogue load failed; using bundled fallback.", error);
        }
        return activeUiLanguageCatalog;
    })();

    return publicCatalogLoadPromise;
}

/**
 * Returns immutable language definitions enabled for one interface surface.
 *
 * @param {"application"|"auth"} surface
 * @returns {Array<{id: string, value: string, shortLabel: string, label: string, title: string}>}
 */
export function getUiLanguageOptions(surface = "application") {
    return activeUiLanguageCatalog.filter((language) => language.surfaces.includes(surface));
}

export { FALLBACK_UI_LANGUAGE_CATALOG as UI_LANGUAGE_CATALOG };
