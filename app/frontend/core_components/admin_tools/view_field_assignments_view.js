// view_field_assignments_view.js
// Renders the administrator page for assigning ordered visible fields by dataset view and user group.
// Bridges the dataset tree, renderable-view registry, group picker, and stable field-set endpoints.
// Exists so site and group presentation defaults can be managed without becoming field authorization rules.

import {
    getViewFieldSets,
    resetSharedViewFieldSet,
    saveSiteViewFieldSet,
} from "../endpoints/stable_endpoint_router.js";
import { getLanguageWithBrowserFallback } from "../state_stores/lang_preference_reader.js";
import { render_tree } from "../../reusable_components/vanilla_tree/vanilla_tree_builder.js";
import { createMultiselectDropdown } from "../../reusable_components/multiselect_dropdown/multiselect_dropdown_builder.js";
import { showConfirmModal } from "../../reusable_components/modal/confirm_modal_builder.js";
import {
    showSuccessToast,
    showWarningToast,
} from "../../reusable_components/notifications/toast_notification_printer.js";
import { extractFirstSelectedTableName } from "./tree_selection_helpers.js";
import {
    assertViewFieldAssignmentsResponseTarget as assertResponseTarget,
    availableViewAssignmentFields as availableFieldsFromResponse,
    createViewAssignmentTextElement as createTextElement,
} from "./view_field_assignments_dom.js";
import {
    getViewFieldAssignmentsCancelText,
    getViewFieldAssignmentsCopy,
} from "./view_field_assignments_copy.js";
import { createViewFieldAssignmentsLayout } from "./view_field_assignments_layout.js";
import {
    buildEditorFieldRows,
    buildMixedGroupViewFieldSetSavePayload,
    buildViewFieldSetSavePayload,
    cycleFieldVisibility,
    everyGroupVariantHasVisibleColumns,
    groupVariantsFromRows,
    moveFieldRow,
    moveFieldRowBefore,
    normalizeGroupAssignments,
    resetAssignmentMatches,
    resolveAssignmentTarget,
    resolveEditorAssignment,
    savedAssignmentMatches,
    savedGroupVariantsMatch,
    visibleColumnsFromRows,
} from "./view_field_assignments_state.js";

const VIEW_FIELD_ASSIGNMENTS_SESSION_KEY = "view_field_assignments_admin_session_v1";
const MAX_REMEMBERED_FIELD_ORDERS = 40;

function readRememberedAdminState() {
    try {
        const parsed = JSON.parse(sessionStorage.getItem(VIEW_FIELD_ASSIGNMENTS_SESSION_KEY) || "{}");
        const hasGroupSelection = Object.prototype.hasOwnProperty.call(parsed, "selectedGroupIDs");
        return {
            viewKey: String(parsed?.viewKey || ""),
            hasGroupSelection,
            selectedGroupIDs: hasGroupSelection && Array.isArray(parsed.selectedGroupIDs)
                ? parsed.selectedGroupIDs.map(String)
                : [],
            fieldOrders: parsed?.fieldOrders && typeof parsed.fieldOrders === "object"
                ? { ...parsed.fieldOrders }
                : {},
        };
    } catch {
        return {
            viewKey: "",
            hasGroupSelection: false,
            selectedGroupIDs: [],
            fieldOrders: {},
        };
    }
}

function writeRememberedAdminState(state) {
    try {
        const serializedState = {
            viewKey: String(state.viewKey || ""),
            fieldOrders: state.fieldOrders || {},
        };
        if (state.hasGroupSelection) {
            serializedState.selectedGroupIDs = Array.isArray(state.selectedGroupIDs)
                ? state.selectedGroupIDs.map(String)
                : [];
        }
        sessionStorage.setItem(VIEW_FIELD_ASSIGNMENTS_SESSION_KEY, JSON.stringify(serializedState));
    } catch {
        // The editor remains fully usable when browser storage is unavailable.
    }
}

function fieldOrderMemoryKey(dataset, viewKey, assignment) {
    if (!dataset || !viewKey || !assignment) return "";
    const target = assignment.targetScope === "site"
        ? "site"
        : `groups:${assignment.selectedGroupIDs.join(",")}`;
    return `${dataset}|${viewKey}|${target}`;
}

/**
 * Builds the complete administrator workflow for site and group field defaults.
 * Dataset and group choices stay page-local while every mutation is verified by GET.
 * This keeps preview state out of localStorage and fails closed on confused readback.
 */
export async function generate_view_field_assignments_view(container) {
    if (!container) return;
    container.__cleanupListeners?.();
    container.replaceChildren();

    const language = getLanguageWithBrowserFallback();
    const text = getViewFieldAssignmentsCopy(language);
    const listenerController = new AbortController();
    const rememberedAdminState = readRememberedAdminState();
    let groupPicker = null;
    let dataset = "";
    let response = null;
    let groups = [];
    let selectedGroupIDs = [...rememberedAdminState.selectedGroupIDs];
    let hasRememberedGroupSelection = rememberedAdminState.hasGroupSelection;
    let rememberedFieldOrders = { ...rememberedAdminState.fieldOrders };
    let fieldRows = [];
    let editorAssignment = null;
    let draggedFieldName = "";
    let loadSequence = 0;

    const {
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
    } = createViewFieldAssignmentsLayout(container, {
        text,
        language,
        rememberedViewKey: rememberedAdminState.viewKey,
    });

    function persistAdminState() {
        writeRememberedAdminState({
            viewKey: viewSelect.value,
            hasGroupSelection: hasRememberedGroupSelection,
            selectedGroupIDs,
            fieldOrders: rememberedFieldOrders,
        });
    }

    function rememberCurrentFieldOrder() {
        const memoryKey = fieldOrderMemoryKey(dataset, viewSelect.value, editorAssignment);
        if (!memoryKey || fieldRows.length === 0) return;
        rememberedFieldOrders[memoryKey] = fieldRows.map((field) => field.name);
        const rememberedEntries = Object.entries(rememberedFieldOrders);
        if (rememberedEntries.length > MAX_REMEMBERED_FIELD_ORDERS) {
            rememberedFieldOrders = Object.fromEntries(
                rememberedEntries.slice(-MAX_REMEMBERED_FIELD_ORDERS)
            );
        }
        persistAdminState();
    }

    function setBusy(isBusy) {
        const hasVisibleField = hasValidVisibleFieldDraft();
        page.setAttribute("aria-busy", String(isBusy));
        viewSelect.disabled = isBusy;
        groupPicker?.setDisabled?.(isBusy);
        saveButton.disabled = isBusy || !editorAssignment?.mutationAllowed || !hasVisibleField;
        restoreButton.disabled = isBusy || !editorAssignment?.mutationAllowed;
    }

    function currentGroupVariants() {
        return groupVariantsFromRows(
            fieldRows,
            editorAssignment,
            priorityInput.value.trim()
        );
    }

    function hasValidVisibleFieldDraft() {
        if (editorAssignment?.mixed) {
            return everyGroupVariantHasVisibleColumns(currentGroupVariants());
        }
        return visibleColumnsFromRows(fieldRows).length > 0;
    }

    function defaultFieldSetName(target) {
        const suffix = target.targetScope === "site" ? text.targetSite : text.targetGroups;
        return `${dataset} · ${viewSelect.value} · ${suffix}`.slice(0, 128);
    }

    function syncMutationControls() {
        const mutationAllowed = Boolean(editorAssignment?.mutationAllowed);
        const hasVisibleField = hasValidVisibleFieldDraft();
        saveButton.disabled = !mutationAllowed || !hasVisibleField;
        restoreButton.disabled = !mutationAllowed;
        nameInput.disabled = !mutationAllowed;
        priorityInput.disabled = !mutationAllowed || editorAssignment?.targetScope !== "groups";
        priorityRow.hidden = editorAssignment?.targetScope !== "groups";
        selectionWarning.hidden = mutationAllowed;
        fieldWarning.hidden = !mutationAllowed || hasVisibleField;
        targetStatus.textContent = editorAssignment?.targetScope === "site"
            ? text.targetSite
            : text.targetGroups;
        targetStatus.dataset.langKey = editorAssignment?.targetScope === "site"
            ? "view_field_assignments_target_site"
            : "view_field_assignments_target_groups";
        mixedWarning.hidden = !editorAssignment?.mixed;
    }

    function renderFieldRows() {
        fieldList.replaceChildren();
        const searchTerm = fieldSearch.value.trim().toLocaleLowerCase();
        fieldRows.forEach((field, index) => {
            const searchableText = `${field.name} ${field.columnUID || ""}`.toLocaleLowerCase();
            if (searchTerm && !searchableText.includes(searchTerm)) return;

            const row = document.createElement("li");
            row.className = "view-field-assignments__field-row";
            row.draggable = true;
            row.dataset.fieldName = field.name;
            const dragHandle = createTextElement("span", "view-field-assignments__drag-handle", "☷");
            dragHandle.title = text.drag;
            dragHandle.dataset.titleLangKey = "view_field_assignments_drag";
            dragHandle.setAttribute("aria-hidden", "true");
            const fieldIdentity = document.createElement("span");
            fieldIdentity.className = "view-field-assignments__field-identity";
            fieldIdentity.appendChild(createTextElement("strong", "", field.name));
            if (field.columnUID) {
                fieldIdentity.appendChild(createTextElement("small", "", `UID ${field.columnUID}`));
            }
            const visibility = document.createElement("label");
            visibility.className = "view-field-assignments__visibility";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.dataset.testid = "view-field-assignment-visible";
            const syncCheckboxState = () => {
                checkbox.indeterminate = field.visibilityState === "mixed";
                checkbox.checked = field.visibilityState === "visible";
                checkbox.setAttribute(
                    "aria-checked",
                    field.visibilityState === "mixed" ? "mixed" : String(checkbox.checked)
                );
            };
            syncCheckboxState();
            checkbox.addEventListener("change", () => {
                Object.assign(field, cycleFieldVisibility(field));
                syncCheckboxState();
                rememberCurrentFieldOrder();
                syncMutationControls();
            });
            visibility.append(checkbox, createTextElement(
                "span", "", text.visible, "view_field_assignments_visible"
            ));
            const orderControls = document.createElement("span");
            orderControls.className = "view-field-assignments__order-controls";
            const upButton = createTextElement("button", "fw-btn view-field-assignments__move", "↑");
            upButton.type = "button";
            upButton.disabled = index === 0;
            upButton.setAttribute("aria-label", `${text.moveUp}: ${field.name}`);
            upButton.dataset.ariaLabelLangKey = "view_field_assignments_move_up";
            upButton.dataset.ariaLabelLangContext = field.name;
            upButton.addEventListener("click", () => {
                fieldRows = moveFieldRow(fieldRows, field.name, -1);
                rememberCurrentFieldOrder();
                renderFieldRows();
            });
            const downButton = createTextElement("button", "fw-btn view-field-assignments__move", "↓");
            downButton.type = "button";
            downButton.disabled = index === fieldRows.length - 1;
            downButton.setAttribute("aria-label", `${text.moveDown}: ${field.name}`);
            downButton.dataset.ariaLabelLangKey = "view_field_assignments_move_down";
            downButton.dataset.ariaLabelLangContext = field.name;
            downButton.addEventListener("click", () => {
                fieldRows = moveFieldRow(fieldRows, field.name, 1);
                rememberCurrentFieldOrder();
                renderFieldRows();
            });
            orderControls.append(upButton, downButton);
            row.append(dragHandle, fieldIdentity, visibility, orderControls);
            row.addEventListener("dragstart", (event) => {
                draggedFieldName = field.name;
                row.classList.add("is-dragging");
                event.dataTransfer?.setData("text/plain", field.name);
            });
            row.addEventListener("dragover", (event) => event.preventDefault());
            row.addEventListener("drop", (event) => {
                event.preventDefault();
                const movedName = draggedFieldName || event.dataTransfer?.getData("text/plain") || "";
                fieldRows = moveFieldRowBefore(fieldRows, movedName, field.name);
                draggedFieldName = "";
                rememberCurrentFieldOrder();
                renderFieldRows();
            });
            row.addEventListener("dragend", () => {
                draggedFieldName = "";
                row.classList.remove("is-dragging");
            });
            fieldList.appendChild(row);
        });
    }

    function applySelectedTarget() {
        editorAssignment = resolveEditorAssignment(response, selectedGroupIDs);
        const memoryKey = fieldOrderMemoryKey(dataset, viewSelect.value, editorAssignment);
        fieldRows = buildEditorFieldRows(
            availableFieldsFromResponse(response),
            editorAssignment,
            rememberedFieldOrders[memoryKey]
        );
        rememberCurrentFieldOrder();
        nameInput.value = editorAssignment.fieldSetName || defaultFieldSetName(editorAssignment);
        priorityInput.value = editorAssignment.groupPriorityMixed
            ? ""
            : String(editorAssignment.groupPriority);
        priorityInput.placeholder = editorAssignment.groupPriorityMixed ? text.mixedValue : "";
        if (editorAssignment.groupPriorityMixed) {
            priorityInput.dataset.langKey = "view_field_assignments_mixed_value";
        } else {
            delete priorityInput.dataset.langKey;
        }
        fieldSearch.value = "";
        renderFieldRows();
        syncMutationControls();
    }

    function mountGroupPicker() {
        groupPicker?.destroy?.();
        groupPickerHost.replaceChildren();
        groupPicker = createMultiselectDropdown({
            containerElement: groupPickerHost,
            options: groups.map((group) => ({
                value: String(group.group_id),
                label: group.group_name,
                searchTerms: [String(group.group_id)],
            })),
            placeholder: text.groupPlaceholder,
            searchPlaceholder: text.groupSearch,
            allowExclude: false,
            selectedCountLabel: text.groupsSelected,
            noResultsLabel: text.noResults,
            initialState: { includeValues: selectedGroupIDs.map(String) },
            onChange: ({ includeValues }) => {
                selectedGroupIDs = includeValues;
                hasRememberedGroupSelection = true;
                persistAdminState();
                applySelectedTarget();
            },
        });
        const pickerInput = groupPickerHost.querySelector(".msd-dropdown-input");
        if (pickerInput) pickerInput.dataset.langKey = "view_field_assignments_group_placeholder";
        const pickerSearch = Array.from(
            document.querySelectorAll(".msd-dropdown-list .msd-dropdown-search-input")
        ).at(-1);
        if (pickerSearch) pickerSearch.dataset.langKey = "view_field_assignments_group_search";
    }

    function acceptResponse(nextResponse, { selectAllGroups = false } = {}) {
        response = assertResponseTarget(nextResponse, dataset, viewSelect.value);
        groups = normalizeGroupAssignments(response.group_assignments);
        if (selectAllGroups) {
            selectedGroupIDs = groups.map((group) => group.group_id);
            hasRememberedGroupSelection = true;
        } else {
            selectedGroupIDs = resolveAssignmentTarget(selectedGroupIDs, groups).selectedGroupIDs;
        }
        persistAdminState();
        mountGroupPicker();
        applySelectedTarget();
        status.hidden = true;
        status.dataset.langKey = "view_field_assignments_instructions";
    }

    async function loadAssignments({ selectAllGroups = false } = {}) {
        if (!dataset || !viewSelect.value) return;
        const requestSequence = ++loadSequence;
        status.hidden = false;
        status.textContent = text.loading;
        status.dataset.langKey = "view_field_assignments_loading";
        setBusy(true);
        try {
            const nextResponse = await getViewFieldSets(dataset, viewSelect.value);
            if (requestSequence !== loadSequence) return;
            acceptResponse(nextResponse, { selectAllGroups });
        } catch (error) {
            if (requestSequence !== loadSequence) return;
            console.warn("view_field_assignments_view: load failed", error);
            response = null;
            groups = [];
            fieldRows = [];
            groupPicker?.destroy?.();
            groupPicker = null;
            groupPickerHost.replaceChildren();
            fieldList.replaceChildren();
            editorAssignment = null;
            syncMutationControls();
            status.hidden = false;
            status.textContent = text.loadError;
            status.dataset.langKey = "view_field_assignments_load_error";
            showWarningToast(text.loadError);
        } finally {
            if (requestSequence === loadSequence) setBusy(false);
        }
    }

    saveButton.addEventListener("click", async () => {
        if (!editorAssignment?.mutationAllowed) return;
        if (!hasValidVisibleFieldDraft()) {
            syncMutationControls();
            return;
        }
        const operationDataset = dataset;
        const operationViewKey = viewSelect.value;
        const operationSelectedGroupIDs = [...selectedGroupIDs];
        const operationGroups = [...groups];
        const operationAssignment = { ...editorAssignment };
        const operationFieldRows = fieldRows.map((field) => ({
            ...field,
            visibleByGroup: { ...field.visibleByGroup },
        }));
        const operationName = nameInput.value;
        const operationPriority = priorityInput.value;
        if (editorAssignment.mixed) {
            const confirmed = await showConfirmModal({
                messageLangKey: "view_field_assignments_mixed_confirm",
                messagePlainText: text.mixedConfirm,
                confirmLangKey: "view_field_assignments_save",
                confirmText: text.save,
                cancelText: getViewFieldAssignmentsCancelText(),
            });
            if (!confirmed) return;
            if (dataset !== operationDataset || viewSelect.value !== operationViewKey) return;
        }
        const target = resolveAssignmentTarget(operationSelectedGroupIDs, operationGroups);
        const payload = operationAssignment.mixed
            ? buildMixedGroupViewFieldSetSavePayload({
                dataset: operationDataset,
                viewKey: operationViewKey,
                name: operationName || defaultFieldSetName(target),
                target,
                groupVariants: groupVariantsFromRows(
                    operationFieldRows,
                    operationAssignment,
                    operationPriority.trim()
                ),
            })
            : buildViewFieldSetSavePayload({
                dataset: operationDataset,
                viewKey: operationViewKey,
                name: operationName || defaultFieldSetName(target),
                fieldSetID: operationAssignment.fieldSetID,
                visibleColumns: visibleColumnsFromRows(operationFieldRows),
                target,
                groupPriority: operationPriority,
            });
        setBusy(true);
        try {
            const saveResponse = await saveSiteViewFieldSet(payload);
            const readback = assertResponseTarget(
                await getViewFieldSets(operationDataset, operationViewKey),
                operationDataset,
                operationViewKey
            );
            const saveVerified = operationAssignment.mixed
                ? savedGroupVariantsMatch(readback, payload)
                : savedAssignmentMatches(readback, payload, saveResponse?.field_set_id);
            if (!saveVerified) {
                throw new Error(text.readbackError);
            }
            if (dataset === operationDataset && viewSelect.value === operationViewKey) {
                selectedGroupIDs = operationSelectedGroupIDs;
                acceptResponse(readback);
            }
            showSuccessToast(text.saved);
        } catch (error) {
            console.warn("view_field_assignments_view: save failed", error);
            showWarningToast(error?.message || text.readbackError);
        } finally {
            setBusy(false);
        }
    });

    restoreButton.addEventListener("click", async () => {
        if (!editorAssignment?.mutationAllowed) return;
        const operationDataset = dataset;
        const operationViewKey = viewSelect.value;
        const operationSelectedGroupIDs = [...selectedGroupIDs];
        const operationGroups = [...groups];
        const confirmed = await showConfirmModal({
            messageLangKey: "view_field_assignments_restore_confirm",
            messagePlainText: text.restoreConfirm,
            confirmLangKey: "view_field_assignments_restore",
            confirmText: text.restore,
            cancelText: getViewFieldAssignmentsCancelText(),
        });
        if (!confirmed) return;
        if (dataset !== operationDataset || viewSelect.value !== operationViewKey) return;
        const target = resolveAssignmentTarget(operationSelectedGroupIDs, operationGroups);
        setBusy(true);
        try {
            await resetSharedViewFieldSet({
                dataset: operationDataset,
                view_key: operationViewKey,
                target_scope: target.targetScope,
                target_group_ids: target.targetGroupIDs,
            });
            const readback = assertResponseTarget(
                await getViewFieldSets(operationDataset, operationViewKey),
                operationDataset,
                operationViewKey
            );
            if (!resetAssignmentMatches(readback, target)) throw new Error(text.readbackError);
            if (dataset === operationDataset && viewSelect.value === operationViewKey) {
                selectedGroupIDs = operationSelectedGroupIDs;
                acceptResponse(readback);
            }
            showSuccessToast(text.restored);
        } catch (error) {
            console.warn("view_field_assignments_view: restore failed", error);
            showWarningToast(error?.message || text.readbackError);
        } finally {
            setBusy(false);
        }
    });

    viewSelect.addEventListener("change", () => {
        persistAdminState();
        if (dataset) void loadAssignments();
    });
    fieldSearch.addEventListener("input", renderFieldRows);

    document.addEventListener("checkboxSelectionChanged", (event) => {
        const selectedDataset = extractFirstSelectedTableName(event.detail?.selectedCategories);
        if (!selectedDataset || selectedDataset === dataset) return;
        dataset = selectedDataset;
        void loadAssignments({ selectAllGroups: !hasRememberedGroupSelection });
    }, { signal: listenerController.signal });

    const rawTreeData = localStorage.getItem("full_tree_data");
    if (rawTreeData) {
        try {
            const treeData = JSON.parse(rawTreeData);
            if (Array.isArray(treeData?.nodes)) {
                await render_tree(treeData.nodes, {
                    container_id: treeHost.id,
                    id_suffix: "_view_field_assignments_tree",
                    render_mode: "checkbox",
                    selection_mode: "single",
                    checkbox_mode: "leaf",
                    use_icons: false,
                    populate_checkbox_selection: false,
                    max_recursion_depth: 32,
                    tree_model: "flat",
                    initial_open_level: 1,
                    show_node_count: true,
                    show_search: true,
                    use_data_lang_key: true,
                });
            }
        } catch (error) {
            console.warn("view_field_assignments_view: tree data unavailable", error);
        }
    }

    editorAssignment = resolveEditorAssignment({ group_assignments: [] }, []);
    syncMutationControls();
    container.__cleanupListeners = () => {
        loadSequence += 1;
        listenerController.abort();
        groupPicker?.destroy?.();
        groupPicker = null;
    };
}
