// view_field_assignments_dom.js
// Provides the small DOM and response-boundary helpers shared by the view field assignment page.
// Keeps rendering orchestration below the repository file-size limit without weakening fail-closed checks.

export function createViewAssignmentTextElement(tagName, className, text, langKey = "") {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (langKey) element.dataset.langKey = langKey;
    element.textContent = text;
    return element;
}

export function availableViewAssignmentFields(response) {
    return Array.isArray(response?.available_column_details)
        && response.available_column_details.length > 0
        ? response.available_column_details
        : response?.available_columns;
}

export function assertViewFieldAssignmentsResponseTarget(response, dataset, viewKey) {
    if (response?.dataset !== dataset || response?.view_key !== viewKey) {
        throw new Error("view field assignment response target mismatch");
    }
    if (response?.can_edit_site_default !== true) {
        throw new Error("view field assignment administrator permission missing");
    }
    return response;
}
