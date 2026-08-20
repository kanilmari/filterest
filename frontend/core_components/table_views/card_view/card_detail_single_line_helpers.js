// card_detail_single_line_helpers.js
// Renders single-line card detail rows with filesystem-backed metadata symbols.
// Bridges metadata-driven label/icon settings and the card detail DOM structure.
// Exists so database-held legacy SVG can never enter the DOM rendering path.

import { resolveCardDetailIconKey } from "./card_detail_icon_builder.js";
import { createSymbolMaskElement } from "../../../reusable_components/symbol_asset_resolver.js";
import { resolveSafeExternalHttpUrl } from "../../../reusable_components/safe_external_http_url.js";

const SINGLE_LINE_CARD_DETAIL_DESKTOP_COLUMNS = 2;
const FALLBACK_CARD_DETAIL_ICON_KEY = "info";

export function normalizeClientCardDetailLabelMode(labelMode) {
    const normalized = String(labelMode || "").trim().toLowerCase();
    if (normalized === "icon" || normalized === "both") {
        return normalized;
    }
    return "label";
}

function resolveCardDetailMetadata(detailEntry, dataTypes = {}) {
    const metadataColumnName = String(
        detailEntry?.sourceColumn
        || detailEntry?.dataColumn
        || detailEntry?.column
        || ""
    ).trim();

    return dataTypes[metadataColumnName] || {};
}

export function appendConfiguredCardDetailIcon(container, labelMeta = {}, columnName = "") {
    const resolvedKey = resolveCardDetailIconKey(
        labelMeta?.card_detail_icon_key,
        columnName
    );
    if (resolvedKey) {
        container.appendChild(createSymbolMaskElement(resolvedKey, "card_detail_row_icon_svg"));
        return true;
    }

    container.appendChild(createSymbolMaskElement(
        FALLBACK_CARD_DETAIL_ICON_KEY,
        "card_detail_row_icon_svg"
    ));
    return true;
}

/**
 * Calculates desktop rows so CSS grid fills one visual column before the next.
 * Bridges the single-line renderer and the conditional KV ordering convention.
 * Exists so one-column mobile layout keeps DOM order while desktop matches conditional.
 */
function getSingleLineCardDetailDesktopRowCount(detailEntries) {
    const entryCount = Array.isArray(detailEntries) ? detailEntries.length : 0;
    return Math.max(
        1,
        Math.ceil(entryCount / SINGLE_LINE_CARD_DETAIL_DESKTOP_COLUMNS)
    );
}

/**
 * Applies shared KV classes and layout metadata to the single-line detail root.
 * Bridges the specialized icon-aware helper and the conditional_multiline base CSS.
 * Exists to keep spacing/surface/order aligned without enabling multiline wrapping.
 */
function prepareSingleLineCardDetailContainer(containerElement, detailEntries) {
    containerElement.classList.add(
        "card_details_single_line",
        "kv-display",
        "kv-conditional"
    );
    containerElement.style.setProperty(
        "--card-details-single-line-rows",
        String(getSingleLineCardDetailDesktopRowCount(detailEntries))
    );
}

function createSingleLineCardDetailValue(detailEntry) {
    const valueContainer = document.createElement("span");
    valueContainer.className = "card_detail_row_value kv-value kv-conditional-value";

    const displayValue = String(detailEntry?.rawValue ?? "").trim();
    if (!displayValue) {
        valueContainer.classList.add("card_detail_row_value--empty", "kv-empty");
        valueContainer.textContent = "—";
        return valueContainer;
    }

    valueContainer.title = detailEntry?.titleValue || displayValue;

    const explicitHref = String(detailEntry?.href || "").trim();
    const href = explicitHref || (
        detailEntry?.isLink === true
            ? resolveSafeExternalHttpUrl(detailEntry?.rawValue)
            : ""
    );

    if (!href) {
        valueContainer.textContent = displayValue;
        return valueContainer;
    }

    const linkElement = document.createElement("a");
    linkElement.className = "card_detail_row_value_link";
    linkElement.href = href;
    linkElement.textContent = displayValue;
    if (detailEntry?.isLink === true && !detailEntry?.href) {
        linkElement.target = "_blank";
        linkElement.rel = "noopener noreferrer";
    }
    valueContainer.appendChild(linkElement);
    return valueContainer;
}

export function renderSingleLineCardDetails(containerElement, detailEntries, dataTypes = {}) {
    const entries = Array.isArray(detailEntries) ? detailEntries : [];
    prepareSingleLineCardDetailContainer(containerElement, entries);

    entries.forEach((detailEntry) => {
        const row = document.createElement("div");
        row.className = "card_detail_row_single_line kv-pair-conditional";
        if (detailEntry?.columnClass) {
            row.classList.add(detailEntry.columnClass);
        }

        const label = document.createElement("div");
        label.className = "card_detail_row_label kv-key kv-conditional-key";
        const labelMeta = resolveCardDetailMetadata(detailEntry, dataTypes);
        const labelMode = normalizeClientCardDetailLabelMode(
            labelMeta?.card_detail_label_mode
        );

        const labelText = String(detailEntry?.label || detailEntry?.column || "").trim();
        const displayValue = String(detailEntry?.rawValue ?? "").trim();
        const renderedIcon = (
            labelMode === "icon" || labelMode === "both"
        ) && appendConfiguredCardDetailIcon(label, labelMeta, detailEntry?.column);

        if (renderedIcon && labelMode === "icon" && labelText) {
            label.setAttribute("aria-label", labelText);
            label.title = labelText;
        }

        const shouldRenderLabelText = labelMode === "label" || labelMode === "both" || !renderedIcon;
        if (shouldRenderLabelText && labelText) {
            const labelTextElement = document.createElement("span");
            labelTextElement.className = "card_detail_row_label_text";
            labelTextElement.textContent = labelText;
            if (detailEntry?.labelKey || detailEntry?.column) {
                labelTextElement.dataset.langKey = detailEntry.labelKey || detailEntry.column;
            }
            label.appendChild(labelTextElement);
        }
        if (!displayValue) {
            label.classList.add("kv-empty");
        }

        if (!label.childNodes.length) {
            row.classList.add("card_detail_row_single_line--value-only");
        } else {
            row.appendChild(label);
        }

        row.appendChild(createSingleLineCardDetailValue(detailEntry));
        containerElement.appendChild(row);
    });
}
