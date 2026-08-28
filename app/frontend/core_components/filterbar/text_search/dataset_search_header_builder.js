// dataset_search_header_builder.js
// Builds the reusable dataset-search panel header DOM with configurable title language-key mode.
// Bridges filterbar integrations and header DOM by exposing the shared mode constant and title logic.
// Exists to isolate header rendering from component state and search execution.

export const DEFAULT_TITLE_LANG_KEY_MODE = "front_page"; // options: "front_page" | "table_name"

export function applyDatasetSearchTitleLangKey(tableNameElement, tableName, mode) {
    const resolvedMode =
        mode === "front_page" || mode === "table_name"
            ? mode
            : DEFAULT_TITLE_LANG_KEY_MODE;

    if (resolvedMode === "front_page") {
        tableNameElement.textContent = "Front page";
        tableNameElement.title = "Front page";
        tableNameElement.dataset.langKey = `${tableName}_front_page`;
    } else {
        tableNameElement.textContent = tableName;
        tableNameElement.title = tableName;
        tableNameElement.dataset.langKey = tableName;
    }
}

export function buildDatasetSearchHeader(
    tableName,
    {
        titleLangKeyMode = DEFAULT_TITLE_LANG_KEY_MODE,
        headerClassList = [],
        titleWrapperClasses = ["dataset-search-title"],
        titleTextClasses = ["dataset-search-title-text"],
        subtitleWrapperClasses = ["dataset-search-subtitle"],
        subtitleTextClasses = ["dataset-search-subtitle-text"],
        subtitleLangKey = null,
        subtitleFallbackText = "",
        actionsWrapperClasses = [],
        headerActions = [],
    } = {}
) {
    const titleContainer = document.createElement("div");
    titleContainer.classList.add(...headerClassList.filter(Boolean));

    const titleBlock = document.createElement("div");
    titleBlock.classList.add("dataset-search-title-block");

    const tableNameWrapper = document.createElement("div");
    tableNameWrapper.classList.add(...titleWrapperClasses.filter(Boolean));
    const tableNameElement = document.createElement("div");
    tableNameElement.classList.add(...titleTextClasses.filter(Boolean));
    applyDatasetSearchTitleLangKey(tableNameElement, tableName, titleLangKeyMode);
    tableNameWrapper.appendChild(tableNameElement);
    titleBlock.appendChild(tableNameWrapper);

    if (subtitleLangKey) {
        const subtitleWrapper = document.createElement("div");
        subtitleWrapper.classList.add(...subtitleWrapperClasses.filter(Boolean));
        const subtitleElement = document.createElement("div");
        subtitleElement.classList.add(...subtitleTextClasses.filter(Boolean));
        subtitleElement.dataset.langKey = subtitleLangKey;
        subtitleElement.textContent =
            subtitleFallbackText || tableNameElement.textContent || tableName;
        subtitleWrapper.appendChild(subtitleElement);
        titleBlock.appendChild(subtitleWrapper);
    }

    const rightWrapper = document.createElement("div");
    rightWrapper.classList.add(...actionsWrapperClasses.filter(Boolean));
    for (const action of headerActions) {
        if (action) {
            rightWrapper.appendChild(action);
        }
    }

    titleContainer.appendChild(titleBlock);
    titleContainer.appendChild(rightWrapper);

    return titleContainer;
}
