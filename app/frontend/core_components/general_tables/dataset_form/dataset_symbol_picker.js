// dataset_symbol_picker.js
// The dataset form's symbol control, in both modes: the symbols are offered as
// pictures beside their names, and the chosen one is shown in the theme's own
// text colour rather than as a black drawing that a dark background swallows.
// Bridges the form with the safe symbol registry, and through the form's
// persistence adapters with the symbol-assignment route.
// Exists so a dataset's symbol is chosen where the dataset is defined, instead of
// only in a separate administration tool the person has to find afterwards.
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { createVanillaDropdown } from "../../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js";
import { applySymbolMask, createSymbolMaskElement } from "../../../reusable_components/symbol_asset_resolver.js";
import {
    createDatasetFormStatus, datasetFormLabel, datasetFormText,
} from "./dataset_form_text.js";

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

/** The choice that leaves the dataset without a symbol; its value is no key. */
function noSymbolChoice() {
    return { value: "", label: datasetFormText("dataset_symbol_none"), langKey: "dataset_symbol_none" };
}

/** One symbol of the registry, named readably and shown as its own picture. */
function symbolChoice(symbolKey) {
    return { value: symbolKey, label: symbolKey.replace(/[-_]/g, " "), symbolKey };
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
    let offeredKeys = [];
    // Tracked here because the control decides from it whether a choice counts
    // as a change, and a closed control has made no choice.
    let closed = Boolean(stored);

    const label = datasetFormLabel("dataset_symbol_label", "dataset-symbol-picker");
    label.dataset.testid = "dataset-symbol-picker";

    // The dropdown's own box. It keeps the test identity the native control had,
    // so the picture list is found where the list of names used to be.
    const dropdownContainer = document.createElement("div");
    dropdownContainer.className = "dataset-symbol-dropdown";
    dropdownContainer.dataset.testid = "dataset-symbol-select";

    // The chosen symbol beside the control, drawn as a mask in the current text
    // colour. The asset files are black drawings, so a dark theme would
    // otherwise show black on near-black.
    const preview = document.createElement("span");
    preview.className = "dataset-symbol-preview";
    preview.setAttribute("aria-hidden", "true");
    preview.hidden = true;

    const status = createDatasetFormStatus("dataset-symbol-status");

    const showPreview = () => {
        const key = dropdown.getValue() || "";
        preview.hidden = !key;
        if (key) applySymbolMask(preview, key);
    };

    const dropdown = createVanillaDropdown({
        containerElement: dropdownContainer,
        options: [noSymbolChoice()],
        placeholder: datasetFormText("dataset_symbol_choose"),
        searchPlaceholder: datasetFormText("dataset_symbol_search"),
        // "No symbol" is already the way to leave the dataset without one, so a
        // second clearing control would decide the same thing twice.
        showClearButton: false,
        useSearch: true,
        translate: (key) => datasetFormText(key),
        renderOptionLeadingIcon: (option) => (option.symbolKey
            // An empty picture holds the place of "No symbol", so every name
            // begins at the same edge.
            ? createSymbolMaskElement(option.symbolKey, ["dataset-symbol-option-icon"])
            : document.createElement("span")),
        onChange: () => showPreview(),
    });

    label.append(dropdownContainer, preview, status.element);

    /** Offer the registry's symbols, and keep what is already chosen chosen. */
    const offerSymbols = (keys) => {
        offeredKeys = keys;
        const chosenKey = dropdown.getValue() || "";
        dropdown.setOptions([noSymbolChoice(), ...keys.map(symbolChoice)]);
        chooseSymbol(chosenKey);
    };

    /** Show one symbol as the chosen one, without calling it a fresh choice. */
    function chooseSymbol(key) {
        dropdown.setValue(String(key || ""), false);
        showPreview();
    }

    const openControl = () => {
        closed = false;
        dropdown.setDisabled(false);
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
        // just now — is still offered as itself, so an untouched Save never removes it.
        if (storedKey && !offeredKeys.includes(storedKey)) {
            offerSymbols([...offeredKeys, storedKey]);
        }
        chooseSymbol(storedKey);
        openControl();
    };

    dropdown.setDisabled(closed);
    chooseSymbol("");

    const registryRead = loadSymbolKeys()
        .then((keys) => {
            offerSymbols(keys);
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
        dropdown,
        ready,
        /** The chosen symbol key; empty means "No symbol". */
        value: () => dropdown.getValue() || "",
        /** Whether the chosen symbol differs from what the dataset holds. */
        changed: () => !closed && (dropdown.getValue() || "") !== storedKey,
        /** The server now holds the chosen symbol. */
        accept: () => {
            // A new dataset's form starts over without a symbol, so only an
            // existing dataset's baseline advances.
            if (stored) storedKey = dropdown.getValue() || "";
            status.clear();
        },
        /**
         * Back to what the dataset holds. The creating form starts over for the
         * next dataset this way; the dropdown is not a native form control, so
         * the form's own reset does not reach it. Anything the control is
         * saying stays said: a symbol the server has just refused is exactly
         * what the person still needs to read.
         */
        reset: () => chooseSymbol(storedKey),
        /** Show that saving the symbol failed, beside the control. */
        reportFailure: () => status.show("dataset_symbol_save_failed"),
        /** Take the dropdown's own open list and listeners off the page. */
        dispose: () => dropdown.destroy(),
    };
}
