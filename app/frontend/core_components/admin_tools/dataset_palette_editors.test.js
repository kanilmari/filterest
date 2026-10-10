// dataset_palette_editors.test.js
// Exercises the palette's field-editor entry with its real modal and dataset tree.
// Connects delayed tree initialization with dataset selection and versioned saves.
// Keeps preselection, cleanup and retained appearance drafts under regression coverage.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { paletteSnapshot } from './dataset_appearance_palette_test_fixtures.js';

const { fetchVisibility, saveVisibility } = vi.hoisted(() => ({ fetchVisibility: vi.fn(), saveVisibility: vi.fn() }));
vi.mock('../endpoints/stable_endpoint_router.js', async original => ({
    ...await original(), fetchCardVisibility: fetchVisibility, saveCardVisibility: saveVisibility,
}));
vi.mock('../route_permission_checker.js', () => ({ hasRoutePermission: () => true }));
vi.mock('../../icons/icon_loader.js', () => ({ setElementSvgContent: vi.fn(), loadIconSvg: async () => '' }));
vi.mock('../../reusable_components/notifications/toast_notification_printer.js', () => ({ showSuccessToast: vi.fn() }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: (key, options) => options?.fallback || key }));
import { openPaletteFieldEditor } from './dataset_palette_editors.js';
import { hideModal } from '../../reusable_components/modal/modal_builder.js';
import { datasetAppearanceState } from '../table_views/dataset_appearance_state.js';
import { setAllSpecs } from '../state_stores/table_specs_reader.js';

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = ''; localStorage.clear(); datasetAppearanceState.clear();
    setAllSpecs({ orders: { table_uid: 11 }, other: { table_uid: 22 } });
    localStorage.setItem('full_tree_data', JSON.stringify({ nodes: [
        { id: 'folder', name: 'Folder', parent_id: null },
        { id: 'orders', name: 'orders', table_uid: 11, parent_id: 'folder' },
        { id: 'other', name: 'other', table_uid: 22, parent_id: 'folder' },
    ] }));
    fetchVisibility.mockReset(); saveVisibility.mockReset();
    const snapshot = paletteSnapshot(11);
    datasetAppearanceState.accept('orders', snapshot);
    fetchVisibility.mockResolvedValue({ table_name: 'orders', dataset_appearance: snapshot,
        columns: [{ column_uid: 1, column_name: 'palette_field', show_value_on_card: true }] });
    saveVisibility.mockResolvedValue({ dataset_presentation: { dataset_appearance: { ...snapshot, version: '2' } } });
});
afterEach(() => { hideModal(); vi.useRealTimers(); });

test.each(['', 'tree_node_other_cv_tree'])('palette selects its dataset through delayed tree initialization (stored: %s)', async stored => {
    localStorage.setItem('single_selection_cv_tree', stored);
    const draft = paletteSnapshot(11);
    draft.tab_values['shared.hero_extra_height'] = 100;
    datasetAppearanceState.setPreview('palette', 'orders', draft);
    let complete;
    fetchVisibility.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const opening = openPaletteFieldEditor('orders', { fieldEditor: 'Fields' });
    await vi.waitFor(() => expect(fetchVisibility).toHaveBeenCalledWith('orders'));
    // The real tree publishes its restored selection on the next timer turn.
    await vi.advanceTimersByTimeAsync(0);
    complete({ table_name: 'orders', dataset_appearance: paletteSnapshot(11),
        columns: [{ column_uid: 1, column_name: 'palette_field', show_value_on_card: true }] });
    const modal = await opening;
    const matrix = modal.querySelector('#cv_matrix_container');
    expect(matrix.classList.contains('mp-placeholder-state')).toBe(false);
    expect(matrix.textContent).toContain('palette_field');
    expect(modal.querySelector('#tree_node_orders_cv_tree input[type="radio"]').checked).toBe(true);
    expect(fetchVisibility.mock.calls).toEqual([['orders']]);
    modal.querySelector('[data-testid="card-visibility-edit-button"]').click();
    const checkbox = matrix.querySelector('.vct-input-checkbox:not(:disabled)');
    checkbox.click();
    modal.querySelector('[data-testid="card-visibility-save-button"]').click();
    await vi.waitFor(() => expect(saveVisibility).toHaveBeenCalledOnce());
    expect(saveVisibility.mock.calls[0][0]).toMatchObject({ table_name: 'orders', version: '1', shared_version: 'site-1' });
    await vi.waitFor(() => expect(datasetAppearanceState.savedSnapshot('orders').version).toBe('2'));
    hideModal();
    expect(datasetAppearanceState.effective('orders').shared.hero_extra_height).toBe(100);
});
