// empty_value_printer.js
// Prints the shared placeholder for an empty card or key/value field.
// Connects every card renderer to the page's tooltip and accessible-label translations.
// Keeps empty dates and other empty values readable without changing field layout.

/** Whether a display value has no content; zero and false remain real values. */
export function isEmptyValue(value) {
    return value === null || value === undefined || value === "";
}

/** Print an empty value, returning whether the caller's normal rendering can stop. */
export function printEmptyValue(element, value, translate = () => undefined) {
    if (!isEmptyValue(value)) {
        // A reused field can become populated after inline editing.
        if (element.dataset.titleLangKey === "unknown") {
            delete element.dataset.titleLangKey;
            delete element.dataset.ariaLabelLangKey;
            element.removeAttribute("title");
            element.removeAttribute("aria-label");
        }
        return false;
    }
    element.textContent = "—";
    element.dataset.titleLangKey = "unknown";
    element.dataset.ariaLabelLangKey = "unknown";
    const label = translate("unknown") || "Unknown";
    element.title = label;
    element.setAttribute("aria-label", label);
    return true;
}
