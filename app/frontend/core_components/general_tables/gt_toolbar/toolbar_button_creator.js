// toolbar_button_creator.js
// Creates and configures toolbar action buttons (add row, delete, column management).
// Bridges row CRUD handlers and column editor into the table toolbar UI element.
// Exists to keep button wiring and rendering logic out of the main toolbar assembly.

import { open_add_row_modal } from "../gt_1_row_crud/gt_1_1_row_create/row_creation_handler.js";
import { delete_selected_items } from "../gt_1_row_crud/gt_1_4_row_delete/row_remover.js";
import { open_column_management_modal } from "../gt_2_column_crud/column_manager.js";
import { createMaskIconSpan } from "../../../icons/icon_mask_builder.js";

/**
 * Luo nappi rivin lisäämiseen
 */
export function createAddRowButton(table_uid, table_name) {
    const button = document.createElement("button");
    button.dataset.langKey = "add_row_" + table_name;
    button.dataset.langKeyFallback = "add_row";
    button.dataset.testid = "btn-add-row";
    button.classList.add("add_row_button");
    button.classList.add("button");
    button.classList.add("fw-btn");
    button.addEventListener("click", () => open_add_row_modal(table_uid, table_name));

    return button;
}

/**
 * Luo nappi valittujen rivien poistamiseen
 */
export function createDeleteSelectedButton(table_name, current_view) {
    const button = document.createElement("button");
    button.dataset.testid = "btn-delete-row";
    button.classList.add("delete_selected_button");
    button.classList.add("button");
    button.classList.add("fw-btn");

    button.appendChild(
        createMaskIconSpan('/frontend/icons/general/trash-icon.svg', ['delete-selected-icon'])
    );

    // Luodaan tekstisolmu käyttäen langKey-kääntämistä
    const btnText = document.createElement('span');
    btnText.dataset.langKey = 'delete_selected';
    button.appendChild(btnText);

    // Klikattaessa kutsutaan delete_selected_items
    button.addEventListener("click", () =>
        delete_selected_items(table_name, current_view)
    );

    return button;
}

// /**
//  * Luo column visibility -dropdownin (näkyvät sarakkeet).
//  */
// export function createColumnVisibilityDropdownButton(tableContainer) {
//     const dropdown = createColumnVisibilityDropdown(tableContainer);
//     return dropdown || null;
// }

/**
 * Luo napin taulun column-managementtiä varten.
 */
export function createColumnManagementButton(table_name) {
    const button = document.createElement("button");
    button.dataset.testid = "btn-edit-table";
    button.classList.add("column_management_button");
    button.classList.add("fw-btn");
    button.dataset.langKey = "manage_table_short";
    button.addEventListener("click", () => {
        open_column_management_modal(table_name);
    });

    return button;
}
