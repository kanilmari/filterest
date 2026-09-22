// dataset_symbol_picker.js
// The dataset form's symbol control, in both modes.
// Bridges the form with the safe symbol registry, and through the form's
// persistence adapters with the symbol-assignment route.
// Exists so a dataset's symbol is chosen where the dataset is defined, instead of
// only in a separate administration tool the person has to find afterwards.
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { createDatasetFormStatus, datasetFormLabel, setDatasetFormText } from "./dataset_form_text.js";

/** The keys of the safe symbol registry, in the order the server lists them. */
export async function loadSymbolKeys() {
    const snapshot = await endpoint_router("adminSymbols");
    const symbols = Array.isArray(snapshot?.symbols) ? snapshot.symbols : [];
    return symbols.map((symbol) => String(symbol?.key || "")).filter(Boolean);
}

/** The symbol a dataset currently uses, or an empty string, and its identity. */
export async function readDatasetSymbol(datasetName) {
    const snapshot = await endpoint_router("adminSymbols");
    const datasets = Array.isArray(snapshot?.datasets) ? snapshot.datasets : [];
    const match = datasets.find((entry) => entry?.dataset_name === datasetName);
    return { iconKey: String(match?.icon_key || ""), tableUID: Number(match?.table_uid || 0) };
}

/**
 * Assign one symbol to one dataset through the administrator's own route. An
 * empty key removes the dataset's symbol. A failure is the caller's to show
 * beside the control, so the router's general notice stays quiet.
 */
export function assignDatasetSymbol(tableUID, iconKey) {
    return endpoint_router("adminSymbols", {
        method: "POST",
        body_data: { target_type: "dataset", target_uid: Number(tableUID), icon_key: String(iconKey || "") },
        suppressErrorToast: true,
    });
}

/**
 * Build the symbol control.
 *
 * @param {object} [options]
 * @param {Promise<{iconKey: string, tableUID: number}>} [options.stored] - when
 *   editing, the symbol the dataset already has and its identity. The control
 *   stays closed until they are known, because the stored symbol is what a
 *   Save compares against: only then is "No symbol" a real change that removes
 *   it, and an untouched symbol is never written again. Without it the control
 *   describes a dataset that does not exist yet, which has no symbol.
 */
export function createDatasetSymbolPicker({ stored = null } = {}) {
    // What the described dataset holds. A dataset that does not exist yet
    // holds nothing.
    let storedKey = "";

    const label = datasetFormLabel("dataset_symbol_label", "dataset-symbol-picker");
    label.dataset.testid = "dataset-symbol-picker";

    const select = document.createElement("select");
    select.name = "icon_key";
    select.dataset.testid = "dataset-symbol-select";

    const preview = document.createElement("img");
    preview.className = "dataset-symbol-preview";
    preview.alt = "";
    preview.hidden = true;

    const status = createDatasetFormStatus("dataset-symbol-status");

    select.appendChild(setDatasetFormText(Object.assign(document.createElement("option"), { value: "" }),
        "dataset_symbol_none"));

    const showPreview = () => {
        const key = select.value;
        preview.hidden = !key;
        if (key) preview.src = `/symbol-assets/${encodeURIComponent(key)}.svg`;
    };
    select.addEventListener("change", showPreview);
    label.append(select, preview, status.element);

    const appendSymbolOption = (key) => {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = key.replace(/[-_]/g, " ");
        select.appendChild(option);
    };

    // Show the symbol the dataset already has and make it the baseline.
    const showStoredSymbol = ({ iconKey, tableUID } = {}) => {
        if (!Number(tableUID)) {
            // Without the dataset's identity nothing can be saved, so the
            // control stays closed instead of accepting a choice it would drop.
            status.show("dataset_symbol_unavailable");
            return;
        }
        storedKey = String(iconKey || "");
        // A stored symbol the registry does not list — retired, or unreadable
        // just now — is still shown as itself, so an untouched Save never removes it.
        if (storedKey && !Array.from(select.options).some((option) => option.value === storedKey)) {
            appendSymbolOption(storedKey);
        }
        select.value = storedKey;
        showPreview();
        select.disabled = false;
    };

    if (stored) select.disabled = true;

    const registryRead = loadSymbolKeys()
        .then((keys) => {
            for (const key of keys) appendSymbolOption(key);
            showPreview();
        })
        .catch((error) => {
            status.show("dataset_symbol_unavailable");
            void error;
        });

    const ready = !stored ? registryRead : registryRead
        .then(() => stored)
        .then(showStoredSymbol, (error) => {
            status.show("dataset_symbol_unavailable");
            void error;
        });

    return {
        element: label,
        select,
        ready,
        /** The chosen symbol key; empty means "No symbol". */
        value: () => select.value,
        /** Whether the chosen symbol differs from what the dataset holds. */
        changed: () => !select.disabled && select.value !== storedKey,
        /** The server now holds the chosen symbol. */
        accept: () => {
            // A new dataset's form starts over without a symbol, so only an
            // existing dataset's baseline advances.
            if (stored) storedKey = select.value;
            status.clear();
        },
        /** Show that saving the symbol failed, beside the control. */
        reportFailure: () => status.show("dataset_symbol_save_failed"),
    };
}
