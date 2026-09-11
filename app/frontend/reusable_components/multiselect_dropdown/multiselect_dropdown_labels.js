// multiselect_dropdown_labels.js
// Refreshes a mounted multiselect's visible and accessible labels in place.
// Bridges caller-owned translations with the widget's existing input and option nodes.
// Keeps language changes separate from selection, focus, search and popup lifecycle.

export function createMultiselectLabelUpdater({
    labels, input, searchInput, clearButton, optionsList, updateDisplay, isDestroyed,
}) {
    return (nextLabels = {}) => {
        if (isDestroyed() || !nextLabels || typeof nextLabels !== "object") return;
        for (const key of Object.keys(labels)) {
            if (typeof nextLabels[key] === "string") labels[key] = nextLabels[key];
        }
        input.placeholder = labels.placeholder;
        if (searchInput) {
            searchInput.placeholder = labels.searchPlaceholder;
            searchInput.setAttribute("aria-label", labels.searchPlaceholder);
        }
        clearButton.title = labels.clearLabel;
        clearButton.setAttribute("aria-label", labels.clearLabel);
        optionsList.querySelectorAll(".msd-no-results").forEach((element) => {
            element.textContent = labels.noResultsLabel;
        });
        optionsList.querySelectorAll(".msd-option-action").forEach((button) => {
            const reset = button.dataset.action === "reset";
            const label = reset ? labels.resetLabel : labels.excludeLabel;
            const optionLabel = button.closest(".msd-option")
                ?.querySelector(".msd-option-label")?.textContent || "";
            button.textContent = label;
            button.title = reset ? labels.resetTooltip : labels.excludeTooltip;
            button.setAttribute("aria-label", `${label} ${optionLabel}`);
        });
        updateDisplay();
    };
}
