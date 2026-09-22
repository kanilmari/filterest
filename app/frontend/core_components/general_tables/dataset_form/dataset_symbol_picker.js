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
 * The returned handle saves the chosen symbol to a dataset through the same
 * step in both forms: the one that edits an existing dataset, and the one
 * that has just created a new dataset.
 *
 * @param {object} [options]
 * @param {Promise<{iconKey: string, tableUID: number}>} [options.stored] - in a
 *   form that edits an existing dataset, the symbol it already has and its
 *   identity. The control stays closed until they are known, because the stored
 *   symbol is what a Save compares against: only then is "No symbol" a real
 *   change that removes it, and an untouched symbol is never written again.
 *   Without it the control describes a dataset that does not exist yet, which
 *   has no symbol.
 */
export function createDatasetSymbolPicker({ stored = null } = {}) {
    const text = datasetSymbolCopy();
    // What the described dataset holds. A new dataset holds nothing, and every
    // dataset the creation form makes is new, so only a stored one advances.
    let storedKey = "";
    let storedTableUID = 0;

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
    status.className = "dataset-symbol-status dataset-form-status";
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

    const appendSymbolOption = (key) => {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = key.replace(/[-_]/g, " ");
        select.appendChild(option);
    };

    const showStatus = (message) => {
        status.hidden = false;
        status.textContent = message;
    };

    // Show the symbol the dataset already has and make it the baseline.
    const showStoredSymbol = ({ iconKey, tableUID } = {}) => {
        storedTableUID = Number(tableUID) || 0;
        if (!storedTableUID) {
            // Without the dataset's identity nothing can be saved, so the
            // control stays closed instead of accepting a choice it would drop.
            showStatus(text.unavailable);
            return;
        }
        storedKey = String(iconKey || "");
        // A stored symbol the registry does not list — retired, or unreadable
        // just now — is still shown as itself, so an untouched Save never
        // removes it.
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
            showStatus(text.unavailable);
            void error;
        });

    const ready = !stored ? registryRead : registryRead
        .then(() => stored)
        .then(showStoredSymbol, (error) => {
            showStatus(text.unavailable);
            void error;
        });

    return {
        element: label,
        select,
        ready,
        /**
         * Whether the chosen symbol differs from what the dataset holds. The
         * creation form asks this before looking up the new dataset's identity,
         * which is needed only when there is something to save.
         */
        changed: () => select.value !== storedKey,
        /**
         * Assign the chosen symbol to one dataset; "No symbol" removes the one
         * it had. Returns "saved", "unchanged" or "failed", like the dataset's
         * other settings; a failure is shown beside the control.
         *
         * @param {number} [tableUID] - the dataset the creation form has just
         *   made; the editing form leaves it out and saves to the `stored` one
         */
        save: async (tableUID = storedTableUID) => {
            if (select.disabled || select.value === storedKey) return "unchanged";
            if (!tableUID) {
                showStatus(text.saveFailed);
                return "failed";
            }
            try {
                await assignDatasetSymbol(tableUID, select.value);
                if (stored) storedKey = select.value;
                status.hidden = true;
                return "saved";
            } catch (error) {
                showStatus(text.saveFailed);
                void error;
                return "failed";
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

/**
 * Assign one symbol to one dataset through the administrator's own route. An
 * empty key removes the dataset's symbol. A failure is the caller's to show
 * beside its own control, so the router's general notice stays quiet.
 */
export function assignDatasetSymbol(tableUID, iconKey) {
    return endpoint_router("adminSymbols", {
        method: "POST",
        body_data: { target_type: "dataset", target_uid: Number(tableUID), icon_key: String(iconKey || "") },
        suppressErrorToast: true,
    });
}
