// site_presentation_state.js
// Shared public presentation snapshot, browser cache and transient palette previews.
// The cache contains only public site settings; authorization flags are never retained.
// One public request and revision serve site defaults, globals and timestamps.

import { fetchSitePresentationSettings } from '../endpoints/stable_endpoint_router.js';
import { normalizeCardImagePresentation } from '../table_views/card_view/card_image_presentation.js';
import { normalizeLabelValueLayout } from '../../reusable_components/key_value_container/label_value_layout.js';
import { datasetAppearanceState } from '../table_views/dataset_appearance_state.js';
import { applyActiveFilterRemoveSide }
    from '../filterbar/filter_list/active_filter_chip_builder.js';

import { DEFAULT_DATASET_APPEARANCE, datasetAppearanceField, isReadableDatasetAppearance }
    from '../../shared/dataset_appearance/validator.js';
import { readSiteAppearance, appearanceValuesForPlace } from '../../shared/dataset_appearance/snapshot.js';
export const DEFAULT_DATASET_COVER_THEME = DEFAULT_DATASET_APPEARANCE;

export const PUBLIC_PRESENTATION_CACHE_KEY = 'filterest_public_presentation_v2';
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
    // Site drafts retain the nested control projection; saves serialize a strict
    // patch of the two public owned maps, excluding every tab cover value.
    const source = isValidThemeConfig(payload?.dataset_cover_theme) ? payload.dataset_cover_theme
        : readSiteAppearance(payload) || DEFAULT_DATASET_COVER_THEME;
    // Cache only the public protocol's known fields, never arbitrary response extras.
    const theme = Object.fromEntries(Object.entries(DEFAULT_DATASET_COVER_THEME).map(([group, defaults]) => [
        group, Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [
            key, source[group][key] === undefined ? fallback : source[group][key],
        ])),
    ]));
    theme.shared.label_value_layout = normalizeLabelValueLayout(theme.shared.label_value_layout);
    theme.shared.card_image_presentation = normalizeCardImagePresentation(theme.shared.card_image_presentation);
    return {
        schema_version: 2,
        site_values: appearanceValuesForPlace(theme, 'site_only'),
        defaults: appearanceValuesForPlace(theme, 'site_default'),
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

export function applySitePresentationGlobals(config, { preserveKnownBrand = false, version = '', preview = false, changed = false } = {}) {
    if (typeof document === 'undefined' || !document.documentElement || !isValidThemeConfig(config)) return;
    const documentRoot = document.documentElement;
    applyActiveFilterRemoveSide(config.shared.active_filter_remove_side);
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
    datasetAppearanceState.updateSite(config, { version, preview, changed });
    window.dispatchEvent(new Event('dataset-cover-presentation-changed'));
}

// Cache only the public 7/9 contract; the nested renderer projection stays in memory.
function publicSettings(settings) {
    const { schema_version, version, site_values, defaults, row_article_timestamp_display_mode } = settings;
    return { schema_version, version, site_values, defaults, row_article_timestamp_display_mode };
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
        if (cached?.schema_version === 2 && readSiteAppearance(cached.settings)) {
            saved = normalizePresentationSettings(cached.settings);
        }
    } catch { /* A blocked or corrupt cache must never block page startup. */ }

    const savedSettings = () => clone(saved || normalizePresentationSettings(null));
    const effectiveSettings = () => clone(preview?.settings || saved || normalizePresentationSettings(null));
    function paint() {
        applySitePresentationGlobals(effectiveSettings().dataset_cover_theme, {
            preserveKnownBrand: !saved && !preview, version: saved?.version || '', preview: Boolean(preview),
        });
    }
    function accept(payload, { siteChanged = false } = {}) {
        if (!readSiteAppearance(payload)) throw new Error('Invalid public presentation settings');
        saved = normalizePresentationSettings(payload);
        loaded = true;
        revision += 1;
        try {
            storage?.setItem(PUBLIC_PRESENTATION_CACHE_KEY, JSON.stringify({
                schema_version: 2,
                settings: publicSettings(saved),
                brand: brandColorComponents(saved.dataset_cover_theme.shared.brand_color),
            }));
        } catch { /* Private browsing or exhausted storage still allows live settings. */ }
        applyActiveFilterRemoveSide(effectiveSettings().dataset_cover_theme.shared.active_filter_remove_side);
        datasetAppearanceState.updateSite(effectiveSettings().dataset_cover_theme, {
            version: saved.version, preview: Boolean(preview), changed: siteChanged,
        });
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
        const normalized = normalizePresentationSettings(settings);
        const baseline = savedSettings();
        const values = { ...normalized.defaults, ...normalized.site_values };
        const previous = { ...baseline.defaults, ...baseline.site_values };
        const payload = { schema_version: 2, version: normalized.version,
            set: Object.fromEntries(Object.entries(values).filter(([path, value]) => value !== previous[path])) };
        if (normalized.row_article_timestamp_display_mode !== baseline.row_article_timestamp_display_mode) {
            payload.row_article_timestamp_display_mode = normalized.row_article_timestamp_display_mode;
        }
        // Invalidate an older GET immediately. Serial POSTs preserve user intent
        // even if two still-mounted palette controls attempt to save together.
        revision += 1;
        const pending = saveQueue.then(async () => {
            const response = await saveRequestFn(clone(payload));
            if (!readSiteAppearance(response)
                || Object.entries(payload.set).some(([path, value]) => (
                    response.site_values?.[path] ?? response.defaults?.[path]) !== value)
                || (payload.row_article_timestamp_display_mode !== undefined
                    && response.row_article_timestamp_display_mode !== payload.row_article_timestamp_display_mode)) {
                throw new Error('Site appearance save readback mismatch');
            }
            const result = accept(response, { siteChanged: true });
            paint();
            return result;
        });
        saveQueue = pending.catch(() => {});
        return pending;
    }
    applyActiveFilterRemoveSide(effectiveSettings().dataset_cover_theme.shared.active_filter_remove_side);
    datasetAppearanceState.updateSite(effectiveSettings().dataset_cover_theme, { version: saved?.version || '', changed: false });
    return { loadSettings, savedSettings, effectiveSettings, paint, setPreview, releasePreview, saveSettings };
}

let states = new WeakMap();
export function getSitePresentationState(requestFn = fetchSitePresentationSettings) {
    if (!states.has(requestFn)) states.set(requestFn, createSitePresentationState({ requestFn }));
    return states.get(requestFn);
}
export function resetSitePresentationStatesForTests() {
    states = new WeakMap();
    datasetAppearanceState.clear();
}
