// table_removal_dialog.js
// Keeps reversible UI removal distinct from exact-name-confirmed permanent deletion.
// A stacked modal preserves the underlying management draft when cancelled.
import { createStackedModal } from '../../../../reusable_components/modal/modal_builder.js';
import {
    datasetFormText, datasetFormLabel, setDatasetFormText, observeDatasetFormLanguage,
} from '../../dataset_form/dataset_form_text.js';

export function openDatasetRemovalDialog({ datasetName, onConfirm, onConfirmed }) {
    const form = document.createElement('form');
    form.className = 'dataset-removal-dialog';
    form.dataset.testid = 'dataset-removal-dialog';

    const nameLabel = datasetFormLabel('table_name');
    const name = document.createElement('code');
    name.textContent = datasetName;
    name.dataset.testid = 'dataset-removal-real-name';
    nameLabel.appendChild(name);
    form.appendChild(nameLabel);

    const modes = document.createElement('fieldset');
    modes.appendChild(setDatasetFormText(document.createElement('legend'), 'manage_table_delete_mode'));
    const choices = {};
    for (const [mode, key] of [['hide', 'manage_table_hide'], ['permanent', 'manage_table_permanent']]) {
        const label = document.createElement('label');
        label.className = 'deletion-option';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'dataset-removal-mode';
        input.value = mode;
        input.checked = mode === 'hide';
        input.dataset.testid = 'dataset-removal-mode-' + mode;
        label.append(input, setDatasetFormText(document.createElement('span'), key));
        choices[mode] = input;
        modes.appendChild(label);
    }
    form.appendChild(modes);

    const hideHelp = setDatasetFormText(document.createElement('p'), 'manage_table_hide_help');
    const warning = setDatasetFormText(document.createElement('p'), 'manage_table_permanent_help');
    warning.className = 'deletion-warning';
    warning.dataset.testid = 'dataset-removal-irreversible-warning';
    const confirmation = datasetFormLabel('manage_table_confirm_name');
    confirmation.className = 'deletion-confirmation';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.autocomplete = 'off';
    nameInput.spellcheck = false;
    nameInput.dataset.testid = 'dataset-removal-confirm-name';
    confirmation.appendChild(nameInput);
    form.append(hideHelp, warning, confirmation);

    const error = document.createElement('p');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    form.appendChild(error);
    const actions = document.createElement('div');
    actions.className = 'form-actions';
    const cancel = setDatasetFormText(document.createElement('button'), 'manage_table_cancel');
    cancel.type = 'button';
    cancel.className = 'cancel-button';
    cancel.dataset.testid = 'dataset-removal-cancel';
    const confirm = document.createElement('button');
    confirm.type = 'submit';
    confirm.className = 'submit-button';
    confirm.dataset.testid = 'dataset-removal-confirm';
    actions.append(cancel, confirm);
    form.appendChild(actions);

    let busy = false;
    const updateChoice = () => {
        const permanent = choices.permanent.checked;
        hideHelp.hidden = permanent;
        warning.hidden = !permanent;
        confirmation.hidden = !permanent;
        nameInput.disabled = busy || !permanent;
        confirm.classList.toggle('danger-button', permanent);
        setDatasetFormText(confirm, permanent ? 'manage_table_permanent' : 'manage_table_hide');
        confirm.disabled = busy || (permanent && nameInput.value !== datasetName);
        choices.hide.disabled = busy;
        choices.permanent.disabled = busy;
        cancel.disabled = busy;
    };
    modes.addEventListener('change', updateChoice);
    nameInput.addEventListener('input', updateChoice);

    let disposeLanguage = () => {};
    const dialog = createStackedModal({
        titlePlainText: datasetFormText('manage_table_delete_title'),
        contentElements: [form],
        width: 'min(520px, 94vw)',
        cleanupCallback: () => disposeLanguage(),
    });
    setDatasetFormText(dialog.modal.querySelector('h2'), 'manage_table_delete_title');
    disposeLanguage = observeDatasetFormLanguage(dialog.modal);
    cancel.addEventListener('click', dialog.hide);
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy) return;
        const mode = choices.permanent.checked ? 'permanent' : 'hide';
        const exactName = nameInput.value;
        // Do not trim or normalize: the backend requires the same exact identifier.
        if (mode === 'permanent' && exactName !== datasetName) return;
        busy = true;
        error.hidden = true;
        updateChoice();
        try {
            await onConfirm({ mode, confirmDatasetName: mode === 'permanent' ? exactName : null });
        } catch (failure) {
            setDatasetFormText(error, 'manage_table_delete_failed');
            error.hidden = false;
            busy = false;
            updateChoice();
            console.warn('Dataset removal failed:', failure);
            return;
        }
        dialog.hide();
        await onConfirmed?.(mode);
    });
    updateChoice();
    dialog.show();
    return dialog;
}
