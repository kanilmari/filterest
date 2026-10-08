// home_palette_state.js
// Owns one Home visit's saved layout, preview and independent server revision.
// Adapts the Home GET snapshot and admin POST to the shared palette draft owner.
// Keeps previews out of storage and rejects failed or malformed save responses.
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { isValidHomePresentation, DEFAULT_HOME_PRESENTATION } from '../../shared/front_page_presentation/validator.js';
import { clonePaletteValue } from './presentation_palette_shell.js';

export function saveHomePresentation(payload) {
    return endpoint_router('adminFrontPage', { method: 'POST', body_data: payload, suppressErrorToast: true });
}

/** Each visit uses the revision from its content response, never a second layout GET. */
export function createHomePaletteState({ presentation = null, presentation_version = 'none' } = {}) {
    if (presentation !== null && !isValidHomePresentation(presentation)) throw new Error('Invalid Home layout');
    let saved = clonePaletteValue(presentation);
    let version = presentation_version;
    let preview = null;
    const savedSettings = () => clonePaletteValue(saved);
    const effectiveSettings = () => clonePaletteValue(preview ? preview.settings : saved);
    function setPreview(owner, value) {
        if (!isValidHomePresentation(value)) return false;
        preview = { owner, settings: clonePaletteValue(value) };
        return true;
    }
    function releasePreview(owner) {
        if (preview?.owner !== owner) return false;
        preview = null;
        return true;
    }
    async function saveSettings(value, request = saveHomePresentation) {
        const layout = clonePaletteValue(value || DEFAULT_HOME_PRESENTATION);
        if (!isValidHomePresentation(layout)) throw new Error('Invalid Home layout');
        const result = await request({ presentation: layout, version });
        if (typeof result?.version !== 'string' || !result.version || result.version === 'none') throw new Error('Invalid Home save revision');
        saved = layout;
        version = result.version;
        return savedSettings();
    }
    return { savedSettings, effectiveSettings, setPreview, releasePreview, saveSettings };
}
