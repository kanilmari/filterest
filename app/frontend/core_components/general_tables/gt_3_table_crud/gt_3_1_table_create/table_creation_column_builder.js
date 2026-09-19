// table_creation_column_builder.js
// Builds each dataset column's native controls, including a renderer-role choice.
// FormData preserves aligned values and the page translator updates labels in place.
import { getCardRoleOptions } from '../../../table_views/card_view/card_role_catalog.js';
import {
    COLUMN_TYPE_PARAMETER,
    DEFAULT_NUMERIC_PRECISION,
    DEFAULT_NUMERIC_SCALE,
    getColumnTypeParameter,
    getDatasetColumnTypeOptions,
} from '../../dataset_form/dataset_column_type_catalog.js';
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
    for (const { value, labelKey } of getDatasetColumnTypeOptions('create')) {
        const option = setCreationText(document.createElement('option'), labelKey);
        option.value = value;
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

    // A decimal column carries its own two numbers; the server refuses a bare
    // NUMERIC. Both controls stay in every row so the submitted values remain
    // aligned with their column, and only the relevant ones are shown.
    const precisionLabel = createCreationLabel('dataset_column_type_precision');
    precisionLabel.className = 'column-field__precision';
    const precisionInput = document.createElement('input');
    precisionInput.type = 'number';
    precisionInput.name = 'precision';
    precisionInput.min = '1';
    precisionInput.max = '1000';
    precisionLabel.appendChild(precisionInput);

    const scaleLabel = createCreationLabel('dataset_column_type_scale');
    scaleLabel.className = 'column-field__scale';
    const scaleInput = document.createElement('input');
    scaleInput.type = 'number';
    scaleInput.name = 'scale';
    scaleInput.min = '0';
    scaleLabel.appendChild(scaleInput);

    // The type's own parameters share one cell, so a row keeps its column
    // alignment whether the chosen type needs none, a length, or two numbers.
    const parameters = document.createElement('div');
    parameters.className = 'column-field__parameters';
    parameters.append(lengthLabel, precisionLabel, scaleLabel);

    const showParameter = (label, input, visible) => {
        label.style.display = visible ? '' : 'none';
        label.setAttribute('aria-hidden', String(!visible));
        input.tabIndex = visible ? 0 : -1;
        if (!visible) input.value = '';
    };
    const syncParameters = () => {
        const parameter = getColumnTypeParameter(typeSelect.value);
        const usesLength = parameter === COLUMN_TYPE_PARAMETER.LENGTH;
        const usesPrecision = parameter === COLUMN_TYPE_PARAMETER.PRECISION;
        showParameter(lengthLabel, lengthInput, usesLength);
        lengthInput.required = usesLength;
        showParameter(precisionLabel, precisionInput, usesPrecision);
        showParameter(scaleLabel, scaleInput, usesPrecision);
        if (usesPrecision && !precisionInput.value) {
            precisionInput.value = String(DEFAULT_NUMERIC_PRECISION);
            scaleInput.value = String(DEFAULT_NUMERIC_SCALE);
        }
        row.classList.toggle('column-field--varchar', usesLength);
        row.classList.toggle('column-field--numeric', usesPrecision);
    };
    typeSelect.addEventListener('change', syncParameters);
    syncParameters();

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
    row.append(nameLabel, typeLabel, parameters, roleLabel, remove);
    container.appendChild(row);
    return row;
}
