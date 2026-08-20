// row_multilingual_input_builder.js
// Builds one explicit textarea per active content language for multilingual add-row fields.
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

function readInitialLanguageMap(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    if (typeof value !== "string" || !value.trim().startsWith("{")) {
        return {};
    }
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : {};
    } catch (_error) {
        return {};
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
 */
export function buildMultilingualTextareaGroup(container, {
    tableName,
    column,
    initialValue = "",
    fieldName = "",
    idPrefix = "",
    onValueChange = () => {},
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

    const initialMap = readInitialLanguageMap(initialValue);
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
        textarea.value = typeof initialMap[language.languageCode] === "string"
            ? initialMap[language.languageCode]
            : "";

        group.appendChild(label);
        group.appendChild(textarea);
        textareas.push(textarea);
    });

    const syncValue = ({ emit = true } = {}) => {
        const languageMap = Object.fromEntries(textareas.map((textarea) => [
            textarea.dataset.languageCode,
            textarea.value,
        ]));
        const hasAnyValue = Object.values(languageMap).some((value) => value.trim() !== "");
        textareas.forEach((textarea) => {
            textarea.required = requiredBySchema || hasAnyValue;
        });
        const serializedValue = hasAnyValue ? JSON.stringify(languageMap) : "";
        hiddenInput.value = serializedValue;
        if (emit) onValueChange(serializedValue);
        return serializedValue;
    };

    textareas.forEach((textarea) => {
        textarea.addEventListener("input", () => syncValue());
    });
    syncValue({ emit: false });
    container.appendChild(group);

    return {
        group,
        hiddenInput,
        textareas,
        syncValue,
    };
}
