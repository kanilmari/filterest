// front_page_background_control.js
// Stages the site's Home background, focal point and removal before saving.
// Connects local files and the shared web-image picker to the protected upload API.
// Keeps file validation, preview URLs and background errors inside one control.

import { endpoint_router } from '../endpoints/endpoint_router.js';
import { getTranslationForKey } from '../lang/translation_handler.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import { openImageSourcePicker } from '../../reusable_components/image_source_picker/image_source_picker.js';
import {
    frontPageButton, frontPageField, frontPageLabel, frontPageSection, frontPageStatus,
} from './front_page_settings_controls.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_FILE_BYTES = 50 * 1024 * 1024;
const MEDIA_EXTENSIONS = { 'image/png': /\.png$/i, 'image/jpeg': /\.jpe?g$/i, 'image/webp': /\.webp$/i,
    'video/mp4': /\.mp4$/i, 'video/webm': /\.webm$/i };

/** Builds a draft control; save() writes only this section, never a scope list. */
export function createFrontPageBackgroundControl({ onChange, report, isEnabled }) {
    const element = frontPageSection('front_page_background');
    const errorMessage = frontPageStatus('background-error');
    const help = frontPageLabel(document.createElement('p'), 'front_page_background_help');
    const fileInput = Object.assign(document.createElement('input'), {
        type: 'file', accept: '.png,.jpg,.jpeg,.webp,.mp4,.webm,image/png,image/jpeg,image/webp,video/mp4,video/webm',
    });
    const webButton = frontPageButton('pick_image_from_web', 'background-web');
    const preview = document.createElement('img');
    preview.className = 'front-page-settings-background-preview';
    preview.alt = ''; // Decorative crop preview; the original name is printed separately.
    const videoPreview = document.createElement('video');
    videoPreview.className = 'front-page-settings-background-preview';
    videoPreview.muted = true;
    videoPreview.controls = true;
    videoPreview.playsInline = true;
    videoPreview.preload = 'metadata';
    const filename = document.createElement('p');
    filename.className = 'front-page-settings-filename';
    const focalFields = document.createElement('div');
    focalFields.className = 'front-page-settings-focal-fields';
    const focalX = Object.assign(document.createElement('input'), { type: 'number', min: '0', max: '100', step: 'any' });
    const focalY = focalX.cloneNode();
    focalFields.append(
        frontPageField('front_page_focal_x', focalX, 'focal-x'),
        frontPageField('front_page_focal_y', focalY, 'focal-y'),
    );
    const removeButton = frontPageButton('front_page_remove_background', 'background-remove');
    const saveButton = frontPageButton('save', 'background-save', true);
    const status = frontPageStatus('background-status');
    element.append(help, errorMessage, frontPageField('front_page_upload_background', fileInput, 'background-file'),
        webButton, filename, preview, videoPreview, focalFields, removeButton, saveButton, status);

    let stored = null;
    let backgroundError = false;
    let selectedFile = null;
    let previewUrl = '';
    let removing = false;
    let disposed = false;
    let picker = null;
    let storedFocalX = '50';
    let storedFocalY = '50';

    function revokePreview() {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = '';
    }

    function dirty() {
        return removing || Boolean(selectedFile) || Boolean(stored && (
            focalX.value !== storedFocalX || focalY.value !== storedFocalY
        ));
    }

    function update() {
        const hasImage = !removing && Boolean(selectedFile || stored);
        focalX.disabled = focalY.disabled = !hasImage;
        removeButton.disabled = removing || !(selectedFile || stored || backgroundError);
        saveButton.disabled = !dirty();
        const match = stored?.storage_key?.match(/^site_media\/front_page\/original\/([^/]+)$/);
        const isVideo = (selectedFile?.type || stored?.mime_type || '').startsWith('video/');
        const source = previewUrl || (isEnabled() && match
            ? `/storage/site_media/front_page/${isVideo ? 'original' : '1000'}/${encodeURIComponent(match[1])}` : '');
        for (const media of [preview, videoPreview]) {
            media.hidden = !hasImage || !source || (media === videoPreview) !== isVideo;
            if (media.hidden) {
                const wasVideo = media === videoPreview && media.hasAttribute('src');
                if (wasVideo) media.pause();
                media.removeAttribute('src');
                if (wasVideo) media.load();
            }
            else if (media.getAttribute('src') !== source) media.src = source;
            media.style.objectPosition = `${focalX.value}% ${focalY.value}%`;
        }
        filename.textContent = removing ? '' : selectedFile?.name || stored?.original_name || '';
        errorMessage.hidden = !backgroundError;
        if (backgroundError) frontPageLabel(errorMessage, 'front_page_background_error');
        else { errorMessage.textContent = ''; delete errorMessage.dataset.langKey; }
        if (dirty()) frontPageLabel(status, 'unsaved_changes');
        else { status.textContent = ''; delete status.dataset.langKey; }
        onChange();
    }

    function setSnapshot(background, error = '') {
        stored = background || null;
        backgroundError = Boolean(error);
        selectedFile = null;
        removing = false;
        revokePreview();
        fileInput.value = '';
        focalX.value = String((stored?.focal_x ?? 0.5) * 100);
        focalY.value = String((stored?.focal_y ?? 0.5) * 100);
        storedFocalX = focalX.value;
        storedFocalY = focalY.value;
        [focalX, focalY].forEach(input => input.removeAttribute('aria-invalid'));
        update();
    }

    function selectFile(file) {
        if (disposed || !file) return;
        const limit = file.type.startsWith('video/') ? VIDEO_MAX_FILE_BYTES : MAX_FILE_BYTES;
        if (!MEDIA_EXTENSIONS[file.type]?.test(file.name)
            || file.size === 0 || file.size >= limit) {
            report('front_page_background_invalid');
            fileInput.value = '';
            return;
        }
        revokePreview();
        selectedFile = file;
        previewUrl = URL.createObjectURL(file);
        removing = false;
        update();
    }

    fileInput.addEventListener('change', () => selectFile(fileInput.files?.[0]));
    webButton.addEventListener('click', () => {
        picker?.hide();
        picker = openImageSourcePicker({
            endpointRouter: endpoint_router,
            getTranslation: (key, options) => getTranslationForKey(
                key === 'image_source_picker_help' ? 'front_page_background_picker_help' : key, options,
            ),
            getLanguage: getLanguageWithBrowserFallback,
            onSelect: ({ file }) => selectFile(file),
        });
    });
    [focalX, focalY].forEach(input => input.addEventListener('input', update));
    removeButton.addEventListener('click', () => {
        selectedFile = null;
        revokePreview();
        fileInput.value = '';
        removing = Boolean(stored || backgroundError);
        if (!removing) {
            focalX.value = focalY.value = '50';
        }
        update();
    });

    return {
        element, saveButton, dirty, setSnapshot, update,
        validate() {
            if (removing || !dirty()) return true;
            const valid = [focalX, focalY].map(input => {
                const okay = input.value !== '' && Number.isFinite(input.valueAsNumber)
                    && input.valueAsNumber >= 0 && input.valueAsNumber <= 100;
                input.setAttribute('aria-invalid', String(!okay));
                return okay;
            });
            if (valid.every(Boolean)) return true;
            report('front_page_focal_invalid');
            [focalX, focalY][valid.indexOf(false)].focus();
            return false;
        },
        async save(signal) {
            const body = new FormData();
            if (selectedFile) body.append('background_image', selectedFile);
            body.append('focal_x', String(focalX.valueAsNumber / 100));
            body.append('focal_y', String(focalY.valueAsNumber / 100));
            const response = await endpoint_router('adminFrontPageBackground', {
                method: removing ? 'DELETE' : 'POST',
                ...(removing ? {} : { body_data: body }),
                suppressErrorToast: true, signal,
            });
            if (!disposed) {
                setSnapshot(response.background);
                frontPageLabel(status, 'settings_saved');
            }
        },
        destroy() {
            disposed = true;
            picker?.hide();
            if (videoPreview.hasAttribute('src')) {
                videoPreview.pause();
                videoPreview.removeAttribute('src');
                videoPreview.load();
            }
            revokePreview();
        },
    };
}
