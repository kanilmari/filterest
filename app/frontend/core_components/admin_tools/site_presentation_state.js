// site_presentation_state.js
// Shared public presentation snapshot, browser cache and transient palette previews.
// The cache contains only public site settings; authorization flags are never retained.
// One request and one saved revision serve cover, card and timestamp consumers.

import { fetchSitePresentationSettings } from '../endpoints/stable_endpoint_router.js';
import { CARD_IMAGE_PRESENTATIONS, normalizeCardImagePresentation, applyCardImagePresentationSetting }
    from '../table_views/card_view/card_image_presentation.js';
import { applyCardFieldPresentationSetting } from '../table_views/card_view/card_field_presentation.js';
import { CARD_STYLE_VARIANT_VALUES, DEFAULT_CARD_DETAIL_COLUMNS } from '../table_views/card_view/card_detail_layout_options.js';

export const PUBLIC_PRESENTATION_CACHE_KEY = 'filterest_public_presentation_v1';
const clone = (value) => JSON.parse(JSON.stringify(value));

export const DEFAULT_DATASET_COVER_THEME = Object.freeze({
    light: Object.freeze({
        oval_enabled: true,
        oval_width: 32,
        oval_height: 67,
        oval_position_y: 56,
        center_opacity: 0.4,
        mid_opacity: 0.7,
        edge_opacity: 1,
        center_stop: 39,
        mid_stop: 55,
        edge_stop: 80,
        image_opacity: 1,
        overlay_opacity: 0,
        image_blur: 1,
    }),
    dark: Object.freeze({
        oval_enabled: false,
        oval_width: 32,
        oval_height: 67,
        oval_position_y: 56,
        center_opacity: 0.4,
        mid_opacity: 0.7,
        edge_opacity: 1,
        center_stop: 39,
        mid_stop: 55,
        edge_stop: 80,
        image_opacity: 0.3,
        overlay_opacity: 0,
        image_blur: 1,
    }),
    shared: Object.freeze({
        hero_extra_height: 40,
        hero_bottom_fade: 48,
        image_blur: 1,
        card_image_width: 300,
        card_image_presentation: 'contain',
        card_show_all_fields: true,
        card_style_variant: CARD_STYLE_VARIANT_VALUES.MODERN,
        card_description_lines: 2,
        card_detail_columns: DEFAULT_CARD_DETAIL_COLUMNS,
        active_tab_fade: 25,
        active_tab_max_opacity: 1,
        active_tab_glow_intensity: 0.3,
        active_tab_glow_width: 1.5,
        active_tab_glow_blur: 2,
        brand_color: '#1a8fe6',
    }),
});


export function isValidThemeConfig(config) {
    if (!config?.shared) return false;
    for (const name of ['light', 'dark']) {
        if (typeof config[name]?.oval_enabled !== 'boolean') return false;
        for (const key of Object.keys(DEFAULT_DATASET_COVER_THEME[name])) {
            if (key !== 'oval_enabled' && !Number.isFinite(config[name][key])) return false;
        }
    }
    for (const key of Object.keys(DEFAULT_DATASET_COVER_THEME.shared)) {
        if (['brand_color', 'card_image_presentation', 'card_show_all_fields', 'card_style_variant', 'card_detail_columns', 'image_blur'].includes(key)) continue;
        if (!Number.isFinite(config.shared[key])) return false;
    }
    return (config.shared.card_detail_columns === undefined
        || (Number.isInteger(config.shared.card_detail_columns)
            && config.shared.card_detail_columns >= 1 && config.shared.card_detail_columns <= 4))
        && (config.shared.card_show_all_fields === undefined || typeof config.shared.card_show_all_fields === 'boolean')
        && (config.shared.card_style_variant === undefined
        || Object.values(CARD_STYLE_VARIANT_VALUES).includes(config.shared.card_style_variant))
        && (config.shared.card_image_presentation === undefined
        || CARD_IMAGE_PRESENTATIONS.includes(config.shared.card_image_presentation))
        && /^#[0-9a-f]{6}$/i.test(config.shared.brand_color || '');
}

export function normalizePresentationSettings(payload) {
    const source = isValidThemeConfig(payload?.dataset_cover_theme)
        ? payload.dataset_cover_theme : DEFAULT_DATASET_COVER_THEME;
    // Cache only the public protocol's known fields, never arbitrary response extras.
    const theme = Object.fromEntries(Object.entries(DEFAULT_DATASET_COVER_THEME).map(([group, defaults]) => [
        group, Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [
            key, source[group][key] === undefined ? fallback : source[group][key],
        ])),
    ]));
    theme.shared.card_image_presentation = normalizeCardImagePresentation(theme.shared.card_image_presentation);
    return {
        dataset_cover_theme: theme,
        row_article_timestamp_display_mode: ['date_time', 'date_only'].includes(payload?.row_article_timestamp_display_mode)
            ? payload.row_article_timestamp_display_mode : 'date_time',
    };
}

export function brandColorComponents(hexColor) {
    const channels = String(hexColor).slice(1).match(/.{2}/g)?.map((part) => (
        Number.parseInt(part, 16) / 255
    ));
    if (!channels || channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) {
        return false;
    }
    const [red, green, blue] = channels;
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const delta = maximum - minimum;
    const lightness = (maximum + minimum) / 2;
    let hue = 0;
    if (delta > 0) {
        if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
        else if (maximum === green) hue = 60 * (((blue - red) / delta) + 2);
        else hue = 60 * (((red - green) / delta) + 4);
    }
    if (hue < 0) hue += 360;
    const saturation = delta === 0
        ? 0
        : delta / (1 - Math.abs((2 * lightness) - 1));
    return {
        hue: Number(hue.toFixed(2)),
        saturation: Number((saturation * 100).toFixed(2)),
        lightness: Number((lightness * 100).toFixed(2)),
    };
}

export function applySitePresentationGlobals(config, { preserveKnownBrand = false } = {}) {
    if (typeof document === 'undefined' || !document.documentElement || !isValidThemeConfig(config)) return;
    const documentRoot = document.documentElement;
    applyCardImagePresentationSetting(config.shared.card_image_presentation);
    applyCardFieldPresentationSetting(
        config.shared.card_show_all_fields, config.shared.card_style_variant, config.shared.card_detail_columns
    );
    documentRoot.style.setProperty(
        '--dataset-background-light-image-blur',
        `${config.light.image_blur}px`
    );
    documentRoot.style.setProperty(
        '--dataset-background-dark-image-blur',
        `${config.dark.image_blur}px`
    );
    documentRoot.style.setProperty('--card_image_large_width', `${config.shared.card_image_width}px`);
    documentRoot.style.setProperty(
        '--card-description-lines',
        String(config.shared.card_description_lines)
    );
    documentRoot.style.setProperty('--navtab-active-fade-width', `${config.shared.active_tab_fade}px`);
    documentRoot.style.setProperty(
        '--navtab-active-max-opacity',
        String(config.shared.active_tab_max_opacity)
    );
    documentRoot.style.setProperty(
        '--navtab-active-glow-intensity',
        String(config.shared.active_tab_glow_intensity)
    );
    documentRoot.style.setProperty(
        '--navtab-active-glow-width',
        `${config.shared.active_tab_glow_width}px`
    );
    documentRoot.style.setProperty(
        '--navtab-active-glow-blur',
        `${config.shared.active_tab_glow_blur}px`
    );
    if (!preserveKnownBrand || !documentRoot.style.getPropertyValue('--brand-hue')) {
        const brand = brandColorComponents(config.shared.brand_color);
        documentRoot.style.setProperty('--brand-hue', String(brand.hue));
        documentRoot.style.setProperty('--brand-sat', `${brand.saturation}%`);
        documentRoot.style.setProperty('--brand-light', `${brand.lightness}%`);
    }
    window.dispatchEvent(new Event('dataset-cover-presentation-changed'));
}

function browserStorage() {
    try { return globalThis.localStorage; } catch { return null; }
}

/** Public snapshots are durable; previews have one owner and never enter storage. */
export function createSitePresentationState({ requestFn = fetchSitePresentationSettings, storage = browserStorage() } = {}) {
    let saved = null;
    let revision = 0;
    let loaded = false;
    let inFlight = null;
    let preview = null;
    let saveQueue = Promise.resolve();
    try {
        const cached = JSON.parse(storage?.getItem(PUBLIC_PRESENTATION_CACHE_KEY) || 'null');
        if (cached?.schema_version === 1 && isValidThemeConfig(cached.settings?.dataset_cover_theme)) {
            saved = normalizePresentationSettings(cached.settings);
        }
    } catch { /* A blocked or corrupt cache must never block page startup. */ }

    const savedSettings = () => clone(saved || normalizePresentationSettings(null));
    const effectiveSettings = () => clone(preview?.settings || saved || normalizePresentationSettings(null));
    function paint() {
        applySitePresentationGlobals(effectiveSettings().dataset_cover_theme, { preserveKnownBrand: !saved && !preview });
    }
    function accept(payload) {
        if (!isValidThemeConfig(payload?.dataset_cover_theme)) throw new Error('Invalid public presentation settings');
        saved = normalizePresentationSettings(payload);
        loaded = true;
        revision += 1;
        try {
            storage?.setItem(PUBLIC_PRESENTATION_CACHE_KEY, JSON.stringify({
                schema_version: 1,
                settings: saved,
                brand: brandColorComponents(saved.dataset_cover_theme.shared.brand_color),
            }));
        } catch { /* Private browsing or exhausted storage still allows live settings. */ }
        applyCardFieldPresentationSetting(
            effectiveSettings().dataset_cover_theme.shared.card_show_all_fields,
            effectiveSettings().dataset_cover_theme.shared.card_style_variant,
            effectiveSettings().dataset_cover_theme.shared.card_detail_columns,
        );
        return savedSettings();
    }
    async function loadSettings() {
        if (loaded) return savedSettings();
        if (inFlight) return inFlight;
        const requestedRevision = revision;
        inFlight = Promise.resolve().then(requestFn).then((payload) => {
            if (revision === requestedRevision) accept(payload);
            return savedSettings();
        }).catch(() => savedSettings()).finally(() => { inFlight = null; });
        return inFlight;
    }
    function setPreview(owner, settings) {
        if (!isValidThemeConfig(settings?.dataset_cover_theme)) return false;
        preview = { owner, settings: normalizePresentationSettings(settings) };
        paint();
        return true;
    }
    function releasePreview(owner) {
        if (preview?.owner !== owner) return false;
        preview = null;
        paint();
        return true;
    }
    function saveSettings(settings, saveRequestFn) {
        const payload = normalizePresentationSettings(settings);
        // Invalidate an older GET immediately. Serial POSTs preserve user intent
        // even if two still-mounted palette controls attempt to save together.
        revision += 1;
        const pending = saveQueue.then(async () => {
            const response = await saveRequestFn(clone(payload));
            const result = accept(response);
            paint();
            return result;
        });
        saveQueue = pending.catch(() => {});
        return pending;
    }
    applyCardFieldPresentationSetting(
            effectiveSettings().dataset_cover_theme.shared.card_show_all_fields,
            effectiveSettings().dataset_cover_theme.shared.card_style_variant,
            effectiveSettings().dataset_cover_theme.shared.card_detail_columns,
        );
    return { loadSettings, savedSettings, effectiveSettings, paint, setPreview, releasePreview, saveSettings };
}

let states = new WeakMap();
export function getSitePresentationState(requestFn = fetchSitePresentationSettings) {
    if (!states.has(requestFn)) states.set(requestFn, createSitePresentationState({ requestFn }));
    return states.get(requestFn);
}
export function resetSitePresentationStatesForTests() {
    states = new WeakMap();
}
