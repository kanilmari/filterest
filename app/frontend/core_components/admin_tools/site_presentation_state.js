// site_presentation_state.js
// Shared public presentation snapshot, browser cache and transient palette previews.
// The cache contains only public site settings; authorization flags are never retained.
// One request and one saved revision serve cover, card and timestamp consumers.

import { fetchSitePresentationSettings } from '../endpoints/stable_endpoint_router.js';
import { normalizeCardImagePresentation, applyCardImagePresentationSetting }
    from '../table_views/card_view/card_image_presentation.js';
import { applyCardFieldPresentationSetting } from '../table_views/card_view/card_field_presentation.js';

import { normalizeLabelValueLayout, applySiteLabelValueLayoutSetting }
    from '../../reusable_components/key_value_container/label_value_layout.js';

import { applyActiveFilterRemoveSide }
    from '../filterbar/filter_list/active_filter_chip_builder.js';

import { DEFAULT_DATASET_APPEARANCE, datasetAppearanceField, isReadableDatasetAppearance }
    from '../../shared/dataset_appearance/validator.js';
export const DEFAULT_DATASET_COVER_THEME = DEFAULT_DATASET_APPEARANCE;

export const PUBLIC_PRESENTATION_CACHE_KEY = 'filterest_public_presentation_v1';
const clone = (value) => JSON.parse(JSON.stringify(value));

/** Empty space above the hero header icon, in pixels. One definition serves the
 *  saved default, the palette slider's range and the guard that keeps a stale or
 *  hand-edited value from writing an unusable margin into the stylesheet. */
const topSpaceRule = datasetAppearanceField('shared.filterbar_content_top_space');
export const FILTERBAR_CONTENT_TOP_SPACE = Object.freeze({
    default: topSpaceRule.default, minimum: topSpaceRule.min, maximum: topSpaceRule.max, step: topSpaceRule.step,
});

export function clampFilterbarContentTopSpace(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return FILTERBAR_CONTENT_TOP_SPACE.default;
    return Math.min(
        Math.max(numericValue, FILTERBAR_CONTENT_TOP_SPACE.minimum),
        FILTERBAR_CONTENT_TOP_SPACE.maximum
    );
}

/** Retains the public snapshot/read contract; strict writes use the shared validator. */
export function isValidThemeConfig(config) {
    return isReadableDatasetAppearance(config);
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
    theme.shared.label_value_layout = normalizeLabelValueLayout(theme.shared.label_value_layout);
    theme.shared.card_image_presentation = normalizeCardImagePresentation(theme.shared.card_image_presentation);
    return {
        version: typeof payload?.version === "string" ? payload.version : "",
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

function applyArticleImageCaptionSetting(config) {
    if (typeof document === 'undefined' || !document.documentElement) return;
    document.documentElement.dataset.articleImageCaptionPosition =
        config.shared.article_image_caption_position ?? 'below';
}

export function applySitePresentationGlobals(config, { preserveKnownBrand = false } = {}) {
    if (typeof document === 'undefined' || !document.documentElement || !isValidThemeConfig(config)) return;
    const documentRoot = document.documentElement;
    applyActiveFilterRemoveSide(config.shared.active_filter_remove_side);
    applyArticleImageCaptionSetting(config);
    applySiteLabelValueLayoutSetting(config.shared.label_value_layout);
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
    documentRoot.style.setProperty(
        '--filterbar-content-top-space',
        `${clampFilterbarContentTopSpace(config.shared.filterbar_content_top_space)}px`
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
        applyActiveFilterRemoveSide(effectiveSettings().dataset_cover_theme.shared.active_filter_remove_side);
        applyArticleImageCaptionSetting(effectiveSettings().dataset_cover_theme);
        applySiteLabelValueLayoutSetting(effectiveSettings().dataset_cover_theme.shared.label_value_layout);
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
    applyActiveFilterRemoveSide(effectiveSettings().dataset_cover_theme.shared.active_filter_remove_side);
    applyArticleImageCaptionSetting(effectiveSettings().dataset_cover_theme);
    applySiteLabelValueLayoutSetting(effectiveSettings().dataset_cover_theme.shared.label_value_layout);
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
