// row_multilingual_input_builder.js
// Builds one explicit textarea per active content language for multilingual row fields.
// Bridges column metadata, the language registry contract, and serialized row payload values.
// Exists so row creation cannot silently store one scalar value in a multilingual column.

function normalizedLanguageOptions(column = {}) {
    const seen = new Set();
    return (Array.isArray(column.multilingual_languages)
        ? column.multilingual_languages
        : [])
        .map((language) => ({
            languageCode: String(language?.language_code || "").trim(),
            englishName: String(language?.english_name || "").trim(),
            nativeName: String(language?.native_name || "").trim(),
            isDefault: language?.is_default === true,
            sortOrder: Number(language?.sort_order) || 0,
        }))
        .filter((language) => {
            if (!language.languageCode || seen.has(language.languageCode)) return false;
            seen.add(language.languageCode);
            return true;
        });
}

function readInitialLanguageMap(value, defaultLanguageCode = "") {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    if (typeof value !== "string" || !value.trim().startsWith("{")) {
        return typeof value === "string" && defaultLanguageCode
            ? { [defaultLanguageCode]: value }
            : {};
    }
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : {};
    } catch (_error) {
        return defaultLanguageCode ? { [defaultLanguageCode]: value } : {};
    }
}

function languageLabel(language) {
    const name = language.nativeName || language.englishName || language.languageCode;
    return `${language.languageCode.toUpperCase()} — ${name}`;
}

function supportsMultilingualColumnType(dataType) {
    const normalized = String(dataType || "").trim().toLowerCase();
    return normalized === "text"
        || normalized === "json"
        || normalized === "jsonb"
        || normalized.includes("character")
        || normalized.includes("varchar");
}

/**
 * Builds a multilingual field group and emits only a serialized language map.
 * Every active language becomes required when the database field is required,
 * or when the user starts filling an otherwise optional multilingual field.
 * Editors may opt into partial translations and legacy text in the default
 * language; add-row callers retain their complete-map and draft-loading rules.
 * A partial-translation editor also keeps the stored text of languages that
 * have no field here (for example a deactivated language), so saving cannot drop it.
 */
export function buildMultilingualTextareaGroup(container, {
    tableName,
    column,
    initialValue = "",
    fieldName = "",
    idPrefix = "",
    onValueChange = () => {},
    allowPartialTranslations = false,
    legacyValueToDefaultLanguage = false,
} = {}) {
    if (!supportsMultilingualColumnType(column?.data_type)) {
        throw new Error(
            `Multilingual add-row fields require a text or JSON column; ${column?.column_name || "field"} uses ${column?.data_type || "unknown"}.`
        );
    }
    const languages = normalizedLanguageOptions(column);
    if (languages.length === 0) {
        throw new Error(`No active content languages are configured for ${column?.column_name || "field"}.`);
    }

    const group = document.createElement("fieldset");
    group.classList.add("row-creation-multilingual-field");
    group.dataset.multilingualColumn = column.column_name;

    const legend = document.createElement("legend");
    legend.dataset.langKey = column.column_name;
    legend.textContent = column.column_name;
    group.appendChild(legend);

    const hiddenInput = document.createElement("input");
    hiddenInput.type = "hidden";
    if (fieldName) {
        hiddenInput.name = fieldName;
        hiddenInput.dataset.testid = `form-input-${column.column_name}`;
        group.appendChild(hiddenInput);
    }

    const defaultLanguageCode = legacyValueToDefaultLanguage
        ? (languages.find((language) => language.isDefault) || languages[0]).languageCode
        : "";
    const textareas = [];
    const requiredBySchema = String(column.is_nullable || "").toLowerCase() === "no";
    const safePrefix = idPrefix || `${tableName}-${column.column_name}`;

    languages.forEach((language) => {
        const label = document.createElement("label");
        const inputId = `${safePrefix}-${language.languageCode}-input`;
        label.htmlFor = inputId;
        label.textContent = languageLabel(language);

        const textarea = document.createElement("textarea");
        textarea.id = inputId;
        textarea.name = `${column.column_name}__lang_${language.languageCode}`;
        textarea.dataset.languageCode = language.languageCode;
        textarea.dataset.testid = `form-input-${column.column_name}-${language.languageCode}`;
        textarea.rows = 2;
        textarea.classList.add("auto_resize_textarea");

        group.appendChild(label);
        group.appendChild(textarea);
        textareas.push(textarea);
    });

    let fieldlessEntries = [];
    const syncValue = ({ emit = true } = {}) => {
        const languageMap = Object.fromEntries([
            ...textareas.map((textarea) => [textarea.dataset.languageCode, textarea.value]),
            ...fieldlessEntries,
        ].filter(([, value]) => !allowPartialTranslations || value.trim() !== ""));
        const hasAnyValue = Object.values(languageMap).some((value) => value.trim() !== "");
        textareas.forEach((textarea) => {
            textarea.required = !allowPartialTranslations && (requiredBySchema || hasAnyValue);
        });
        const serializedValue = hasAnyValue ? JSON.stringify(languageMap) : "";
        hiddenInput.value = serializedValue;
        if (emit) onValueChange(serializedValue);
        return serializedValue;
    };

    textareas.forEach((textarea) => {
        textarea.addEventListener("input", () => syncValue());
    });
    // Loading and resetting share the same map reader as initial rendering.
    const setValue = (value) => {
        const languageMap = readInitialLanguageMap(value, defaultLanguageCode);
        textareas.forEach((textarea) => {
            const text = languageMap[textarea.dataset.languageCode];
            textarea.value = typeof text === "string" ? text : "";
        });
        const fieldCodes = new Set(textareas.map((textarea) => textarea.dataset.languageCode));
        fieldlessEntries = allowPartialTranslations
            ? Object.entries(languageMap).filter(([languageCode, text]) =>
                !fieldCodes.has(languageCode) && typeof text === "string")
            : [];
        return syncValue({ emit: false });
    };
    setValue(initialValue);
    container.appendChild(group);

    return {
        group,
        hiddenInput,
        textareas,
        syncValue,
        setValue,
    };
}
