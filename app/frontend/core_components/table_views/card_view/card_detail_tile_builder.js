// card_detail_tile_builder.js
// Builds icon-led modern card detail tiles from row detail metadata.
// Bridges table read metadata, per-column icon keys, and the modern card variant DOM.
// Exists so the opt-in modern card layout can stay separate from legacy detail renderers.

import { applyLabelValueLayout } from "../../../reusable_components/key_value_container/label_value_layout.js";
import {
    appendConfiguredCardDetailIcon,
    normalizeClientCardDetailLabelMode,
    resolveCardDetailFieldLabelPlacement,
    resolveCardDetailMetadata,
} from "./card_detail_single_line_helpers.js";
import { CARD_FIELD_LABEL_PLACEMENTS } from "./card_field_label_placement.js";
import { resolveSafeExternalHttpUrl } from "../../../reusable_components/safe_external_http_url.js";

import { DEFAULT_CARD_DETAIL_COLUMNS, normalizeCardDetailColumns } from "./card_detail_layout_options.js";

const MODERN_CARD_DETAIL_DESKTOP_COLUMNS = DEFAULT_CARD_DETAIL_COLUMNS;
const MODERN_CARD_DETAIL_LABEL_MIN_CH = 4;
const MODERN_CARD_DETAIL_LABEL_MAX_CH = 32;

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
    const explicitHref = String(detailEntry?.href || "").trim();
    const href = explicitHref || (
        detailEntry?.isLink === true
            ? resolveSafeExternalHttpUrl(detailEntry?.rawValue)
            : ""
    );

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

function createModernCardDetailTileLabel(detailEntry, labelMode, renderedIcon, labelPlacement) {
    const labelText = String(detailEntry?.label || detailEntry?.column || "").trim();
    if (
        !labelText
        || labelPlacement === CARD_FIELD_LABEL_PLACEMENTS.HIDDEN
        || (labelMode === "icon" && renderedIcon)
    ) {
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

/** Prepare all width bands once. CSS changes layout without replacing live field/link nodes. */
function prepareResponsiveCardDetailLayouts(container, entryCount, requestedColumns) {
    const columns = normalizeCardDetailColumns(requestedColumns);
    const layouts = [1, 2, 3, 4].map(limit => {
        const count = Math.min(columns, limit);
        const rows = Math.max(1, Math.ceil(entryCount / count));
        return { limit, count, rows, slots: entryCount ? count * rows : 0 };
    });
    container.classList.add("card_details_modern_tiles--responsive");
    container.querySelectorAll(".card_detail_tile--placeholder").forEach(tile => tile.remove());
    const maximumSlots = Math.max(...layouts.map(layout => layout.slots));
    for (let index = entryCount; index < maximumSlots; index += 1) {
        const tile = document.createElement("div");
        tile.className = "card_detail_tile card_detail_tile--placeholder";
        tile.setAttribute("aria-hidden", "true");
        container.append(tile);
    }
    layouts.forEach(({ limit, count, rows, slots }) => {
        container.style.setProperty("--card-details-columns-" + limit, String(count));
        container.style.setProperty("--card-details-rows-" + limit, String(rows));
        [...container.children].forEach((tile, index) => {
            tile.style.setProperty("--card-detail-display-" + limit, index < slots ? "grid" : "none");
            tile.style.setProperty("--card-detail-top-" + limit, index % rows > 0 ? "1px" : "0px");
            tile.style.setProperty("--card-detail-left-" + limit, Math.floor(index / rows) > 0 ? "1px" : "0px");
        });
    });
}

export function renderModernCardDetails(containerElement, detailEntries, dataTypes = {}, { columns } = {}) {
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

        // The column decides where its name goes; one row's text never does.
        const labelPlacement = resolveCardDetailFieldLabelPlacement(labelText, labelMeta);
        const labelElement = createModernCardDetailTileLabel(
            detailEntry,
            labelMode,
            renderedIcon,
            labelPlacement
        );
        textElement.dataset.cardLabelPlacement = labelPlacement;
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
        applyLabelValueLayout(textElement, labelElement, valueElement, labelMeta?.label_value_layout);
        tile.appendChild(iconElement);
        tile.appendChild(textElement);
        containerElement.appendChild(tile);
    });

    if (entries.length > 1 && entries.length % MODERN_CARD_DETAIL_DESKTOP_COLUMNS !== 0) {
        const placeholder = document.createElement("div");
        placeholder.className = [
            "card_detail_tile",
            "card_detail_tile--row-separated",
            "card_detail_tile--column-separated",
            "card_detail_tile--placeholder",
        ].join(" ");
        placeholder.setAttribute("aria-hidden", "true");
        containerElement.appendChild(placeholder);
    }

    setModernCardDetailLabelColumnWidth(containerElement, maxVisibleLabelLength);
    // Article-side summaries omit the option and keep their existing two-column/mobile CSS.
    if (columns !== undefined) prepareResponsiveCardDetailLayouts(containerElement, entries.length, columns);
}
