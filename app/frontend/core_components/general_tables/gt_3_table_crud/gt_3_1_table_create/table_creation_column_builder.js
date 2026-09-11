// table_creation_column_builder.js
// Builds each dataset column's native controls, including a renderer-role choice.
// FormData preserves aligned values and the page translator updates labels in place.
import { getCardRoleOptions } from '../../../table_views/card_view/card_role_catalog.js';
import { createCreationLabel, setCreationText } from './table_creation_labels.js';

export function addColumnField(container, initialName = '', initialType = '') {
    const row = document.createElement('div');
    row.className = 'column-field';
    const nameLabel = createCreationLabel('column_name');
    const nameInput = document.createElement('input');
    nameInput.name = 'column_name';
    nameInput.type = 'text';
    nameInput.value = initialName;
    nameLabel.appendChild(nameInput);

    const typeLabel = createCreationLabel('data_type');
    const typeSelect = document.createElement('select');
    typeSelect.name = 'data_type';
    const empty = setCreationText(document.createElement('option'), 'select_data_type');
    empty.value = '';
    typeSelect.appendChild(empty);
    for (const value of ['SERIAL', 'INTEGER', 'VARCHAR', 'TEXT', 'BOOLEAN', 'DATE', 'TIMESTAMPTZ NOT NULL DEFAULT NOW()', 'JSONB']) {
        const option = document.createElement('option');
        option.value = value;
        if (value.startsWith('TIMESTAMPTZ')) setCreationText(option, 'data_type_auto_timestamp');
        else option.textContent = value;
        typeSelect.appendChild(option);
    }
    typeSelect.value = initialType;
    typeLabel.appendChild(typeSelect);

    const lengthLabel = createCreationLabel('length');
    lengthLabel.className = 'column-field__length';
    const lengthInput = document.createElement('input');
    lengthInput.type = 'number';
    lengthInput.name = 'length';
    lengthInput.min = '1';
    lengthLabel.appendChild(lengthInput);
    const syncLength = () => {
        const usesLength = typeSelect.value === 'VARCHAR';
        lengthLabel.style.visibility = usesLength ? '' : 'hidden';
        lengthLabel.setAttribute('aria-hidden', String(!usesLength));
        lengthInput.tabIndex = usesLength ? 0 : -1;
        lengthInput.required = usesLength;
        row.classList.toggle('column-field--varchar', usesLength);
        if (!usesLength) lengthInput.value = '';
    };
    typeSelect.addEventListener('change', syncLength);
    syncLength();

    const roleLabel = createCreationLabel('card_role');
    const roleSelect = document.createElement('select');
    roleSelect.name = 'card_role';
    roleSelect.dataset.testid = 'create-table-column-card-role';
    for (const { value, labelKey } of getCardRoleOptions()) {
        const option = setCreationText(document.createElement('option'), labelKey);
        option.value = value;
        roleSelect.appendChild(option);
    }
    roleSelect.value = 'details';
    roleLabel.appendChild(roleSelect);

    const remove = setCreationText(document.createElement('button'), 'delete');
    remove.type = 'button';
    remove.className = 'column-field__remove';
    remove.addEventListener('click', () => row.remove());
    row.append(nameLabel, typeLabel, lengthLabel, roleLabel, remove);
    container.appendChild(row);
    return row;
}
