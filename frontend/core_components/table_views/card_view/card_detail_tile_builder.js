// card_detail_tile_builder.js
// Builds icon-led modern card detail tiles from row detail metadata.
// Bridges table read metadata, per-column icon keys, and the modern card variant DOM.
// Exists so the opt-in modern card layout can stay separate from legacy detail renderers.

import {
    appendConfiguredCardDetailIcon,
    normalizeClientCardDetailLabelMode,
} from "./card_detail_single_line_helpers.js";

const MODERN_CARD_DETAIL_DESKTOP_COLUMNS = 2;
const MODERN_CARD_DETAIL_LABEL_MIN_CH = 4;
const MODERN_CARD_DETAIL_LABEL_MAX_CH = 32;

function resolveCardDetailMetadata(detailEntry, dataTypes = {}) {
    const metadataColumnName = String(
        detailEntry?.sourceColumn
        || detailEntry?.dataColumn
        || detailEntry?.column
        || ""
    ).trim();

    return dataTypes[metadataColumnName] || {};
}

function createModernCardDetailTileValue(detailEntry) {
    const valueElement = document.createElement("div");
    valueElement.className = "card_detail_tile_value";

    const displayValue = String(detailEntry?.rawValue ?? "").trim();
    if (!displayValue) {
        valueElement.classList.add("card_detail_tile_value--empty");
        valueElement.textContent = "—";
        return valueElement;
    }

    valueElement.title = detailEntry?.titleValue || displayValue;
    const href = String(
        detailEntry?.href || (detailEntry?.isLink === true ? detailEntry?.rawValue : "") || ""
    ).trim();

    if (!href) {
        valueElement.textContent = displayValue;
        return valueElement;
    }

    const linkElement = document.createElement("a");
    linkElement.className = "card_detail_tile_value_link";
    linkElement.href = href;
    linkElement.textContent = displayValue;
    if (detailEntry?.isLink === true && !detailEntry?.href) {
        linkElement.target = "_blank";
        linkElement.rel = "noopener noreferrer";
    }
    valueElement.appendChild(linkElement);
    return valueElement;
}

function createModernCardDetailTileLabel(detailEntry, labelMode, renderedIcon) {
    const labelText = String(detailEntry?.label || detailEntry?.column || "").trim();
    if (!labelText || (labelMode === "icon" && renderedIcon)) {
        return null;
    }

    const labelElement = document.createElement("div");
    labelElement.className = "card_detail_tile_label";
    labelElement.textContent = labelText;
    if (detailEntry?.labelKey || detailEntry?.column) {
        labelElement.dataset.langKey = detailEntry.labelKey || detailEntry.column;
    }
    return labelElement;
}

function getModernCardDetailDesktopRowCount(detailEntries) {
    const entryCount = Array.isArray(detailEntries) ? detailEntries.length : 0;
    return Math.max(
        1,
        Math.ceil(entryCount / MODERN_CARD_DETAIL_DESKTOP_COLUMNS)
    );
}

function setModernCardDetailLabelColumnWidth(containerElement, maxVisibleLabelLength) {
    const labelWidthCh = Math.min(
        MODERN_CARD_DETAIL_LABEL_MAX_CH,
        Math.max(MODERN_CARD_DETAIL_LABEL_MIN_CH, maxVisibleLabelLength + 1)
    );
    containerElement.style.setProperty(
        "--card-detail-tile-label-width",
        `${labelWidthCh}ch`
    );
}

export function renderModernCardDetails(containerElement, detailEntries, dataTypes = {}) {
    const entries = Array.isArray(detailEntries) ? detailEntries : [];
    const desktopRowCount = getModernCardDetailDesktopRowCount(entries);
    let maxVisibleLabelLength = 0;
    containerElement.classList.add("card_details_modern_tiles");
    containerElement.style.setProperty(
        "--card-details-modern-rows",
        String(desktopRowCount)
    );

    entries.forEach((detailEntry, entryIndex) => {
        const desktopRowIndex = entryIndex % desktopRowCount;
        const desktopColumnIndex = Math.floor(entryIndex / desktopRowCount);
        const tile = document.createElement("div");
        tile.className = "card_detail_tile";
        if (desktopRowIndex > 0) {
            tile.classList.add("card_detail_tile--row-separated");
        }
        if (desktopColumnIndex > 0) {
            tile.classList.add("card_detail_tile--column-separated");
        }
        if (detailEntry?.columnClass) {
            tile.classList.add(detailEntry.columnClass);
        }

        const iconElement = document.createElement("div");
        iconElement.className = "card_detail_tile_icon";
        const labelMeta = resolveCardDetailMetadata(detailEntry, dataTypes);
        const labelMode = normalizeClientCardDetailLabelMode(
            labelMeta?.card_detail_label_mode
        );
        const renderedIcon = appendConfiguredCardDetailIcon(
            iconElement,
            labelMeta,
            detailEntry?.column
        );

        const labelText = String(detailEntry?.label || detailEntry?.column || "").trim();
        if (!renderedIcon) {
            iconElement.classList.add("card_detail_tile_icon--empty");
            iconElement.textContent = labelText ? labelText.charAt(0).toUpperCase() : "#";
        } else {
            iconElement.setAttribute("aria-hidden", "true");
        }

        const textElement = document.createElement("div");
        textElement.className = "card_detail_tile_text";

        const labelElement = createModernCardDetailTileLabel(
            detailEntry,
            labelMode,
            renderedIcon
        );
        if (labelElement) {
            maxVisibleLabelLength = Math.max(
                maxVisibleLabelLength,
                labelElement.textContent.length
            );
        } else if (labelText) {
            tile.setAttribute("aria-label", labelText);
            tile.title = labelText;
            tile.classList.add("card_detail_tile--value-only");
            textElement.classList.add("card_detail_tile_text--value-only");
        } else {
            tile.classList.add("card_detail_tile--value-only");
            textElement.classList.add("card_detail_tile_text--value-only");
        }

        const valueElement = createModernCardDetailTileValue(detailEntry);
        if (labelElement) {
            textElement.appendChild(labelElement);
        }
        textElement.appendChild(valueElement);
        tile.appendChild(iconElement);
        tile.appendChild(textElement);
        containerElement.appendChild(tile);
    });

    setModernCardDetailLabelColumnWidth(containerElement, maxVisibleLabelLength);
}
