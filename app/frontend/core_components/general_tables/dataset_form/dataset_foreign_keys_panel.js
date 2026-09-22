// dataset_foreign_keys_panel.js
// Shows the links one dataset already has to other datasets, and adds a new one.
// Bridges the dataset forms with the foreign-key routes the creation form uses.
// Exists so a link between two datasets can be seen and added where the dataset
// is described, instead of only while the dataset is being created.
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { fetch_columns_for_table } from "../../endpoints/endpoint_column_fetcher.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";

// The site's own language keys carry the translations; the English text here is
// the fallback an installation without these keys still shows.
const COPY_KEYS = Object.freeze({
    title: ["dataset_foreign_keys_title", "Links to other datasets"],
    none: ["dataset_foreign_keys_none", "This dataset has no links yet."],
    unavailable: ["dataset_foreign_keys_unavailable", "The links could not be read."],
    saveFailed: ["dataset_foreign_key_save_failed", "The link could not be added."],
    referencingColumn: ["referencing_column", "Column in this dataset"],
    referencedTable: ["referenced_table", "Target dataset"],
    referencedColumn: ["referenced_column", "Column in the target dataset"],
    selectColumn: ["select_column", "Choose a column"],
});

/** Read the panel's copy from the language keys of the current interface language. */
export function datasetForeignKeyCopy() {
    const text = {};
    for (const [name, [key, fallback]] of Object.entries(COPY_KEYS)) {
        text[name] = getTranslationForKey(key, { fallback }) || fallback;
    }
    return text;
}

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

/**
 * Build the foreign-key panel for a form that edits an existing dataset.
 * The returned handle adds the one link the person filled in, when the rest of
 * the dataset's save has already succeeded.
 */
export function createDatasetForeignKeyPanel({ datasetName, columnNames = () => [] }) {
    const text = datasetForeignKeyCopy();

    const section = document.createElement("section");
    section.className = "dataset-foreign-keys dataset-form-section";
    section.dataset.testid = "dataset-foreign-keys";

    const title = document.createElement("div");
    title.className = "dataset-foreign-keys-title dataset-form-section-title";
    title.dataset.langKey = COPY_KEYS.title[0];
    title.textContent = text.title;

    const list = document.createElement("ul");
    list.className = "dataset-foreign-keys-list";
    list.dataset.testid = "dataset-foreign-keys-list";

    const status = document.createElement("span");
    status.className = "dataset-foreign-keys-status dataset-form-status";
    status.setAttribute("role", "status");
    status.hidden = true;

    const draft = document.createElement("div");
    draft.className = "dataset-foreign-key-draft dataset-form-fields";

    const referencingSelect = labelledSelect(draft, COPY_KEYS.referencingColumn, text.referencingColumn, "fk_referencing_column");
    const referencedTableSelect = labelledSelect(draft, COPY_KEYS.referencedTable, text.referencedTable, "fk_referenced_dataset");
    const referencedColumnSelect = labelledSelect(draft, COPY_KEYS.referencedColumn, text.referencedColumn, "fk_referenced_column");

    section.append(title, list, draft, status);

    const placeholder = (select) => {
        const option = document.createElement("option");
        option.value = "";
        option.dataset.langKey = COPY_KEYS.selectColumn[0];
        option.textContent = text.selectColumn;
        select.replaceChildren(option);
    };
    const fill = (select, values) => {
        placeholder(select);
        for (const value of values) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            select.appendChild(option);
        }
    };

    // The column choices follow the form the person is editing, so a column
    // added in the same save can carry the new link.
    referencingSelect.addEventListener("focus", () => {
        const chosen = referencingSelect.value;
        fill(referencingSelect, columnNames());
        referencingSelect.value = chosen;
    });

    referencedTableSelect.addEventListener("change", async () => {
        placeholder(referencedColumnSelect);
        if (!referencedTableSelect.value) return;
        try {
            const columns = await fetch_columns_for_table(referencedTableSelect.value);
            fill(referencedColumnSelect, (columns || []).map((column) => String(column?.column_name || "")).filter(Boolean));
        } catch (error) {
            status.hidden = false;
            status.textContent = text.unavailable;
            void error;
        }
    });

    function renderExisting(links) {
        list.replaceChildren();
        if (links.length === 0) {
            const empty = document.createElement("li");
            empty.className = "dataset-foreign-keys-empty";
            empty.dataset.langKey = COPY_KEYS.none[0];
            empty.textContent = text.none;
            list.appendChild(empty);
            return;
        }
        for (const link of links) {
            const item = document.createElement("li");
            item.textContent = `${link.referencingColumn} → ${link.referencedTable}.${link.referencedColumn}`;
            list.appendChild(item);
        }
    }

    const ready = Promise.all([
        readDatasetForeignKeys(datasetName),
        endpoint_router("datasetNames", { suppressErrorToast: true }),
    ])
        .then(([links, datasetNames]) => {
            renderExisting(links);
            fill(referencingSelect, columnNames());
            fill(referencedTableSelect, (Array.isArray(datasetNames) ? datasetNames : []).map(String));
            placeholder(referencedColumnSelect);
        })
        .catch((error) => {
            status.hidden = false;
            status.textContent = text.unavailable;
            void error;
        });

    const draftLink = () => ({
        referencing_dataset: String(datasetName),
        referencing_column: referencingSelect.value,
        referenced_dataset: referencedTableSelect.value,
        referenced_column: referencedColumnSelect.value,
    });
    const complete = () => Boolean(referencingSelect.value && referencedTableSelect.value && referencedColumnSelect.value);

    return {
        element: section,
        selects: { referencingSelect, referencedTableSelect, referencedColumnSelect },
        ready,
        /** Whether the person filled in a complete new link. */
        changed: complete,
        /** Add the new link. Returns "saved", "unchanged" or "failed". */
        save: async () => {
            if (!complete()) return "unchanged";
            try {
                await endpoint_router("addForeignKey", {
                    method: "POST",
                    body_data: draftLink(),
                    suppressErrorToast: true,
                });
                placeholder(referencedColumnSelect);
                referencingSelect.value = "";
                referencedTableSelect.value = "";
                renderExisting(await readDatasetForeignKeys(datasetName));
                status.hidden = true;
                return "saved";
            } catch (error) {
                status.hidden = false;
                status.textContent = text.saveFailed;
                void error;
                return "failed";
            }
        },
    };
}

function labelledSelect(parent, [langKey], captionText, name) {
    const label = document.createElement("label");
    const caption = document.createElement("span");
    caption.dataset.langKey = langKey;
    caption.textContent = captionText;
    const select = document.createElement("select");
    select.name = name;
    select.dataset.testid = name.replace(/_/g, "-");
    label.append(caption, select);
    parent.appendChild(label);
    return select;
}
