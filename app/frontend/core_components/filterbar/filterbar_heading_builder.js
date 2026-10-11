// filterbar_heading_builder.js
// Builds dataset headings and article close controls.
// Connects the shared dataset filterbar to its existing component builders.
// Keeps one implementation and a bounded lifetime for each mounted surface.

import { createSymbolMaskElement } from "../../reusable_components/symbol_asset_resolver.js";
import { createDatasetHeadingTitle } from "./dataset_heading_title_writer.js";

export function createDatasetTitleIcon(iconKey, className = "filterbar-dataset-title-icon") {
    if (typeof iconKey !== "string" || !iconKey.trim()) {
        return null;
    }
    return createSymbolMaskElement(iconKey, className);
}

export function resolveDatasetIconKey(tableName, tableSpec = {}) {
    if (tableSpec.icon_key) {
        return tableSpec.icon_key;
    }
    return "";
}

export function resolveDatasetHeaderTitleOverride(tableName, tableSpec = {}) {
    if (typeof tableSpec.display_name !== "string") {
        return "";
    }

    const trimmedDisplayName = tableSpec.display_name.trim();
    if (!trimmedDisplayName) {
        return "";
    }

    if (trimmedDisplayName === String(tableName || "").trim()) {
        return "";
    }

    return trimmedDisplayName;
}

export function buildFilterbarHeroHeader(tableName, {
    headerTitleOverride = "",
    sloganOverride = "",
    iconKey = undefined,
} = {}) {
    const header = document.createElement("div");
    header.classList.add("morphing-header");

    const heroIcon = createDatasetTitleIcon(iconKey, "filterbar-hero-dataset-icon");
    if (heroIcon) {
        header.appendChild(heroIcon);
    }

    // The heading's own module decides whether the site name belongs in front of the
    // dataset title, because a dataset title may already open with that name.
    const titleEl = createDatasetHeadingTitle(tableName, headerTitleOverride);

    const subtitleEl = document.createElement("p");
    subtitleEl.classList.add("morphing-subtitle");
    if (sloganOverride) {
        subtitleEl.textContent = sloganOverride;
    } else {
        subtitleEl.dataset.langKey = `search_slogan_${tableName}`;
        subtitleEl.textContent = `Search ${tableName}`;
    }

    header.appendChild(titleEl);
    header.appendChild(subtitleEl);

    return header;
}

export function formatDatasetTitleFallback(tableName) {
    return String(tableName || "")
        .replace(/^app_/, "")
        .replace(/^system_/, "")
        .replace(/_/g, " ")
        .trim()
        .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Dataset";
}

export function buildFilterbarDatasetTitleRow(tableName, tableSpec = {}, titleOverride = "") {
    const row = document.createElement("div");
    row.classList.add("filterbar-dataset-title-row");

    const datasetIcon = createDatasetTitleIcon(resolveDatasetIconKey(tableName, tableSpec));
    if (datasetIcon) {
        row.appendChild(datasetIcon);
    }

    const label = document.createElement("span");
    label.classList.add("filterbar-dataset-title-text");
    label.dataset.langKey = tableName;
    label.textContent = titleOverride || formatDatasetTitleFallback(tableName);
    row.appendChild(label);

    return row;
}

export function buildSharedTopBarDatasetTitle(tableName, titleOverride = "") {
    const title = document.createElement("div");
    title.classList.add("dataset-shared-topbar__dataset-title");
    title.dataset.langKey = tableName;
    title.textContent = titleOverride || formatDatasetTitleFallback(tableName);
    return title;
}

export function buildSharedTopBarArticleCloseButton(onClose) {
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.classList.add("dataset-shared-topbar__article-close");
    closeButton.dataset.testid = "shared-topbar-article-close";
    closeButton.title = "Palaa korttinäkymään";
    closeButton.setAttribute("aria-label", "Palaa korttinäkymään");
    closeButton.setAttribute("aria-hidden", "true");
    closeButton.tabIndex = -1;
    closeButton.hidden = true;
    closeButton.textContent = "×";
    closeButton.addEventListener("click", onClose);
    return closeButton;
}

