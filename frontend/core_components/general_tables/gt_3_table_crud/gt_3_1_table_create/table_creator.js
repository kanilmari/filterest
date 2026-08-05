// table_creator.js
// Renders the table-creation form and submits a new table definition to the backend.
// Bridges column configuration, identifier validation, translation, and the admin tree refresh into one creation flow.
// Exists to encapsulate all new-table setup logic so the toolbar can delegate table creation as a single call.

// Voit pitää default_auto_columns samana kuin aiemmin
const default_auto_columns = [
    { column_name: 'id', data_type: 'SERIAL' },
    { column_name: 'created', data_type: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()' },
    { column_name: 'updated', data_type: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()' }
];

import { loadManagementView } from '../../../../reusable_components/dom_container_builder.js';
import { fetch_columns_for_table } from '../../../endpoints/endpoint_column_fetcher.js';
import { endpoint_router } from '../../../endpoints/endpoint_router.js';
import { getTranslationForKey } from '../../../lang/translation_handler.js';
import { showSuccessToast, showWarningToast } from '../../../../reusable_components/notifications/toast_notification_printer.js';
import { getDatasetRouteUniquenessHint } from '../../../navigation/nav_engine/dataset_aliases.js';
import { initializeTreeCallAdmin } from '../../../vanilla_tree/van_tr_components/admin_tree_builder.js';
import { buildTableCreationRequestData } from './table_creator_helpers.js';
import {
    buildFolderOptionsFromNodes,
    resolveFolderSelectionDefaults,
} from './table_creator_folder_helpers.js';

export function load_table_creation() {
    // Annetaan id sekä generointifunktio:
    return loadManagementView('table_creation_container', generate_table_creation_view);
}

export async function generate_table_creation_view(container) {
    container.replaceChildren(); // Tyhjennä mahdollinen aiempi sisältö

    const form = document.createElement('form');
    form.id = 'table_creation_form';
    form.dataset.testid = 'create-table-form';
    form.style.display = 'grid';
    form.style.gridTemplateColumns = '1fr'; 
    form.style.gridGap = '10px'; 
    form.style.backgroundColor = 'var(--bg_color)';
    form.style.color = 'var(--text_color)';
    form.style.border = '1px solid var(--border_color)';
    form.style.padding = '10px';

    // Taulun nimi
    const tableNameLabel = document.createElement('label');
    tableNameLabel.textContent = getTranslationForKey('table_name') || 'Taulun nimi: ';
    const tableNameInput = document.createElement('input');
    tableNameInput.type = 'text';
    tableNameInput.id = 'table_name';
    tableNameInput.name = 'table_name';
    tableNameInput.dataset.testid = 'create-table-name-input';
    tableNameInput.required = true;
    tableNameLabel.appendChild(tableNameInput);
    form.appendChild(tableNameLabel);

    const datasetRouteHint = document.createElement('p');
    datasetRouteHint.className = 'table-name-route-hint';
    datasetRouteHint.dataset.testid = 'create-table-route-hint';
    datasetRouteHint.textContent = getDatasetRouteUniquenessHint();
    Object.assign(datasetRouteHint.style, {
        margin: '0',
        fontSize: '0.9em',
        color: 'var(--text_color_2, var(--text_color))',
    });
    form.appendChild(datasetRouteHint);

    const folderSection = document.createElement('div');
    folderSection.className = 'table-folder-section';

    const folderSectionTitle = document.createElement('div');
    folderSectionTitle.className = 'table-folder-section-title';
    folderSectionTitle.textContent = getTranslationForKey('folder') || 'Kansio';
    folderSection.appendChild(folderSectionTitle);

    const existingFolderLabel = document.createElement('label');
    existingFolderLabel.textContent = getTranslationForKey('select_folder') || 'Valitse olemassa oleva kansio';
    const existingFolderSelect = document.createElement('select');
    existingFolderSelect.id = 'table_folder_id';
    existingFolderSelect.name = 'table_folder_id';
    existingFolderSelect.dataset.testid = 'create-table-folder-select';
    existingFolderLabel.appendChild(existingFolderSelect);
    folderSection.appendChild(existingFolderLabel);

    const folderHint = document.createElement('p');
    folderHint.className = 'table-folder-hint';
    folderHint.textContent = getTranslationForKey('table_folder_hint')
        || 'Voit valita taululle kansion tai luoda uuden. Oletuksena taulu sijoitetaan kansioon database / other_tables, ei juureen.';
    folderSection.appendChild(folderHint);

    const newFolderFields = document.createElement('div');
    newFolderFields.className = 'table-folder-inline-fields';

    const newFolderNameLabel = document.createElement('label');
    newFolderNameLabel.textContent = getTranslationForKey('new_folder_name') || 'Uuden kansion nimi';
    const newFolderNameInput = document.createElement('input');
    newFolderNameInput.type = 'text';
    newFolderNameInput.id = 'create_table_new_folder_name';
    newFolderNameInput.name = 'create_table_new_folder_name';
    newFolderNameInput.dataset.testid = 'create-table-new-folder-name';
    newFolderNameLabel.appendChild(newFolderNameInput);
    newFolderFields.appendChild(newFolderNameLabel);

    const newFolderParentLabel = document.createElement('label');
    newFolderParentLabel.textContent = getTranslationForKey('parent_folder') || 'Yläkansio uudelle kansiolle';
    const newFolderParentSelect = document.createElement('select');
    newFolderParentSelect.id = 'create_table_new_folder_parent_id';
    newFolderParentSelect.name = 'create_table_new_folder_parent_id';
    newFolderParentSelect.dataset.testid = 'create-table-new-folder-parent';
    newFolderParentLabel.appendChild(newFolderParentSelect);
    newFolderFields.appendChild(newFolderParentLabel);

    folderSection.appendChild(newFolderFields);
    form.appendChild(folderSection);

    // Sarakkeet container
    const columnsContainer = document.createElement('div');
    columnsContainer.id = 'columns_container';
    columnsContainer.style.display = 'grid';
    columnsContainer.style.gridTemplateColumns = '1fr';
    columnsContainer.style.gridGap = '5px';
    form.appendChild(columnsContainer);

    // Lisää sarake -painike
    const addColumnButton = document.createElement('button');
    addColumnButton.type = 'button';
    addColumnButton.textContent = getTranslationForKey('add_column') || 'Lisää sarake';
    addColumnButton.classList.add('modal-button', 'secondary', 'saturate_on_hover');
    addColumnButton.addEventListener('click', () => addColumnField(columnsContainer));
    form.appendChild(addColumnButton);

    // Vierasavaimet-container
    const foreignKeysContainer = document.createElement('div');
    foreignKeysContainer.id = 'ct_foreign_keys_container';
    foreignKeysContainer.style.display = 'grid';
    foreignKeysContainer.style.gridTemplateColumns = '1fr';
    foreignKeysContainer.style.gridGap = '5px';
    form.appendChild(foreignKeysContainer);

    // Lisää vierasavain -painike
    const addForeignKeyButton = document.createElement('button');
    addForeignKeyButton.type = 'button';
    addForeignKeyButton.textContent = getTranslationForKey('add_foreign_key') || 'Lisää vierasavain';
    addForeignKeyButton.classList.add('modal-button', 'secondary', 'saturate_on_hover');
    addForeignKeyButton.addEventListener('click', async () => {
        await addForeignKeyField(foreignKeysContainer);
    });
    form.appendChild(addForeignKeyButton);

    // --- Oikeudet ---
    const permissionsContainer = document.createElement('div');
    permissionsContainer.style.marginTop = '10px';
    permissionsContainer.style.display = 'flex';
    permissionsContainer.style.flexDirection = 'column';
    permissionsContainer.style.gap = '5px';

    const permissionsTitle = document.createElement('div');
    permissionsTitle.textContent = getTranslationForKey('default_permissions') || 'Oletusoikeudet:';
    permissionsTitle.style.fontWeight = 'bold';
    permissionsContainer.appendChild(permissionsTitle);

    // Users read access
    const usersReadLabel = document.createElement('label');
    usersReadLabel.style.display = 'flex';
    usersReadLabel.style.alignItems = 'center';
    usersReadLabel.style.gap = '5px';
    const usersReadCheckbox = document.createElement('input');
    usersReadCheckbox.type = 'checkbox';
    usersReadCheckbox.id = 'grant_users_read';
    usersReadCheckbox.name = 'grant_users_read';
    usersReadLabel.appendChild(usersReadCheckbox);
    usersReadLabel.appendChild(document.createTextNode(getTranslationForKey('grant_users_read') || 'Anna lukuoikeus käyttäjille (Users)'));
    permissionsContainer.appendChild(usersReadLabel);

    // Guests read access
    const guestsReadLabel = document.createElement('label');
    guestsReadLabel.style.display = 'flex';
    guestsReadLabel.style.alignItems = 'center';
    guestsReadLabel.style.gap = '5px';
    const guestsReadCheckbox = document.createElement('input');
    guestsReadCheckbox.type = 'checkbox';
    guestsReadCheckbox.id = 'grant_guests_read';
    guestsReadCheckbox.name = 'grant_guests_read';
    guestsReadLabel.appendChild(guestsReadCheckbox);
    guestsReadLabel.appendChild(document.createTextNode(getTranslationForKey('grant_guests_read') || 'Anna lukuoikeus vieraille (Guests)'));
    permissionsContainer.appendChild(guestsReadLabel);

    // Prevent deletion
    const preventDeletionLabel = document.createElement('label');
    preventDeletionLabel.style.display = 'flex';
    preventDeletionLabel.style.alignItems = 'center';
    preventDeletionLabel.style.gap = '5px';
    const preventDeletionCheckbox = document.createElement('input');
    preventDeletionCheckbox.type = 'checkbox';
    preventDeletionCheckbox.id = 'prevent_deletion';
    preventDeletionCheckbox.name = 'prevent_deletion';
    preventDeletionLabel.appendChild(preventDeletionCheckbox);
    const preventDeletionText = document.createElement('span');
    preventDeletionText.dataset.langKey = 'prevent_table_deletion_hosting_request';
    preventDeletionText.textContent = getTranslationForKey('prevent_table_deletion_hosting_request') || 'Prevent table deletion - table can only be removed by hosting upon valid request';
    preventDeletionLabel.appendChild(preventDeletionText);
    permissionsContainer.appendChild(preventDeletionLabel);

    form.appendChild(permissionsContainer);
    // ----------------

    // Lähetä-painike
    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.textContent = getTranslationForKey('create_table') || 'Luo Taulu';
    submitButton.dataset.testid = 'create-table-submit';
    submitButton.dataset.langKey = 'create_table';
    submitButton.classList.add('modal-button', 'primary', 'saturate_on_hover');
    form.appendChild(submitButton);

    // Lomakkeen lähetyksen käsittely
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitTableCreationForm(form);
    });

    // Lisää oletuksena auto-sarakkeet (id, created, updated) 
    // ja sitten yksi "tyhjä" sarake, niin käyttäjä näkee logiikan.
    default_auto_columns.forEach(ac => {
        addColumnField(columnsContainer, ac.column_name, ac.data_type);
    });
    // Yksi täysin tyhjä sarake
    addColumnField(columnsContainer);

    // Haetaan heti taulujen nimet vierasavainvalintoja varten
    window.allTables = await fetchTableNames();
    const folderOptions = await fetchFolderOptions();
    populateFolderSelect(existingFolderSelect, folderOptions, {
        placeholder: getTranslationForKey('select_folder') || '-- Valitse kansio --',
    });
    populateFolderSelect(newFolderParentSelect, folderOptions, {
        placeholder: getTranslationForKey('root_folder') || '-- Luo juureen --',
        includeRoot: true,
    });
    const initialFolderDefaults = resolveFolderSelectionDefaults(folderOptions);
    if (initialFolderDefaults.existingFolderValue) {
        existingFolderSelect.value = initialFolderDefaults.existingFolderValue;
    }
    if (initialFolderDefaults.newFolderParentValue) {
        newFolderParentSelect.value = initialFolderDefaults.newFolderParentValue;
    }
    existingFolderSelect.addEventListener('change', () => {
        if (!newFolderNameInput.value.trim()) {
            newFolderParentSelect.value = existingFolderSelect.value || initialFolderDefaults.canonicalOtherTablesValue || '';
        }
    });
    newFolderNameInput.addEventListener('input', () => {
        if (!newFolderNameInput.value.trim()) {
            newFolderParentSelect.value = existingFolderSelect.value || initialFolderDefaults.canonicalOtherTablesValue || '';
        }
    });

    container.appendChild(form);
}

function readCachedFolderNodes() {
    const rawTreeData = localStorage.getItem('full_tree_data');
    if (!rawTreeData) {
        return [];
    }

    try {
        const parsed = JSON.parse(rawTreeData);
        return Array.isArray(parsed?.nodes) ? parsed.nodes : [];
    } catch (error) {
        console.warn('Failed to parse cached tree data for folder options:', error);
        return [];
    }
}

async function fetchFreshFolderNodes() {
    try {
        const treeData = await endpoint_router('fetchTreeData');
        const nodes = Array.isArray(treeData?.nodes) ? treeData.nodes : [];
        if (nodes.length > 0) {
            localStorage.setItem('full_tree_data', JSON.stringify(treeData));
        }
        return nodes;
    } catch (error) {
        console.warn('Failed to fetch folder options for table creation:', error);
        return [];
    }
}

async function fetchFolderOptions({ forceRefresh = false } = {}) {
    let nodes = [];

    if (!forceRefresh) {
        nodes = readCachedFolderNodes();
    }

    if (forceRefresh || nodes.length === 0) {
        nodes = await fetchFreshFolderNodes();
    }

    return buildFolderOptionsFromNodes(nodes);
}

function populateFolderSelect(selectElement, folderOptions, { placeholder, includeRoot = false } = {}) {
    selectElement.replaceChildren();

    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = placeholder || '--';
    selectElement.appendChild(placeholderOption);

    if (includeRoot) {
        placeholderOption.selected = true;
    }

    folderOptions.forEach((option) => {
        const folderOption = document.createElement('option');
        folderOption.value = option.value;
        folderOption.textContent = option.label;
        selectElement.appendChild(folderOption);
    });

}

function addColumnField(container, initialName = '', initialType = '') {
    const columnDiv = document.createElement('div');
    columnDiv.className = 'column-field';

    // Sarakenimi
    const columnNameLabel = document.createElement('label');
    columnNameLabel.textContent = getTranslationForKey('column_name') || 'Sarakenimi: ';
    const columnNameInput = document.createElement('input');
    columnNameInput.type = 'text';
    columnNameInput.name = 'column_name';
    columnNameInput.required = false;
    columnNameInput.value = initialName;
    columnNameLabel.appendChild(columnNameInput);
    columnDiv.appendChild(columnNameLabel);

    // Tietotyyppi
    const dataTypeLabel = document.createElement('label');
    dataTypeLabel.textContent = getTranslationForKey('data_type') || ' Tietotyyppi: ';
    const dataTypeSelect = document.createElement('select');
    dataTypeSelect.name = 'data_type';
    dataTypeSelect.required = false;
    const dataTypes = [
        { value: '', text: getTranslationForKey('select_data_type') || 'Valitse tietotyyppi' },
        { value: 'SERIAL', text: 'SERIAL' },
        { value: 'INTEGER', text: 'INTEGER' },
        { value: 'VARCHAR', text: 'VARCHAR' },
        { value: 'TEXT', text: 'TEXT' },
        { value: 'BOOLEAN', text: 'BOOLEAN' },
        { value: 'DATE', text: 'DATE' },
        { value: 'TIMESTAMPTZ NOT NULL DEFAULT NOW()', text: 'TIMESTAMPTZ (auto)' },
        { value: 'JSONB', text: 'JSONB' }
    ];

    dataTypes.forEach(type => {
        const option = document.createElement('option');
        option.value = type.value;
        option.textContent = type.text;
        dataTypeSelect.appendChild(option);
    });

    dataTypeSelect.value = initialType || '';
    dataTypeLabel.appendChild(dataTypeSelect);
    columnDiv.appendChild(dataTypeLabel);

    // Pituus (vain VARCHAR)
    const lengthLabel = document.createElement('label');
    lengthLabel.textContent = getTranslationForKey('length') || ' Pituus: ';
    const lengthInput = document.createElement('input');
    lengthInput.type = 'number';
    lengthInput.name = 'length';
    lengthInput.min = '1';
    lengthInput.style.display = 'none'; // Piilotetaan oletuksena
    lengthLabel.appendChild(lengthInput);
    columnDiv.appendChild(lengthLabel);

    // Poista-painike
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = getTranslationForKey('delete') || 'Poista';
    removeButton.style.backgroundColor = 'var(--button_bg_color)';
    removeButton.style.color = 'var(--button_text_color)';
    removeButton.addEventListener('mouseenter', () => {
        removeButton.style.backgroundColor = 'var(--button_hover_bg_color)';
        removeButton.style.color = 'var(--button_hover_text_color)';
    });
    removeButton.addEventListener('mouseleave', () => {
        removeButton.style.backgroundColor = 'var(--button_bg_color)';
        removeButton.style.color = 'var(--button_text_color)';
    });
    removeButton.addEventListener('click', () => {
        container.removeChild(columnDiv);
    });
    columnDiv.appendChild(removeButton);

    dataTypeSelect.addEventListener('change', () => {
        if (dataTypeSelect.value === 'VARCHAR') {
            lengthInput.style.display = 'inline-block';
            lengthInput.required = true;
        } else {
            lengthInput.style.display = 'none';
            lengthInput.required = false;
            lengthInput.value = '';
        }
    });

    container.appendChild(columnDiv);
}

async function addForeignKeyField(container) {
    if(!window.allTables) {
        window.allTables = await fetchTableNames();
    }

    const fkDiv = document.createElement('div');
    fkDiv.className = 'foreign-key-field';
    fkDiv.style.display = 'grid';
    fkDiv.style.gridTemplateColumns = 'auto auto';
    fkDiv.style.alignItems = 'center';
    fkDiv.style.border = '1px solid var(--table_border_color)';
    fkDiv.style.padding = '5px';

    // Referoiva sarake
    const referencingColumnLabel = document.createElement('label');
    referencingColumnLabel.textContent = getTranslationForKey('referencing_column') || 'Referoiva sarake: ';
    const referencingColumnSelect = document.createElement('select');
    referencingColumnSelect.name = 'fk_referencing_column';
    referencingColumnSelect.required = true;
    referencingColumnLabel.appendChild(referencingColumnSelect);
    fkDiv.appendChild(referencingColumnLabel);

    // Viitattava taulu
    const referencedTableLabel = document.createElement('label');
    referencedTableLabel.textContent = getTranslationForKey('referenced_table') || 'Viitattava taulu: ';
    const referencedTableSelect = document.createElement('select');
    referencedTableSelect.name = 'fk_referenced_table';
    referencedTableSelect.required = true;
    for (const t of window.allTables) {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        referencedTableSelect.appendChild(opt);
    }
    referencedTableLabel.appendChild(referencedTableSelect);
    fkDiv.appendChild(referencedTableLabel);

    // Viitattava sarake
    const referencedColumnLabel = document.createElement('label');
    referencedColumnLabel.textContent = getTranslationForKey('referenced_column') || 'Viitattava sarake: ';
    const referencedColumnSelect = document.createElement('select');
    referencedColumnSelect.name = 'fk_referenced_column';
    referencedColumnSelect.required = true;
    referencedColumnLabel.appendChild(referencedColumnSelect);
    fkDiv.appendChild(referencedColumnLabel);

    // Poista vierasavain -painike
    const removeFkButton = document.createElement('button');
    removeFkButton.type = 'button';
    removeFkButton.textContent = getTranslationForKey('delete') || 'Poista';
    removeFkButton.style.backgroundColor = 'var(--button_bg_color)';
    removeFkButton.style.color = 'var(--button_text_color)';
    removeFkButton.addEventListener('mouseenter', () => {
        removeFkButton.style.backgroundColor = 'var(--button_hover_bg_color)';
        removeFkButton.style.color = 'var(--button_hover_text_color)';
    });
    removeFkButton.addEventListener('mouseleave', () => {
        removeFkButton.style.backgroundColor = 'var(--button_bg_color)';
        removeFkButton.style.color = 'var(--button_text_color)';
    });
    removeFkButton.addEventListener('click', () => {
        container.removeChild(fkDiv);
    });
    fkDiv.appendChild(removeFkButton);

    referencedTableSelect.addEventListener('change', async () => {
        await updateReferencedColumnsDropdown(referencedTableSelect.value, referencedColumnSelect);
    });

    await updateReferencedColumnsDropdown(referencedTableSelect.value, referencedColumnSelect);
    updateReferencingColumnsDropdown(referencingColumnSelect);

    container.appendChild(fkDiv);
}

function updateReferencingColumnsDropdown(selectElement) {
    const columnInputs = document.querySelectorAll('#columns_container .column-field input[name="column_name"]');
    selectElement.replaceChildren();
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = getTranslationForKey('select_column') || '-- Valitse sarake --';
    selectElement.appendChild(emptyOption);
    columnInputs.forEach(input => {
        const trimmedVal = input.value.trim();
        if (trimmedVal) {
            const opt = document.createElement('option');
            opt.value = trimmedVal;
            opt.textContent = trimmedVal;
            selectElement.appendChild(opt);
        }
    });
}

async function updateReferencedColumnsDropdown(tableName, selectElement) {
    selectElement.replaceChildren();
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = getTranslationForKey('select_column') || '-- Valitse sarake --';
    selectElement.appendChild(emptyOption);

    try {
        // Käytetään uutta funktiota
        const columns_info = await fetch_columns_for_table(tableName);
        columns_info.forEach(col => {
            const option = document.createElement('option');
            option.value = col.column_name;
            option.textContent = col.column_name;
            selectElement.appendChild(option);
        });
    } catch (error) {
        console.error(`Virhe haettaessa sarakkeita taulusta ${tableName}:`, error);
    }
}

async function fetchTableNames() {
    const tables = await endpoint_router('datasetNames');
    return tables;
}

async function submitTableCreationForm(form) {
    const formData = new FormData(form);
    const result = buildTableCreationRequestData({
        tableName: formData.get('table_name'),
        columnNames: formData.getAll('column_name'),
        dataTypes: formData.getAll('data_type'),
        lengths: formData.getAll('length'),
        referencingColumns: formData.getAll('fk_referencing_column'),
        referencedTables: formData.getAll('fk_referenced_table'),
        referencedColumns: formData.getAll('fk_referenced_column'),
        grantUsersRead: form.querySelector('#grant_users_read').checked,
        grantGuestsRead: form.querySelector('#grant_guests_read').checked,
        preventDeletion: form.querySelector('#prevent_deletion').checked,
        folderId: formData.get('table_folder_id'),
        createFolderName: formData.get('create_table_new_folder_name'),
        createFolderParentId: formData.get('create_table_new_folder_parent_id'),
    });

    if (!result.ok) {
        showWarningToast(getTranslationForKey(result.warningKey) || result.warningFallback);
        return;
    }

    try {
        await endpoint_router('createDataset', {
            method: 'POST',
            body_data: result.requestData,
        });

        showSuccessToast(getTranslationForKey('table_created_successfully') || 'Taulu luotu onnistuneesti!');
        form.reset();
        // Palautetaan lomake oletustilaan
        const columnsContainer = document.getElementById('columns_container');
        columnsContainer.replaceChildren();
        default_auto_columns.forEach(ac => {
            addColumnField(columnsContainer, ac.column_name, ac.data_type);
        });
        addColumnField(columnsContainer);
        const fkContainer = document.getElementById('ct_foreign_keys_container');
        fkContainer.replaceChildren();
        const refreshedFolderOptions = await fetchFolderOptions({ forceRefresh: true });
        populateFolderSelect(document.getElementById('table_folder_id'), refreshedFolderOptions, {
            placeholder: getTranslationForKey('select_folder') || '-- Valitse kansio --',
        });
        populateFolderSelect(document.getElementById('create_table_new_folder_parent_id'), refreshedFolderOptions, {
            placeholder: getTranslationForKey('root_folder') || '-- Luo juureen --',
            includeRoot: true,
        });
        const refreshedFolderSelect = document.getElementById('table_folder_id');
        const refreshedParentSelect = document.getElementById('create_table_new_folder_parent_id');
        const refreshedFolderDefaults = resolveFolderSelectionDefaults(
            refreshedFolderOptions,
            refreshedFolderSelect?.value || ''
        );
        if (refreshedFolderSelect && refreshedFolderDefaults.existingFolderValue) {
            refreshedFolderSelect.value = refreshedFolderDefaults.existingFolderValue;
        }
        if (refreshedParentSelect && refreshedFolderDefaults.newFolderParentValue) {
            refreshedParentSelect.value = refreshedFolderDefaults.newFolderParentValue;
        }

        // Refresh the nav tree after the folder option cache has been refreshed so sibling admin views stay aligned.
        try { await initializeTreeCallAdmin({ forceRefresh: true }); } catch (e) { console.warn('Nav tree refresh after table creation failed:', e); }
        
    } catch (error) {
        console.debug('Virhe taulua luodessa:', error);

    }
}
