// view_field_assignments_layout.js
// Builds the static controls and element references for the view-field assignment administrator.
// Bridges localized copy and view metadata with the stateful workflow orchestrator.
// Exists so DOM composition stays separate from loading, mutation, and readback behavior.

import {
    getDatasetViewLabelForLanguage,
    RENDERABLE_DATASET_VIEW_DEFINITIONS,
} from "../table_views/dataset_view_registry.js";
import { createSymbolMaskElement } from "../../reusable_components/symbol_asset_resolver.js";
import {
    createViewAssignmentTextElement as createTextElement,
} from "./view_field_assignments_dom.js";

/**
 * Build one administrator page shell without owning its mutable assignment state.
 * Returns stable element references used by the workflow orchestrator.
 */
export function createViewFieldAssignmentsLayout(
    container,
    { text, language, rememberedViewKey = "" }
) {
    const page = document.createElement("section");
    page.className = "view-field-assignments";
    page.dataset.testid = "view-field-assignments";
    const heading = createTextElement(
        "h2",
        "view-field-assignments__title",
        text.title,
        "view_field_settings"
    );
    const description = createTextElement(
        "p",
        "view-field-assignments__description",
        text.description,
        "view_field_assignments_description"
    );
    page.append(heading, description);

    const layout = document.createElement("div");
    layout.className = "view-field-assignments__layout";
    const treePanel = document.createElement("aside");
    treePanel.className = "view-field-assignments__tree-panel";
    const treeHost = document.createElement("div");
    treeHost.id = "view_field_assignments_dataset_tree";
    treePanel.appendChild(treeHost);
    const editor = document.createElement("div");
    editor.className = "view-field-assignments__editor";
    layout.append(treePanel, editor);
    page.appendChild(layout);
    container.appendChild(page);

    const controls = document.createElement("div");
    controls.className = "view-field-assignments__controls";
    const viewLabel = createTextElement(
        "label",
        "view-field-assignments__label",
        text.view,
        "view_field_assignments_view"
    );
    viewLabel.htmlFor = "view_field_assignments_view_select";
    const viewSelect = document.createElement("select");
    viewSelect.id = "view_field_assignments_view_select";
    viewSelect.className = "view-field-assignments__select";
    viewSelect.dataset.testid = "view-field-assignments-view";
    for (const definition of RENDERABLE_DATASET_VIEW_DEFINITIONS) {
        const option = document.createElement("option");
        option.value = definition.viewKey;
        option.dataset.langKey = definition.langKey;
        option.textContent = getDatasetViewLabelForLanguage(definition.viewKey, language);
        viewSelect.appendChild(option);
    }
    if (Array.from(viewSelect.options).some((option) => option.value === rememberedViewKey)) {
        viewSelect.value = rememberedViewKey;
    }
    controls.append(viewLabel, viewSelect);

    const groupLabel = createTextElement(
        "label",
        "view-field-assignments__label",
        text.groups,
        "view_field_assignments_groups"
    );
    groupLabel.htmlFor = "view_field_assignments_group_picker";
    const groupPickerHost = document.createElement("div");
    groupPickerHost.id = "view_field_assignments_group_picker";
    groupPickerHost.className = "view-field-assignments__group-picker";
    groupPickerHost.dataset.testid = "view-field-assignments-groups";
    controls.append(groupLabel, groupPickerHost);

    const targetStatus = createTextElement("p", "view-field-assignments__target-status", "");
    targetStatus.setAttribute("role", "status");
    const selectionWarning = createTextElement(
        "p",
        "view-field-assignments__selection-warning",
        text.noGroups,
        "view_field_assignments_select_group"
    );
    selectionWarning.hidden = true;
    selectionWarning.setAttribute("role", "status");
    controls.append(targetStatus, selectionWarning);

    const nameLabel = createTextElement(
        "label",
        "view-field-assignments__label",
        text.name,
        "view_field_assignments_name"
    );
    nameLabel.htmlFor = "view_field_assignments_name";
    const nameInput = document.createElement("input");
    nameInput.id = "view_field_assignments_name";
    nameInput.className = "view-field-assignments__input";
    nameInput.maxLength = 128;
    nameInput.dataset.testid = "view-field-assignments-name";
    controls.append(nameLabel, nameInput);

    const priorityRow = document.createElement("div");
    priorityRow.className = "view-field-assignments__priority-row";
    const priorityLabelRow = document.createElement("div");
    priorityLabelRow.className = "view-field-assignments__priority-label-row";
    const priorityLabel = createTextElement(
        "label",
        "view-field-assignments__label",
        text.priority,
        "view_field_assignments_priority"
    );
    priorityLabel.htmlFor = "view_field_assignments_priority";
    const priorityHelpButton = document.createElement("button");
    priorityHelpButton.type = "button";
    priorityHelpButton.className = "view-field-assignments__priority-help-button";
    priorityHelpButton.dataset.testid = "view-field-assignments-priority-help-button";
    priorityHelpButton.dataset.ariaLabelLangKey = "view_field_assignments_priority_help_label";
    priorityHelpButton.setAttribute("aria-label", text.priorityHelpLabel);
    priorityHelpButton.setAttribute("aria-expanded", "false");
    priorityHelpButton.setAttribute("aria-controls", "view_field_assignments_priority_help");
    priorityHelpButton.appendChild(createSymbolMaskElement(
        "info",
        "view-field-assignments__priority-help-icon"
    ));
    priorityLabelRow.append(priorityLabel, priorityHelpButton);
    const priorityInput = document.createElement("input");
    priorityInput.id = "view_field_assignments_priority";
    priorityInput.type = "number";
    priorityInput.min = "-1000000";
    priorityInput.max = "1000000";
    priorityInput.step = "1";
    priorityInput.className = "view-field-assignments__priority";
    priorityInput.dataset.testid = "view-field-assignments-priority";
    const priorityHelp = createTextElement(
        "p",
        "view-field-assignments__priority-help",
        text.priorityHelp,
        "view_field_assignments_priority_help"
    );
    priorityHelp.id = "view_field_assignments_priority_help";
    priorityHelp.dataset.testid = "view-field-assignments-priority-help";
    priorityHelp.hidden = true;
    priorityHelpButton.addEventListener("click", () => {
        priorityHelp.hidden = !priorityHelp.hidden;
        priorityHelpButton.setAttribute("aria-expanded", String(!priorityHelp.hidden));
    });
    priorityRow.append(priorityLabelRow, priorityInput, priorityHelp);
    controls.appendChild(priorityRow);

    const mixedWarning = createTextElement(
        "p",
        "view-field-assignments__mixed-warning",
        text.mixed,
        "view_field_assignments_mixed_warning"
    );
    mixedWarning.dataset.testid = "view-field-assignments-mixed";
    mixedWarning.setAttribute("role", "alert");
    mixedWarning.hidden = true;
    controls.appendChild(mixedWarning);
    editor.appendChild(controls);

    const fieldsHeader = document.createElement("div");
    fieldsHeader.className = "view-field-assignments__fields-header";
    fieldsHeader.appendChild(createTextElement(
        "h3",
        "view-field-assignments__fields-title",
        text.fields,
        "view_field_assignments_fields"
    ));
    const fieldSearch = document.createElement("input");
    fieldSearch.type = "search";
    fieldSearch.className = "view-field-assignments__field-search";
    fieldSearch.placeholder = text.fieldSearch;
    fieldSearch.dataset.langKey = "view_field_assignments_search_fields";
    fieldSearch.setAttribute("aria-label", text.fieldSearch);
    fieldSearch.dataset.testid = "view-field-assignments-field-search";
    fieldsHeader.appendChild(fieldSearch);
    editor.appendChild(fieldsHeader);

    const fieldList = document.createElement("ol");
    fieldList.className = "view-field-assignments__field-list";
    fieldList.dataset.testid = "view-field-assignments-field-list";
    editor.appendChild(fieldList);

    const fieldWarning = createTextElement(
        "p",
        "view-field-assignments__field-warning",
        text.noVisible,
        "view_field_assignments_select_field"
    );
    fieldWarning.dataset.testid = "view-field-assignments-field-warning";
    fieldWarning.setAttribute("role", "status");
    fieldWarning.hidden = true;
    editor.appendChild(fieldWarning);

    const status = createTextElement(
        "p",
        "view-field-assignments__status",
        text.instructions,
        "view_field_assignments_instructions"
    );
    status.setAttribute("role", "status");
    status.dataset.testid = "view-field-assignments-status";
    editor.appendChild(status);

    const actions = document.createElement("div");
    actions.className = "view-field-assignments__actions";
    const restoreButton = createTextElement(
        "button",
        "fw-btn view-field-assignments__button",
        text.restore,
        "view_field_assignments_restore"
    );
    restoreButton.type = "button";
    restoreButton.dataset.testid = "view-field-assignments-restore";
    const saveButton = createTextElement(
        "button",
        "fw-btn fw-btn--primary view-field-assignments__button",
        text.save,
        "view_field_assignments_save"
    );
    saveButton.type = "button";
    saveButton.dataset.testid = "view-field-assignments-save";
    actions.append(restoreButton, saveButton);
    editor.appendChild(actions);

    return {
        fieldList,
        fieldSearch,
        fieldWarning,
        groupPickerHost,
        mixedWarning,
        nameInput,
        page,
        priorityInput,
        priorityRow,
        restoreButton,
        saveButton,
        selectionWarning,
        status,
        targetStatus,
        treeHost,
        viewSelect,
    };
}
