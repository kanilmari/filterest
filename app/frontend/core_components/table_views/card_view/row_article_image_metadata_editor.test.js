// @vitest-environment jsdom
// row_article_image_metadata_editor.test.js
// Verifies per-language image details through the public article gallery.
// Bridges add-row column metadata, the shared language inputs, and batched updates.
// Exists to protect translations while preserving ordinary image editing.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const { endpointRouterMock, fetchColumnsInfoMock, getTranslationForKeyMock } = vi.hoisted(() => ({
    endpointRouterMock: vi.fn(),
    fetchColumnsInfoMock: vi.fn(),
    getTranslationForKeyMock: vi.fn(),
}));

vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: endpointRouterMock }));
vi.mock('../../general_tables/gt_1_row_crud/gt_1_1_row_create/row_api_fetcher.js', () => ({
    fetchColumnsInfo: fetchColumnsInfoMock,
}));
vi.mock('../../lang/translation_handler.js', () => ({ getTranslationForKey: getTranslationForKeyMock }));
vi.mock('./image_first_view_activation.js', () => ({ activateImageFirstView: vi.fn() }));
vi.mock('../../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showErrorToast: vi.fn(),
    showSuccessToast: vi.fn(),
}));

import { buildRowArticleImageGallery } from './row_article_image_gallery.js';
import { setAllSpecs } from '../../state_stores/table_specs_reader.js';

const languages = [
    { language_code: 'en', native_name: 'English', is_default: false },
    { language_code: 'fi', native_name: 'Suomi', is_default: true },
    { language_code: 'sv', native_name: 'Svenska', is_default: false },
];

beforeEach(() => {
    vi.clearAllMocks();
    endpointRouterMock.mockResolvedValue({ ok: true });
    setAllSpecs({ services_media: { table_uid: 42 } });
    fetchColumnsInfoMock.mockResolvedValue([
        { column_name: 'title', data_type: 'text', is_multilingual: false },
        {
            column_name: 'description', data_type: 'text', is_multilingual: true,
            is_nullable: 'YES', multilingual_languages: languages,
        },
    ]);
    getTranslationForKeyMock.mockImplementation((key, { fallback = '' } = {}) => ({
        edit: 'Muokkaa', title: 'Otsikko', description: 'Kuvaus', save: 'Tallenna', cancel: 'Peru',
    }[key] || fallback));
});

async function buildMetadataGallery({ description = { fi: 'Kuvateksti', en: 'Caption' }, types, rows } = {}) {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const gallery = buildRowArticleImageGallery('services', 1, {
        dataset: 'services_media',
        column: 'services_id',
        relation_kind: 'shared_asset',
        types: types || { title: { is_multilingual: false }, description: { is_multilingual: true } },
        rows: rows || [{ id: 11, asset_kind: 'image', filename: 'hero.png', title: 'Hero', description }],
    }, onRefresh, { canUpload: false, canEditMetadata: true });
    await Promise.resolve();
    await Promise.resolve();
    gallery.querySelector('[data-testid="big-card-image-editor-toggle"]').click();
    return { gallery, onRefresh };
}

async function saveMetadata(gallery) {
    const form = gallery.querySelector('.big_card_image_editor_form');
    expect(form.checkValidity()).toBe(true);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
}

describe('image details in separate languages', () => {
    test.each(['text', 'json', 'jsonb'])('fills one field per registry language from a stored %s map', async (dataType) => {
        fetchColumnsInfoMock.mockResolvedValueOnce([{
            column_name: 'description', data_type: dataType, is_multilingual: true,
            multilingual_languages: languages,
        }]);
        const { gallery } = await buildMetadataGallery({
            description: JSON.stringify({ fi: 'Kuvateksti', en: 'Caption' }),
        });
        const group = gallery.querySelector('[data-multilingual-column="description"]');

        expect(fetchColumnsInfoMock).toHaveBeenCalledWith(42);
        expect(group.querySelectorAll('textarea')).toHaveLength(3);
        expect(group.querySelector('[data-language-code="fi"]').value).toBe('Kuvateksti');
        expect(group.querySelector('[data-language-code="en"]').value).toBe('Caption');
        expect(group.querySelector('[data-language-code="sv"]').value).toBe('');
        expect(group.querySelector('legend').textContent).toBe('Kuvaus');
        expect(group.querySelector('label').textContent).toBe('EN — English');
        expect(gallery.querySelector('[data-testid="big-card-image-description-input"]')).toBeNull();
    });

    test('loads legacy plain text in the default language even when it is listed second', async () => {
        const { gallery } = await buildMetadataGallery({ description: 'Vanha kuvateksti' });

        expect(gallery.querySelector('[data-language-code="fi"]').value).toBe('Vanha kuvateksti');
        expect(gallery.querySelector('[data-language-code="en"]').value).toBe('');
        expect(gallery.querySelector('[data-language-code="sv"]').value).toBe('');
    });

    test('saves a translated legacy caption as a map', async () => {
        const { gallery } = await buildMetadataGallery({ description: 'Vanha kuvateksti' });
        gallery.querySelector('[data-language-code="en"]').value = 'Legacy caption';
        await saveMetadata(gallery);

        expect(endpointRouterMock.mock.calls[0][1].body_data.updates).toEqual([
            { column: 'description', value: JSON.stringify({ en: 'Legacy caption', fi: 'Vanha kuvateksti' }) },
        ]);
    });

    test('saves the serialized language map in the same batched request with ordinary text', async () => {
        const { gallery, onRefresh } = await buildMetadataGallery();
        gallery.querySelector('[data-language-code="fi"]').value = 'Uusi kuvateksti';
        gallery.querySelector('[data-language-code="en"]').value = 'New caption';
        gallery.querySelector('[data-testid="big-card-image-title-input"]').value = ' New hero ';
        await saveMetadata(gallery);

        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
        expect(endpointRouterMock).toHaveBeenCalledWith('updateRow', {
            method: 'POST', url_params: '?dataset=services_media',
            body_data: {
                id: 11,
                updates: [
                    { column: 'title', value: 'New hero' },
                    { column: 'description', value: JSON.stringify({ en: 'New caption', fi: 'Uusi kuvateksti' }) },
                ],
            },
        });
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    test('leaves empty and whitespace-only languages out without requiring all translations', async () => {
        const { gallery } = await buildMetadataGallery();
        gallery.querySelector('[data-language-code="en"]').value = '  ';
        gallery.querySelector('[data-language-code="fi"]').value = 'Uusi kuvateksti';
        gallery.querySelector('[data-language-code="fi"]').dispatchEvent(new Event('input'));
        await saveMetadata(gallery);

        expect(endpointRouterMock.mock.calls[0][1].body_data.updates).toEqual([
            { column: 'description', value: JSON.stringify({ fi: 'Uusi kuvateksti' }) },
        ]);
    });

    test('clears every translation with the add-row empty-value representation', async () => {
        const { gallery } = await buildMetadataGallery();
        gallery.querySelectorAll('[data-language-code]').forEach((input) => { input.value = ''; });
        await saveMetadata(gallery);

        expect(endpointRouterMock.mock.calls[0][1].body_data.updates).toEqual([
            { column: 'description', value: '' },
        ]);
    });

    test('keeps a non-multilingual column as one scalar field even when it contains JSON text', async () => {
        const description = '{"fi":"Kuvateksti","en":"Caption"}';
        const { gallery } = await buildMetadataGallery({
            description, types: { description: { is_multilingual: false } },
        });
        const input = gallery.querySelector('[data-testid="big-card-image-description-input"]');

        expect(input.value).toBe(description);
        expect(fetchColumnsInfoMock).not.toHaveBeenCalled();
        expect(gallery.querySelector('[data-multilingual-column]')).toBeNull();
        input.value = ' Ordinary text ';
        await saveMetadata(gallery);
        expect(endpointRouterMock.mock.calls[0][1].body_data.updates).toEqual([
            { column: 'description', value: 'Ordinary text' },
        ]);
    });

    test('also renders multilingual titles and restores both maps when cancelling', async () => {
        fetchColumnsInfoMock.mockResolvedValueOnce(['title', 'description'].map((columnName) => ({
            column_name: columnName, data_type: 'text', is_multilingual: true,
            multilingual_languages: languages,
        })));
        const { gallery } = await buildMetadataGallery({
            types: { title: { is_multilingual: true }, description: { is_multilingual: true } },
            rows: [{ id: 11, asset_kind: 'image', filename: 'hero.png', title: { fi: 'Otsikko' }, description: { en: 'Caption' } }],
        });
        const titleInput = gallery.querySelector('[data-testid="big-card-image-title-input-fi"]');
        const descriptionInput = gallery.querySelector('[data-testid="big-card-image-description-input-en"]');
        titleInput.value = 'Muutos';
        descriptionInput.value = 'Change';
        gallery.querySelector('[data-testid="big-card-image-reset"]').click();

        expect(titleInput.value).toBe('Otsikko');
        expect(descriptionInput.value).toBe('Caption');
        await saveMetadata(gallery);
        expect(endpointRouterMock).not.toHaveBeenCalled();
    });

    test('loads the currently selected row if metadata arrives after the thumbnail changes', async () => {
        let resolveColumns;
        fetchColumnsInfoMock.mockReturnValueOnce(new Promise((resolve) => { resolveColumns = resolve; }));
        const { gallery } = await buildMetadataGallery({ rows: [
            { id: 11, asset_kind: 'image', filename: 'hero.png', description: { fi: 'Ensimmäinen' } },
            { id: 12, asset_kind: 'image', filename: 'next.png', description: { fi: 'Toinen' } },
        ] });
        expect(gallery.querySelector('[data-testid="big-card-image-save"]').disabled).toBe(true);
        expect(gallery.querySelector('[data-testid="big-card-image-title-input"]').disabled).toBe(true);
        gallery.querySelector('[data-testid="big-card-image-thumb-1"]').click();
        resolveColumns([{
            column_name: 'description', data_type: 'text', is_multilingual: true,
            multilingual_languages: languages,
        }]);
        await Promise.resolve();

        expect(gallery.querySelector('[data-language-code="fi"]').value).toBe('Toinen');
        expect(gallery.querySelector('[data-testid="big-card-image-save"]').disabled).toBe(false);
        expect(gallery.querySelector('[data-testid="big-card-image-title-input"]').disabled).toBe(false);
    });

    test('keeps translations out of scalar inputs when their metadata cannot load', async () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            fetchColumnsInfoMock.mockResolvedValueOnce(null);
            const { gallery } = await buildMetadataGallery();
            await Promise.resolve();
            const scalarInput = gallery.querySelector('[data-testid="big-card-image-description-input"]');

            expect(scalarInput.closest('label').classList.contains('hidden')).toBe(true);
            expect(gallery.querySelector('[data-testid="big-card-image-save"]').disabled).toBe(true);
            gallery.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
            expect(endpointRouterMock).not.toHaveBeenCalled();
            expect(warning).toHaveBeenCalled();
            expect(getTranslationForKeyMock).toHaveBeenCalledWith('failed_to_load', expect.objectContaining({
                fallback: expect.any(String),
            }));
        } finally {
            warning.mockRestore();
        }
    });

    test('does not load editing metadata or show an editor without update permission', () => {
        const gallery = buildRowArticleImageGallery('services', 1, {
            dataset: 'services_media', column: 'services_id', relation_kind: 'shared_asset',
            types: { description: { is_multilingual: true } },
            rows: [{ id: 11, asset_kind: 'image', filename: 'hero.png', description: { fi: 'Kuvateksti' } }],
        }, vi.fn(), { canUpload: false, canEditMetadata: false });

        expect(gallery.querySelector('[data-testid="big-card-image-editor"]')).toBeNull();
        expect(fetchColumnsInfoMock).not.toHaveBeenCalled();
    });
});
