// row_group_assignment_editor.js
// Builds the shared administrator window for headings, values and row assignments.
// Bridges captured selection, the existing row-group APIs and unified listing refresh.
// Exists so category and class edits retain drafts on failure and preserve search state.
import { endpoint_router } from "../endpoints/endpoint_router.js";
import { getTranslationForKey } from "../lang/translation_handler.js";
import { getLanguageWithBrowserFallback } from "../state_stores/lang_preference_reader.js";
import { get_selected_items } from "../table_views/table_view/selected_items_reader.js";
import { bindDatasetLanguageRenderer } from "../table_views/dataset_value_localizer.js";
import { refreshTableUnified } from "../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";
import { createModal, hideModal, showModal } from "../../reusable_components/modal/modal_builder.js";
import { showWarningToast } from "../../reusable_components/notifications/toast_notification_printer.js";

function text(key) { return getTranslationForKey(key) || key; }
function element(tag, key) {
    const node = document.createElement(tag);
    if (key) { node.dataset.langKey = key; node.textContent = text(key); }
    return node;
}
function button(key) {
    const node = element("button", key);
    node.type = "button";
    node.className = "fw-btn";
    return node;
}
function invalidResponse() { return new Error(text("row_group_window_invalid_response")); }
function titleOf(record, language = getLanguageWithBrowserFallback()) {
    return record.title?.[language] || record.title?.fi || record.title?.en || record.slug;
}
function bindDisplayedName(node, record, fallbackKey) {
    // Refresh only the displayed text; the surrounding controls and drafts stay mounted.
    bindDatasetLanguageRenderer(node, (language) => {
        node.textContent = titleOf(record, language) || text(fallbackKey);
    });
}
function baseline(record) {
    return { title: { ...record.title }, enabled: record.enabled, sort_order: record.sort_order };
}
function changesFor(record) {
    const original = record.original;
    const changes = {};
    if (JSON.stringify(record.title) !== JSON.stringify(original.title)) changes.title = record.title;
    if (record.sort_order !== original.sort_order) changes.sort_order = record.sort_order;
    if (record.enabled !== original.enabled) changes.enabled = record.enabled;
    return changes;
}

// Fail closed on widened or incomplete row readback before building writable controls.
function validateCatalogue(response, dataset, rowIDs) {
    if (!response || response.dataset !== dataset || !Number.isSafeInteger(response.table_uid)
        || response.table_uid <= 0 || !Array.isArray(response.groups) || !Array.isArray(response.classifications)
        || !Array.isArray(response.row_ids) || response.row_ids.length !== rowIDs.length
        || response.row_ids.some((id, index) => id !== rowIDs[index])) throw invalidResponse();
    for (const records of [response.groups, response.classifications]) {
        if (new Set(records.map((record) => record.id)).size !== records.length) throw invalidResponse();
        for (const record of records) {
            if (!Number.isSafeInteger(record.id) || record.id <= 0 || typeof record.slug !== "string"
                || !record.title || typeof record.title !== "object" || Array.isArray(record.title)
                || typeof record.enabled !== "boolean" || !Number.isInteger(record.sort_order)) throw invalidResponse();
        }
    }
    for (const heading of response.classifications) {
        if (typeof heading.is_single !== "boolean") throw invalidResponse();
    }
    for (const value of response.groups) {
        if (!Array.isArray(value.selected_rows) || new Set(value.selected_rows).size !== value.selected_rows.length
            || value.selected_rows.some((id) => !rowIDs.includes(id))
            || (value.classification_id != null && !response.classifications.some((h) => h.id === value.classification_id))) {
            throw invalidResponse();
        }
    }
    return response;
}

/** Creates the permission-gated callers' shared action; selection is captured on open. */
export function createRowGroupAssignmentButton(datasetName) {
    const opener = button("row_group_classes_and_categories");
    opener.classList.add("row-group-assignment-button");
    opener.dataset.testid = "btn-row-group-assignment";
    opener.dataset.dataset = datasetName;
    opener.addEventListener("click", () => { void openRowGroupAssignmentEditor(datasetName, opener); });
    return opener;
}

/** Names-only management also works when the table has no selected rows. */
export async function openRowGroupAssignmentEditor(datasetName, opener = document.activeElement) {
    const selected = get_selected_items(datasetName)?.ids || [];
    const rowIDs = Array.from(new Set(selected.map(Number))).sort((a, b) => a - b);
    if (rowIDs.length > 200 || rowIDs.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
        showWarningToast(text("row_group_window_maximum_rows"));
        return null;
    }
    opener?.focus?.();
    const content = element("form");
    content.className = "row-group-editor";
    const status = element("p", "loading");
    status.className = "row-group-editor__status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const summary = element("p");
    summary.append(element("span", rowIDs.length ? "row_group_window_selected_rows" : "row_group_window_names_only"));
    if (rowIDs.length) summary.append(` (${rowIDs.length})`);
    const catalogue = element("div");
    catalogue.className = "row-group-editor__catalogue";
    const footer = element("div");
    footer.className = "form-actions row-group-editor__footer";
    const save = button("save");
    save.type = "submit";
    save.disabled = true;
    save.dataset.testid = "row-group-save";
    const cancel = button("cancel");
    cancel.addEventListener("click", () => hideModal());
    footer.append(cancel, save);
    content.append(summary, catalogue, status, footer);
    let alive = true;
    const { modal } = createModal({
        titlePlainText: text("row_group_classes_and_categories"), contentElements: [content],
        width: "720px", cleanupCallback: () => { alive = false; },
    });
    modal.querySelector("#custom_modal_title").dataset.langKey = "row_group_classes_and_categories";
    showModal();
    let headings = [];
    let values = [];
    let temporaryID = -1;
    let busy = false;
    let wrote = false;
    const dirty = () => wrote || [...headings, ...values].some((record) => record.id < 0
        || Object.keys(changesFor(record)).length || record.desired !== null);
    const updateSave = () => { save.disabled = busy || !dirty(); };
    const newRecord = (heading = null) => {
        const record = { id: temporaryID--, slug: "", title: { fi: "", en: "" }, enabled: true,
            sort_order: 0, is_single: false, heading, selected_rows: [], desired: null };
        record.original = baseline(record);
        return record;
    };
    function field(parent, key, input) {
        const label = element("label");
        // Translation replaces text leaves; a translated label must never own its input.
        label.append(element("span", key), input);
        parent.append(label);
        return input;
    }
    function cancelPendingAdditions(affected) {
        // A true class value identifies a pending replacement, including implicit peer removals.
        // An explicit clear has only false values and must retain its removal intent.
        for (const value of affected.filter((item) => item.desired === true)) {
            const peers = value.heading?.is_single ? values.filter((peer) => peer.heading === value.heading) : [value];
            peers.forEach((peer) => { peer.desired = null; }); // Restore each peer's selected_rows baseline.
        }
    }
    function editNames(parent, record, isHeading) {
        const details = element("details");
        details.open = record.id < 0 || record.namesOpen === true;
        details.addEventListener("toggle", () => { record.namesOpen = details.open; });
        details.className = "row-group-editor__names";
        details.append(element("summary", "row_group_window_edit_names"));
        for (const language of ["fi", "en"]) {
            const input = element("input");
            input.value = record.title[language] || "";
            input.maxLength = 500;
            input.dataset.nameLanguage = language;
            field(details, `row_group_window_name_${language}`, input);
            input.addEventListener("input", () => {
                if (input.value.trim()) record.title[language] = input.value.trim();
                else delete record.title[language];
                updateSave();
            });
        }
        if (record.id < 0) {
            const slug = element("input");
            slug.pattern = "[a-z0-9][a-z0-9_\\-]{0,63}";
            slug.maxLength = 64;
            slug.value = record.slug;
            slug.dataset.testid = "row-group-slug";
            field(details, "row_group_window_slug", slug);
            slug.addEventListener("input", () => { record.slug = slug.value.trim(); updateSave(); });
        }
        const order = element("input");
        order.type = "number";
        order.min = "-100000";
        order.max = "100000";
        order.value = String(record.sort_order);
        field(details, "row_group_window_order", order);
        order.addEventListener("input", () => { record.sort_order = Number(order.value); updateSave(); });
        const enabled = element("input");
        enabled.type = "checkbox";
        enabled.checked = record.enabled;
        const enabledIdentity = `${isHeading ? "heading" : "value"}-${record.id}`;
        enabled.dataset.metadataEnabled = enabledIdentity;
        field(details, "row_group_window_enabled", enabled);
        enabled.addEventListener("change", () => {
            record.enabled = enabled.checked;
            // Cancel a radio replacement as a whole so disabling never leaves only its removals.
            if (!record.enabled) {
                const affected = isHeading ? values.filter((value) => value.heading === record) : [record];
                cancelPendingAdditions(affected);
            }
            render();
            catalogue.querySelector(`[data-metadata-enabled="${enabledIdentity}"]`)?.focus();
        });
        if (isHeading) {
            const type = element("select");
            for (const [value, key] of [["false", "row_group_category_multiple"], ["true", "row_group_class_single"]]) {
                const option = element("option", key);
                option.value = value;
                type.append(option);
            }
            type.value = String(record.is_single);
            type.disabled = record.id > 0;
            field(details, "row_group_window_type", type);
            type.addEventListener("change", () => {
                record.is_single = type.value === "true";
                if (record.is_single) {
                    const selectedValues = values.filter((value) => value.heading === record && value.desired === true);
                    selectedValues.slice(1).forEach((value) => { value.desired = false; });
                }
                render();
            });
        }
        parent.append(details);
    }
    function render() {
        catalogue.replaceChildren();
        const ordered = [...headings].sort((a, b) => a.sort_order - b.sort_order || a.slug.localeCompare(b.slug));
        if (values.some((value) => !value.heading)) ordered.push(null);
        for (const heading of ordered) {
            const section = element("fieldset");
            section.className = "row-group-editor__heading";
            const legend = heading ? element("legend") : element("legend", "row_group_window_without_heading");
            if (heading) bindDisplayedName(legend, heading, "row_group_window_new_heading");
            section.append(legend);
            if (heading) editNames(section, heading, true);
            const headingValues = values.filter((value) => value.heading === heading)
                .sort((a, b) => a.sort_order - b.sort_order || a.slug.localeCompare(b.slug));
            for (const value of headingValues) {
                const row = element("div");
                row.className = "row-group-editor__value";
                if (rowIDs.length) {
                    const label = element("label");
                    label.className = "row-group-editor__assignment";
                    const control = element("input");
                    control.type = heading?.is_single ? "radio" : "checkbox";
                    control.name = `row-group-heading-${heading?.id ?? "legacy"}`;
                    control.dataset.valueId = String(value.id);
                    const count = value.selected_rows.length;
                    const mixed = value.desired === null && count > 0 && count < rowIDs.length;
                    control.checked = value.desired === null ? count === rowIDs.length : value.desired;
                    control.indeterminate = mixed;
                    control.disabled = !value.enabled || heading?.enabled === false;
                    if (control.type === "checkbox") control.setAttribute("aria-checked", mixed ? "mixed" : String(control.checked));
                    const name = element("span");
                    bindDisplayedName(name, value, "row_group_window_new_value");
                    label.append(control, name);
                    if (mixed) {
                        const hint = element("span");
                        hint.append(element("span", "row_group_window_mixed"));
                        hint.id = `row-group-mixed-${value.id}`;
                        hint.append(` (${count}/${rowIDs.length})`);
                        control.setAttribute("aria-describedby", hint.id);
                        label.append(hint);
                    }
                    control.addEventListener("change", () => {
                        if (heading?.is_single) headingValues.forEach((peer) => { peer.desired = peer === value; });
                        else value.desired = control.checked;
                        render();
                        catalogue.querySelector(`[data-value-id="${value.id}"]`)?.focus();
                    });
                    row.append(label);
                } else {
                    const name = element("p");
                    bindDisplayedName(name, value, "row_group_window_new_value");
                    row.append(name);
                }
                editNames(row, value, false);
                section.append(row);
            }
            if (rowIDs.length && heading?.is_single && headingValues.length) {
                const clear = button("row_group_window_clear_assignment");
                clear.addEventListener("click", () => { headingValues.forEach((value) => { value.desired = false; }); render(); });
                section.append(clear);
            }
            if (heading) {
                const addValue = button("row_group_window_new_value");
                addValue.addEventListener("click", () => { values.push(newRecord(heading)); render(); });
                section.append(addValue);
            }
            catalogue.append(section);
        }
        const addHeading = button("row_group_window_new_heading");
        addHeading.dataset.testid = "row-group-new-heading";
        addHeading.addEventListener("click", () => { headings.push(newRecord()); render(); });
        catalogue.append(addHeading);
        updateSave();
    }
    async function saveNames(record, heading) {
        const creating = record.id < 0;
        const changes = changesFor(record);
        if (!creating && !Object.keys(changes).length) return;
        const body = creating
            ? { slug: record.slug, title: record.title, sort_order: record.sort_order, enabled: record.enabled,
                ...(heading ? { is_single: record.is_single } : { classification_id: record.heading.id }) }
            : { id: record.id, ...changes };
        const result = await endpoint_router("adminRowGroups", {
            method: "POST", body_data: heading ? { classification: body } : body, suppressAuthRedirect: true,
        });
        if (!Number.isSafeInteger(result?.id) || result.id <= 0 || (!creating && result.id !== record.id)
            || result.slug !== record.slug) throw invalidResponse();
        record.id = result.id;
        record.original = baseline(record);
        wrote = true;
    }
    content.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (busy || !dirty()) return;
        busy = true;
        content.querySelectorAll("input, select, button").forEach((control) => { control.disabled = true; });
        status.dataset.langKey = "saving";
        status.textContent = text("saving");
        try {
            for (const heading of headings) await saveNames(heading, true);
            for (const value of values) await saveNames(value, false);
            // Explicit clears and category removals precede additions; a class POST removes peers atomically.
            for (const desired of [false, true]) {
                for (const value of values.filter((item) => item.desired === desired)) {
                    const classPeers = value.heading?.is_single ? values.filter((peer) => peer.heading === value.heading) : null;
                    if (!desired && classPeers?.some((peer) => peer.desired === true)) continue;
                    const affected = desired ? rowIDs.filter((id) => !value.selected_rows.includes(id)) : value.selected_rows;
                    if (affected.length) {
                        const result = await endpoint_router("adminRowGroupMemberships", {
                            method: desired ? "POST" : "DELETE",
                            body_data: { dataset: datasetName, group_id: value.id, row_ids: [...affected] },
                            suppressAuthRedirect: true,
                        });
                        if (result?.success !== true) throw invalidResponse();
                        wrote = true;
                    }
                    // Keep all class baselines intact on POST failure so cancellation restores the old assignment.
                    for (const peer of desired && classPeers ? classPeers : [value]) {
                        peer.selected_rows = desired && peer === value ? [...rowIDs] : [];
                        peer.desired = null;
                    }
                }
            }
            // Existing refresh owns first-page reconciliation and committed-search cache adoption.
            await refreshTableUnified(datasetName, { skipUrlParams: true });
            if (alive) {
                hideModal();
                const nextOpener = opener?.isConnected ? opener
                    : Array.from(document.querySelectorAll('[data-testid="btn-row-group-assignment"]')).find((node) => node.dataset.dataset === datasetName);
                setTimeout(() => nextOpener?.focus(), 0);
            }
        } catch {
            if (alive) {
                status.dataset.langKey = "row_group_window_save_failed";
                status.textContent = text("row_group_window_save_failed");
                status.classList.add("row-group-editor__status--error");
                busy = false;
                cancel.disabled = false;
                render();
            }
        }
    });
    try {
        const params = new URLSearchParams({ target: datasetName });
        if (rowIDs.length) params.set("row_ids", rowIDs.join(","));
        const response = validateCatalogue(await endpoint_router("adminRowGroups", {
            method: "GET", url_params: `?${params}`, suppressAuthRedirect: true,
        }), datasetName, rowIDs);
        if (!alive) return modal;
        headings = response.classifications.map((record) => ({ ...record, original: baseline(record), desired: null }));
        values = response.groups.map((record) => ({ ...record, original: baseline(record), desired: null,
            heading: headings.find((heading) => heading.id === record.classification_id) || null }));
        status.removeAttribute("data-lang-key");
        status.textContent = "";
        render();
    } catch {
        if (alive) {
            status.dataset.langKey = "row_group_window_load_failed";
            status.textContent = text("row_group_window_load_failed");
        }
    }
    return modal;
}
