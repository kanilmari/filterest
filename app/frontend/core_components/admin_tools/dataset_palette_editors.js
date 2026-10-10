// dataset_palette_editors.js
// Opens the established tab media and card-field editors from the palette.
// Connects lazy editor modules to the existing permission and modal lifecycle.
// Keeps files/field metadata in their own stores and save flows.
import { hasRoutePermission } from '../route_permission_checker.js';

/** Reuse the header editor and its existing media save/authorization checks. */
export async function openPaletteMediaEditor(datasetName) {
    const { openDatasetHeaderConfigModal } = await import('./dataset_header_config_modal.js');
    return openDatasetHeaderConfigModal(datasetName);
}

/** Reuse the card editor, selecting this tab and releasing its listeners on close. */
export async function openPaletteFieldEditor(datasetName, copy) {
    if (!hasRoutePermission('/ui/admin/card_visibility')) return null;
    const [{ generate_card_visibility_form }, { createModal, showModal }] = await Promise.all([
        import('./card_visibility_view.js'), import('../../reusable_components/modal/modal_builder.js'),
    ]);
    const content = document.createElement('div');
    const { modal } = createModal({ titleDataLangKey: 'card_visibility', titleDataLangKeyFallback: copy.fieldEditor,
        contentElements: [content], width: '1080px', maxWidth: '1080px', maxHeight: '860px',
        cleanupCallback: () => content.__cleanupListeners?.() });
    showModal();
    await generate_card_visibility_form(content, { initialDatasetName: datasetName });
    return modal;
}
