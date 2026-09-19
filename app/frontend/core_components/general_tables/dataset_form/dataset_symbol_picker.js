// dataset_symbol_picker.js
// Lets an administrator choose the symbol that represents a dataset.
// Bridges the dataset forms with the safe symbol registry and its assignment API.
// Exists so a dataset's symbol is chosen where the dataset is defined, instead of
// only in a separate administration tool the person has to find afterwards.
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";

// The site's own language keys carry the translations; the English text here is
// the fallback an installation without these keys still shows.
const COPY_KEYS = Object.freeze({
    label: ["dataset_symbol_label", "Symbol"],
    none: ["dataset_symbol_none", "No symbol"],
    loading: ["dataset_symbol_loading", "Reading the symbols…"],
    unavailable: ["dataset_symbol_unavailable", "The symbols could not be read."],
    saveFailed: ["dataset_symbol_save_failed", "The symbol could not be saved."],
});

/** Read the picker's copy from the language keys of the current interface language. */
export function datasetSymbolCopy() {
    const text = {};
    for (const [name, [key, fallback]] of Object.entries(COPY_KEYS)) {
        text[name] = getTranslationForKey(key, { fallback }) || fallback;
    }
    return text;
}

/**
 * Build the symbol control for a dataset form.
 * The returned handle exposes the chosen key and, in a form that edits an
 * existing dataset, a save step that assigns it.
 */
export function createDatasetSymbolPicker({ selectedKey = "" } = {}) {
    const text = datasetSymbolCopy();

    const label = document.createElement("label");
    label.className = "dataset-symbol-picker";
    label.dataset.testid = "dataset-symbol-picker";

    const caption = document.createElement("span");
    caption.dataset.langKey = COPY_KEYS.label[0];
    caption.textContent = text.label;

    const select = document.createElement("select");
    select.name = "icon_key";
    select.dataset.testid = "dataset-symbol-select";

    const preview = document.createElement("img");
    preview.className = "dataset-symbol-preview";
    preview.alt = "";
    preview.hidden = true;

    const status = document.createElement("span");
    status.className = "dataset-symbol-status";
    status.setAttribute("role", "status");
    status.hidden = true;

    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = text.none;
    select.appendChild(empty);

    const showPreview = () => {
        const key = select.value;
        preview.hidden = !key;
        if (key) preview.src = `/symbol-assets/${encodeURIComponent(key)}.svg`;
    };
    select.addEventListener("change", showPreview);

    label.append(caption, select, preview, status);

    const ready = loadSymbolKeys()
        .then((keys) => {
            for (const key of keys) {
                const option = document.createElement("option");
                option.value = key;
                option.textContent = key.replace(/[-_]/g, " ");
                select.appendChild(option);
            }
            if (selectedKey && keys.includes(selectedKey)) select.value = selectedKey;
            showPreview();
        })
        .catch((error) => {
            status.hidden = false;
            status.textContent = text.unavailable;
            void error;
        });

    return {
        element: label,
        select,
        ready,
        /** The chosen key, or an empty string when the dataset shows no symbol. */
        value: () => select.value,
        /** Whether the person changed the choice this time. */
        changed: () => select.value !== selectedKey,
        /**
         * Assign the chosen symbol to one dataset. Returns true when something
         * was saved, false when nothing changed.
         */
        save: async (tableUID) => {
            if (!tableUID || select.value === selectedKey) return false;
            try {
                await assignDatasetSymbol(tableUID, select.value);
                selectedKey = select.value;
                status.hidden = true;
                return true;
            } catch (error) {
                status.hidden = false;
                status.textContent = text.saveFailed;
                void error;
                return false;
            }
        },
    };
}

/** The keys of the safe symbol registry, in the order the server lists them. */
export async function loadSymbolKeys() {
    const snapshot = await endpoint_router("adminSymbols");
    const symbols = Array.isArray(snapshot?.symbols) ? snapshot.symbols : [];
    return symbols.map((symbol) => String(symbol?.key || "")).filter(Boolean);
}

/** The symbol a dataset currently uses, or an empty string. */
export async function readDatasetSymbol(datasetName) {
    const snapshot = await endpoint_router("adminSymbols");
    const datasets = Array.isArray(snapshot?.datasets) ? snapshot.datasets : [];
    const match = datasets.find((entry) => entry?.dataset_name === datasetName);
    return { iconKey: String(match?.icon_key || ""), tableUID: Number(match?.table_uid || 0) };
}

/** Assign one symbol to one dataset through the administrator's own route. */
export function assignDatasetSymbol(tableUID, iconKey) {
    return endpoint_router("adminSymbols", {
        method: "POST",
        body_data: { target_type: "dataset", target_uid: Number(tableUID), icon_key: String(iconKey || "") },
    });
}
