// dataset_foreign_keys_panel.js
// The dataset form's links to other datasets, in both modes: the links an
// existing dataset has, and the new ones the person drafts.
// Bridges the form with the foreign-key routes through the form's persistence
// adapters: a new dataset's links travel in its create request, an existing
// dataset's new link is added after its columns are saved.
// Exists so a link between two datasets is drafted and read the same way
// wherever the dataset is described.
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { createDatasetFormStatus, datasetFormLabel, setDatasetFormText } from "./dataset_form_text.js";

/**
 * The links that start in this dataset.
 * Links that only point at it belong to the other dataset's own form, so they
 * are left out rather than offered here for editing.
 */
export function selectOutgoingForeignKeys(rows = [], datasetName = "") {
    return (Array.isArray(rows) ? rows : [])
        .filter((row) => String(row?.referencing_table || "") === String(datasetName))
        .map((row) => ({
            constraintName: String(row?.constraint_name || ""),
            referencingColumn: String(row?.referencing_column || ""),
            referencedTable: String(row?.referenced_table || ""),
            referencedColumn: String(row?.referenced_column || ""),
        }));
}

/** The links one dataset currently has, in the order the server lists them. */
export async function readDatasetForeignKeys(datasetName) {
    const response = await endpoint_router("fetchForeignKeys", {
        url_params: `?${new URLSearchParams({ datasets: String(datasetName) }).toString()}`,
        suppressErrorToast: true,
    });
    return selectOutgoingForeignKeys(response?.data, datasetName);
}

/** Add one link from an existing dataset to another. */
export function addDatasetForeignKey(datasetName, link) {
    return endpoint_router("addForeignKey", {
        method: "POST",
        body_data: { referencing_dataset: String(datasetName), ...link },
        suppressErrorToast: true,
    });
}

/**
 * Build the links panel.
 *
 * @param {object} options
 * @param {Promise<object[]>} [options.stored] - when editing, the links the
 *   dataset has now, listed above the draft; a new dataset has none
 * @param {Promise<string[]>} options.datasetNames - the datasets a link may point to
 * @param {(datasetName: string) => Promise<object[]>} options.readColumns - the
 *   columns of a dataset a link points to
 * @param {() => string[]} options.columnNames - the columns the open form shows,
 *   including ones the same save is about to add
 * @param {boolean} [options.multipleDrafts] - creation drafts any number of
 *   links, each required once added; editing drafts one optional link
 */
export function createDatasetForeignKeyPanel({
    stored = null, datasetNames, readColumns, columnNames = () => [], multipleDrafts = false,
}) {
    const section = document.createElement("section");
    section.className = "dataset-foreign-keys dataset-form-section";
    section.dataset.testid = "dataset-foreign-keys";
    const title = setDatasetFormText(document.createElement("div"), "dataset_foreign_keys_title");
    title.className = "dataset-foreign-keys-title dataset-form-section-title";
    section.appendChild(title);

    const list = document.createElement("ul");
    list.className = "dataset-foreign-keys-list";
    list.dataset.testid = "dataset-foreign-keys-list";
    if (stored) section.appendChild(list);

    const drafts = document.createElement("div");
    drafts.className = "dataset-form-rows dataset-foreign-key-drafts";
    const status = createDatasetFormStatus("dataset-foreign-keys-status");
    section.append(drafts, status.element);

    let targets = [];
    const draftRows = [];

    const placeholder = (select, key) => {
        select.replaceChildren(setDatasetFormText(Object.assign(document.createElement("option"), { value: "" }), key));
    };
    const fill = (select, key, values) => {
        const chosen = select.value;
        placeholder(select, key);
        for (const value of values) {
            select.appendChild(Object.assign(document.createElement("option"), { value, textContent: value }));
        }
        select.value = values.includes(chosen) ? chosen : "";
    };
    const labelledSelect = (row, key, name) => {
        const label = datasetFormLabel(key);
        const select = document.createElement("select");
        select.name = name;
        select.dataset.testid = name.replace(/_/g, "-");
        select.required = multipleDrafts;
        label.appendChild(select);
        row.appendChild(label);
        return select;
    };

    function addDraft() {
        const row = document.createElement("div");
        row.className = "dataset-foreign-key-draft dataset-form-fields";
        const referencing = labelledSelect(row, "referencing_column", "fk_referencing_column");
        const referencedTable = labelledSelect(row, "referenced_table", "fk_referenced_dataset");
        const referencedColumn = labelledSelect(row, "referenced_column", "fk_referenced_column");
        fill(referencing, "select_column", columnNames());
        fill(referencedTable, "dataset_select_target", targets);
        placeholder(referencedColumn, "select_column");

        // The column choices follow the form the person is editing, so a column
        // added in the same save can carry the new link.
        referencing.addEventListener("focus", () => fill(referencing, "select_column", columnNames()));
        referencedTable.addEventListener("change", async () => {
            placeholder(referencedColumn, "select_column");
            if (!referencedTable.value) return;
            try {
                const columns = await readColumns(referencedTable.value);
                fill(referencedColumn, "select_column",
                    (columns || []).map((column) => String(column?.column_name || "")).filter(Boolean));
            } catch (error) {
                status.show("dataset_foreign_keys_unavailable");
                void error;
            }
        });

        const draft = { row, referencing, referencedTable, referencedColumn };
        if (multipleDrafts) {
            const remove = setDatasetFormText(document.createElement("button"), "delete");
            remove.type = "button";
            remove.className = "dataset-form-button dataset-foreign-key-remove";
            remove.addEventListener("click", () => {
                row.remove();
                draftRows.splice(draftRows.indexOf(draft), 1);
            });
            row.appendChild(remove);
        }
        draftRows.push(draft);
        drafts.appendChild(row);
        return draft;
    }

    function clearDrafts() {
        draftRows.splice(0).forEach(({ row }) => row.remove());
        if (!multipleDrafts) addDraft();
    }

    if (multipleDrafts) {
        const add = setDatasetFormText(document.createElement("button"), "add_foreign_key");
        add.type = "button";
        add.className = "modal-button secondary saturate_on_hover";
        add.dataset.testid = "dataset-foreign-key-add";
        add.addEventListener("click", () => addDraft().referencing.focus());
        section.appendChild(add);
    } else {
        addDraft();
    }

    function renderExisting(links) {
        list.replaceChildren();
        if (links.length === 0) {
            const empty = setDatasetFormText(document.createElement("li"), "dataset_foreign_keys_none");
            empty.className = "dataset-foreign-keys-empty";
            list.appendChild(empty);
            return;
        }
        for (const link of links) {
            const item = document.createElement("li");
            item.textContent = `${link.referencingColumn} → ${link.referencedTable}.${link.referencedColumn}`;
            list.appendChild(item);
        }
    }

    const ready = Promise.all([Promise.resolve(datasetNames), stored ? Promise.resolve(stored) : null])
        .then(([names, links]) => {
            targets = (Array.isArray(names) ? names : []).map(String);
            for (const draft of draftRows) {
                fill(draft.referencing, "select_column", columnNames());
                fill(draft.referencedTable, "dataset_select_target", targets);
            }
            if (stored) renderExisting(Array.isArray(links) ? links : []);
        })
        .catch((error) => {
            status.show("dataset_foreign_keys_unavailable");
            void error;
        });

    const complete = () => draftRows.filter(({ referencing, referencedTable, referencedColumn }) =>
        referencing.value && referencedTable.value && referencedColumn.value);

    return {
        element: section,
        ready,
        /** The complete links the person drafted; a half-filled one is never sent. */
        value: () => complete().map(({ referencing, referencedTable, referencedColumn }) => ({
            referencing_column: referencing.value,
            referenced_dataset: referencedTable.value,
            referenced_column: referencedColumn.value,
        })),
        /** Whether the person drafted a complete link. */
        changed: () => complete().length > 0,
        /**
         * The drafted links are saved: the drafts start over, so a second Save
         * cannot repeat them, and an existing dataset's list is shown anew.
         */
        accept: (links = null) => {
            clearDrafts();
            status.clear();
            if (stored && Array.isArray(links)) renderExisting(links);
        },
        /** Show that saving the link failed, beside the panel; the draft stays. */
        reportFailure: () => status.show("dataset_foreign_key_save_failed"),
    };
}
