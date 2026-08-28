// symbol_asset_resolver.js
// Resolves metadata icon keys into safe public symbol-asset URLs and mask elements.
// Bridges database dataset/field keys with the backend-validated filesystem SVG library.
// Exists so renderers share one path without accepting raw SVG, HTML, or arbitrary URLs.

const SYMBOL_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const DEFAULT_SYMBOL_KEY = "table";

export function isSafeSymbolKey(iconKey) {
    return SYMBOL_KEY_PATTERN.test(String(iconKey || "").trim().toLowerCase());
}

export function normalizeSymbolKey(iconKey, fallbackKey = DEFAULT_SYMBOL_KEY) {
    const normalized = String(iconKey || "").trim().toLowerCase();
    if (isSafeSymbolKey(normalized)) {
        return normalized;
    }
    const normalizedFallback = String(fallbackKey || DEFAULT_SYMBOL_KEY).trim().toLowerCase();
    return isSafeSymbolKey(normalizedFallback) ? normalizedFallback : DEFAULT_SYMBOL_KEY;
}

export function getSymbolAssetUrl(iconKey, fallbackKey = DEFAULT_SYMBOL_KEY) {
    return `/symbol-assets/${encodeURIComponent(normalizeSymbolKey(iconKey, fallbackKey))}.svg`;
}

/**
 * Applies one filesystem-backed SVG as a current-color CSS mask.
 * The asset endpoint returns the table fallback when old metadata names a missing file.
 */
export function applySymbolMask(element, iconKey, fallbackKey = DEFAULT_SYMBOL_KEY) {
    if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
        return null;
    }
    const resolvedKey = normalizeSymbolKey(iconKey, fallbackKey);
    const assetUrl = getSymbolAssetUrl(resolvedKey, fallbackKey);
    element.classList.add("metadata-symbol-icon");
    element.dataset.symbolKey = resolvedKey;
    element.style.setProperty("--metadata-symbol-url", `url("${assetUrl}")`);
    return element;
}

export function createSymbolMaskElement(iconKey, classNames = [], fallbackKey = DEFAULT_SYMBOL_KEY) {
    const icon = document.createElement("span");
    const normalizedClassNames = Array.isArray(classNames) ? classNames : [classNames];
    normalizedClassNames.filter(Boolean).forEach((className) => icon.classList.add(className));
    icon.setAttribute("aria-hidden", "true");
    return applySymbolMask(icon, iconKey, fallbackKey);
}
