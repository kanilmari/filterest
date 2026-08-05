// notification_triggers.js
// Renders the admin view for managing notification trigger configurations.
// Bridges trigger-management forms, dataset metadata, and backend trigger endpoints into one UI flow.
// Exists to centralize notification-trigger maintenance instead of spreading it across ad hoc admin tools.

import { loadManagementView } from '../../reusable_components/dom_container_builder.js';
import { createVanillaDropdown } from '../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js';
import { fetch_columns_for_table } from '../endpoints/endpoint_column_fetcher.js';
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { showSuccessToast } from '../../reusable_components/notifications/toast_notification_printer.js';
import { getTranslationForKey } from '../lang/translation_handler.js';
import { buildTriggerFormData } from './notification_triggers_helpers.js';

export async function load_trigger_management() {
  return loadManagementView('trigger_management_container', generate_notification_trigger_view);
}

/**
 * generate_trigger_creation_form:
 * Luodaan lomake, jossa:
 * 1) Valitaan lähdetaulu (dropdown + haku), sen sarake, operaattori, arvo
 * 2) Valitaan kohdetaulu (dropdown + haku)
 * 3) Lisätään n kappaletta (sarake+arvo)-paitoja
 * 4) Luodaan “Luo heräte” -painike
 */
export async function generate_notification_trigger_view(container) {
  // Haetaan kaikki taulut
  const content_tables = await fetchContentTables();

  // Luodaan <form>
  const form = createForm();

  // 1) Lähdetauludropdown + conditionContainer (sarake, operaattori, arvo)
  const sourceTableObj = createSourceTableDropdown(content_tables);
  form.appendChild(sourceTableObj.container);

  // “condition_container”: sarake + operator + value
  const conditionObj = createConditionContainer();
  form.appendChild(conditionObj.container);

  // 2) Kohdetauludropdown
  const targetTableObj = createTargetTableDropdown(content_tables);
  form.appendChild(targetTableObj.container);

  // “action_values_container”: n kpl “Kohdesarake + Kohdearvo” -rivejä
  const actionValuesContainer = createActionValuesContainer();
  form.appendChild(actionValuesContainer.container);

  // 3) Submit-painike
  const submitButton = createSubmitButton();
  form.appendChild(submitButton);

  // Lomakkeen rungon lisäys DOM:iin
  container.appendChild(form);

  // Options were already set via content_tables parameter in createSourceTableDropdown / createTargetTableDropdown

  // Aluksi lisätään 1 kpl actionValue-rivi
  addActionValueRow(actionValuesContainer, targetTableObj.dropdown);

  // Lähdetaulun dropdown “onChange” -> conditionObj päivitetään
  // Kohdetaulun “onChange” -> actionValue-rivit päivitetään
  // + Tapahtumankuuntelija “Lisää sarake-arvo -pari” -painikkeelle
  actionValuesContainer.add_button.addEventListener('click', () => {
    addActionValueRow(actionValuesContainer, targetTableObj.dropdown);
  });

  // + Lomakkeen submit
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await create_trigger();
  });
}

/* ------------------------------------------------------------------
   API-funktiot
------------------------------------------------------------------ */

/**
 * Hakee kaikki datasetit api-endpointista
 */
export async function fetchContentTables() {
  try {
    // Käytetään endpoint_router:ia
    const result = await endpoint_router('fetchContentTables');

    // Vastauksessa voi olla avain "datasets" tai vanha "tables"
    const datasetsOrTables = result.datasets || result.tables || {};
    const all_tables_from_all_groups = Object.values(datasetsOrTables).flat();
    return all_tables_from_all_groups;
  } catch (err) {
    console.warn('Virhe taulujen haussa:', err);
    throw new Error('Failed to fetch content tables');
  }
}

/* ------------------------------------------------------------------
   DOM-rakenteen luontifunktiot
------------------------------------------------------------------ */

function createForm() {
  const form = document.createElement('form');
  form.id = 'trigger_creation_form';
  return form;
}

/**
 * createSourceTableDropdown:
 *  - Sisältää pienen label + p -kuvauksen + container, johon luodaan vanilla_dropdown (haulla).
 * @param {Array} content_tables - List of tables to populate the dropdown initially.
 */
function createSourceTableDropdown(content_tables) {
  const container = document.createElement('div');

  const label = document.createElement('label');
  label.textContent = getTranslationForKey('source_table') || 'Lähdetaulu:';
  container.appendChild(label);

  const description = document.createElement('p');
  description.textContent = getTranslationForKey('trigger_description') || 'Kun lähdetauluun lisätään tietty arvo, kohdetauluun luodaan automaattisesti haluttu rivi.';
  container.appendChild(description);

  // Vanilla-dropdownin container
  const dropdownContainer = document.createElement('div');
  dropdownContainer.id = 'source_table_dropdown_container';
  container.appendChild(dropdownContainer);

  // Luodaan varsinainen dropdown
  const dropdown = createVanillaDropdown({
    containerElement: dropdownContainer,
    options: content_tables ? mapTablesToOptions(content_tables) : [],
    placeholder: getTranslationForKey('select_source_table') || "Valitse lähdetaulu...",
    searchPlaceholder: getTranslationForKey('search_table') || "Hae taulua...",
    useSearch: true,
    onChange: async (selectedTableName) => {
      if (selectedTableName) {
        const columns = await fetch_columns_for_table(selectedTableName);
        updateColumnsAndOperators(columns);
      } else {
        updateColumnsAndOperators([]);
      }
    }
  });

  async function updateColumnsAndOperators(columns) {
    const conditionContainerEl = document.getElementById('condition_container');
    if (!conditionContainerEl) return;

    const condObj = conditionContainerEl.__conditionObj;
    if (!condObj) return;

    const validCols = columns.filter(col => !shouldExcludeColumn(col));
    const colOptions = validCols.map(col => ({
      value: col.column_name,
      label: col.column_name,
      dataType: col.data_type
    }));

    condObj.columnDropdown.setOptions(colOptions);
  }

  return {
    container,
    dropdown
  };
}

/**
 * createConditionContainer:
 *  - Sarake (vanilla_dropdown)
 *  - Operaattori (vanilla_dropdown)
 *  - Arvo (input type=??)
 */
function createConditionContainer() {
  const container = document.createElement('div');
  container.id = 'condition_container';

  // Sarakevalinta
  const columnLabel = document.createElement('label');
  columnLabel.textContent = getTranslationForKey('source_column') || 'Lähdesarake:';
  container.appendChild(columnLabel);

  const columnDropdownContainer = document.createElement('div');
  container.appendChild(columnDropdownContainer);

  const columnDropdown = createVanillaDropdown({
    containerElement: columnDropdownContainer,
    options: [],
    placeholder: getTranslationForKey('select_column') || "Valitse sarake...",
    useSearch: true,
    onChange: () => {
      updateOperators();
    }
  });

  // Operaattorivalinta
  const operatorLabel = document.createElement('label');
  operatorLabel.textContent = getTranslationForKey('source_value_operator') || 'Lähdearvon operaattori:';
  container.appendChild(operatorLabel);

  const operatorDropdownContainer = document.createElement('div');
  container.appendChild(operatorDropdownContainer);

  const operatorDropdown = createVanillaDropdown({
    containerElement: operatorDropdownContainer,
    options: [],
    placeholder: getTranslationForKey('select_operator') || "Valitse operaattori...",
    useSearch: false,
    onChange: () => {
    }
  });

  // Arvo-input
  const valueLabel = document.createElement('label');
  valueLabel.textContent = getTranslationForKey('source_value') || 'Lähdearvo:';
  container.appendChild(valueLabel);

  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.id = 'value_input';
  valueLabel.appendChild(valueInput);

  function updateOperators() {
    const colVal = columnDropdown.getValue();
    if (!colVal) return;

    const colObj = columnDropdown.__options?.find(o => o.value === colVal);
    const data_type = colObj?.dataType || 'text';

    let operators = [];
    if (['integer', 'numeric', 'double_precision', 'real', 'smallint', 'bigint'].includes(data_type)) {
      operators = ['=', '!=', '>', '<', '>=', '<='];
      valueInput.type = 'number';
    } else if (['character_varying', 'text', 'varchar'].includes(data_type)) {
      operators = ['=', '!=', 'ILIKE', 'NOT ILIKE'];
      valueInput.type = 'text';
    } else if (['boolean'].includes(data_type)) {
      operators = ['='];
      valueInput.type = 'checkbox';
    } else {
      operators = ['='];
      valueInput.type = 'text';
    }

    const operatorOpts = operators.map(op => ({ value: op, label: op }));
    operatorDropdown.setOptions(operatorOpts);
  }

  container.__conditionObj = {
    container,
    columnDropdown,
    operatorDropdown,
    valueInput
  };

  return container.__conditionObj;
}

/**
 * createTargetTableDropdown
 * @param {Array} content_tables - List of tables to populate the dropdown initially.
 */
function createTargetTableDropdown(content_tables) {
  const container = document.createElement('div');

  const label = document.createElement('label');
  label.textContent = getTranslationForKey('target_table') || 'Kohdetaulu:';
  container.appendChild(label);

  const dropdownContainer = document.createElement('div');
  dropdownContainer.id = 'target_table_dropdown_container';
  container.appendChild(dropdownContainer);

  const dropdown = createVanillaDropdown({
    containerElement: dropdownContainer,
    options: content_tables ? mapTablesToOptions(content_tables) : [],
    placeholder: getTranslationForKey('select_target_table') || "Valitse kohdetaulu...",
    searchPlaceholder: getTranslationForKey('search_table') || "Hae taulua...",
    useSearch: true,
    onChange: async (_selectedTableName) => {
      const actionValuesEl = document.getElementById('action_values_container');
      if (!actionValuesEl) return;
      await updateAllActionColumns(actionValuesEl, dropdown);
    }
  });

  return {
    container,
    dropdown
  };
}

function createActionValuesContainer() {
  const container = document.createElement('div');
  container.id = 'action_values_container';

  const label = document.createElement('label');
  label.textContent = getTranslationForKey('action_values') || 'Toiminnon arvot:';
  container.appendChild(label);

  const list = document.createElement('div');
  list.id = 'action_values_list';
  container.appendChild(list);

  const add_button = document.createElement('button');
  add_button.type = 'button';
  add_button.dataset.langKey = 'add_column_value_pair';
  container.appendChild(add_button);

  return {
    container,
    list,
    add_button
  };
}

function createSubmitButton() {
  const submit_button = document.createElement('button');
  submit_button.type = 'submit';
  submit_button.textContent = getTranslationForKey('create_trigger') || 'Luo heräte';
  return submit_button;
}

/* ------------------------------------------------------------------
   Action Values -rivien hallintafunktiot
------------------------------------------------------------------ */

async function addActionValueRow(action_values_container, target_table_dropdown) {
  const action_value_row = document.createElement('div');
  action_value_row.classList.add('action_value_row');

  // Sarakevalinta
  const column_label = document.createElement('label');
  column_label.textContent = getTranslationForKey('target_column') || 'Kohdesarake: ';
  action_value_row.appendChild(column_label);

  const columnDropdownContainer = document.createElement('div');
  columnDropdownContainer.classList.add('action_column_dropdown_container');
  action_value_row.appendChild(columnDropdownContainer);

  const columnDropdown = createVanillaDropdown({
    containerElement: columnDropdownContainer,
    options: [],
    placeholder: getTranslationForKey('select_column') || "Valitse sarake...",
    useSearch: false
  });
  columnDropdownContainer.__dropdown = columnDropdown;

  const value_label = document.createElement('label');
  value_label.textContent = getTranslationForKey('target_value') || 'Kohdearvo: ';
  const value_input = document.createElement('input');
  value_input.type = 'text';
  value_input.classList.add('action_value_input');
  value_label.appendChild(value_input);
  action_value_row.appendChild(value_label);

  const remove_button = document.createElement('button');
  remove_button.type = 'button';
  remove_button.dataset.langKey = 'delete';
  remove_button.addEventListener('click', () => {
    action_value_row.remove();
  });
  action_value_row.appendChild(remove_button);

  action_values_container.list.appendChild(action_value_row);

  const selectedTargetTable = target_table_dropdown.getValue();
  if (selectedTargetTable) {
    await updateActionColumns(columnDropdown, selectedTargetTable);
  }
}

async function updateActionColumns(columnDropdown, tableName) {
  if (!tableName) return;
  const columns = await fetch_columns_for_table(tableName);
  const validCols = columns.filter(col => !shouldExcludeColumn(col));
  const dropdownOptions = validCols.map(col => ({
    value: col.column_name,
    label: col.column_name
  }));
  columnDropdown.setOptions(dropdownOptions);
}

async function updateAllActionColumns(action_values_container, target_table_dropdown) {
  const selectedTable = target_table_dropdown.getValue();
  if (!selectedTable) return;

  const containers = action_values_container.querySelectorAll('.action_column_dropdown_container');
  for (const c of containers) {
    if (c.__dropdown) {
      await updateActionColumns(c.__dropdown, selectedTable);
    }
  }
}

/* ------------------------------------------------------------------
   Yleishyödylliset
------------------------------------------------------------------ */
function shouldExcludeColumn(col) {
  if (col.column_default && col.column_default.startsWith('nextval(')) {
    return true;
  }
  if (col.is_identity === 'YES') {
    return true;
  }
  if (col.computed_definition) {
    return true;
  }
  return false;
}

function mapTablesToOptions(content_tables) {
  return content_tables.map(t => {
    const name = t.dataset_name || t.table_name;
    return {
      value: name,
      label: name,
    };
  });
}

/* ------------------------------------------------------------------
   Trigger-luontilogiikka
------------------------------------------------------------------ */

async function create_trigger() {
  const data = getFormData();

  try {
    await endpoint_router('createTrigger', {
      method: 'POST',
      body_data: data,
    });
    showSuccessToast(getTranslationForKey('trigger_created_successfully') || "Heräte luotu onnistuneesti!");
  } catch (err) {
    console.warn("Virhe herätettä luodessa:", err);
  }
}

function getFormData() {
  const sourceTableDd = document.getElementById('source_table_dropdown_container');
  let source_table = null;
  if (sourceTableDd && sourceTableDd.__dropdown) {
    source_table = sourceTableDd.__dropdown.getValue();
  }

  const condEl = document.getElementById('condition_container');
  let column = null;
  let operator = null;
  let value = null;
  if (condEl && condEl.__conditionObj) {
    column = condEl.__conditionObj.columnDropdown.getValue();
    operator = condEl.__conditionObj.operatorDropdown.getValue();
    const valInput = condEl.__conditionObj.valueInput;
    if (valInput.type === 'checkbox') {
      value = valInput.checked;
    } else {
      value = valInput.value;
    }
  }

  const targetTableDd = document.getElementById('target_table_dropdown_container');
  let target_table = null;
  if (targetTableDd && targetTableDd.__dropdown) {
    target_table = targetTableDd.__dropdown.getValue();
  }

  const action_values = collectActionValues();

  return buildTriggerFormData({
    sourceTable: source_table,
    column,
    operator,
    value,
    valueType: condEl?.__conditionObj?.valueInput?.type,
    targetTable: target_table,
    actionValues: action_values,
  });
}

function collectActionValues() {
  const result = {};
  const rows = document.querySelectorAll('.action_value_row');
  rows.forEach(row => {
    const colContainer = row.querySelector('.action_column_dropdown_container');
    const valInput = row.querySelector('.action_value_input');
    if (colContainer && colContainer.__dropdown) {
      const colName = colContainer.__dropdown.getValue();
      if (colName) {
        result[colName] = valInput.value;
      }
    }
  });
  return result;
}
