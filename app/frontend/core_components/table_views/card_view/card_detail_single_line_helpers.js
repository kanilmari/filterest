// card_detail_single_line_helpers.js
// Renders single-line card detail rows with filesystem-backed metadata symbols.
// Bridges metadata-driven label/icon settings and the card detail DOM structure.
// Also holds the label/icon helpers the other card detail renderers share, so a
// detail field is described the same way whichever renderer draws it.
// Exists so database-held legacy SVG can never enter the DOM rendering path.

import { applyLabelValueLayout } from "../../../reusable_components/key_value_container/label_value_layout.js";
import { resolveCardDetailIconKey } from "./card_detail_icon_builder.js";
import { createSymbolMaskElement } from "../../../reusable_components/symbol_asset_resolver.js";
import { resolveSafeExternalHttpUrl } from "../../../reusable_components/safe_external_http_url.js";
import { normalizeCardDetailColumns } from "./card_detail_layout_options.js";
import { parseRoleString } from "./card_field_formatter.js";
import {
    CARD_FIELD_LABEL_PLACEMENTS,
    resolveCardFieldLabelPlacement,
} from "./card_field_label_placement.js";

const SINGLE_LINE_CARD_DETAIL_DESKTOP_COLUMNS = 2;
const FALLBACK_CARD_DETAIL_ICON_KEY = "info";

export function normalizeClientCardDetailLabelMode(labelMode) {
    const normalized = String(labelMode || "").trim().toLowerCase();
    if (normalized === "icon" || normalized === "both") {
        return normalized;
    }
    return "label";
}

/**
 * Where one card detail field's name goes, read from the column that owns it.
 *
 * This is the detail renderers' adapter to the one card-wide rule in
 * card_field_label_placement.js: it unpacks the column's own description — its
 * card roles, its declared type and its stated arrangement — and asks that rule.
 * It decides nothing itself, so a tile, a single-line row and a key/value pair
 * can never answer the same question differently.
 *
 * @param {string} labelText - the field's name as this card would print it
 * @param {object} [labelMeta] - the column's metadata row
 * @returns {"hidden"|"inline"|"stacked"}
 */
export function resolveCardDetailFieldLabelPlacement(labelText, labelMeta = {}) {
    return resolveCardFieldLabelPlacement({
        labelRequested: Boolean(String(labelText || "").trim()),
        baseRoles: parseRoleString(labelMeta?.card_element || "").baseRoles,
        dataType: labelMeta?.data_type,
        labelValueLayout: labelMeta?.label_value_layout,
    });
}

export function resolveCardDetailMetadata(detailEntry, dataTypes = {}) {
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
function prepareSingleLineCardDetailContainer(containerElement, detailEntries, columns) {
    containerElement.classList.add(
        "card_details_single_line",
        "kv-display",
        "kv-conditional"
    );
    containerElement.style.setProperty(
        "--card-details-single-line-rows",
        String(getSingleLineCardDetailDesktopRowCount(detailEntries))
    );
    if (columns !== undefined) {
        const requestedColumns = normalizeCardDetailColumns(columns);
        containerElement.classList.add("card_details_single_line--responsive");
        for (const widthLimit of [1, 2, 3, 4]) {
            const count = Math.min(requestedColumns, widthLimit);
            containerElement.style.setProperty("--card-single-columns-" + widthLimit, String(count));
            containerElement.style.setProperty("--card-single-rows-" + widthLimit,
                String(Math.max(1, Math.ceil(detailEntries.length / count))));
        }
    }
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

export function renderSingleLineCardDetails(containerElement, detailEntries, dataTypes = {}, { columns } = {}) {
    const entries = Array.isArray(detailEntries) ? detailEntries : [];
    prepareSingleLineCardDetailContainer(containerElement, entries, columns);

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
        // The column decides where its name goes; one row's text never does.
        const labelPlacement = resolveCardDetailFieldLabelPlacement(labelText, labelMeta);
        const displayValue = String(detailEntry?.rawValue ?? "").trim();
        const renderedIcon = (
            labelMode === "icon" || labelMode === "both"
        ) && appendConfiguredCardDetailIcon(label, labelMeta, detailEntry?.column);

        // A hidden name leaves the field's own symbol in place: the icon shows what
        // the field is, and the rule only decides whether its name is spelled out.
        const shouldRenderLabelText = labelPlacement !== CARD_FIELD_LABEL_PLACEMENTS.HIDDEN
            && (labelMode === "label" || labelMode === "both" || !renderedIcon);

        if (renderedIcon && !shouldRenderLabelText && labelText) {
            label.setAttribute("aria-label", labelText);
            label.title = labelText;
        }

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
            // Nothing visible names this value any more, so the row itself carries
            // the name for assistive technology. The value keeps its own hover text.
            if (labelText) row.setAttribute("aria-label", labelText);
        } else {
            row.appendChild(label);
        }

        row.dataset.cardLabelPlacement = labelPlacement;
        const valueElement = createSingleLineCardDetailValue(detailEntry);
        row.appendChild(valueElement);
        applyLabelValueLayout(row, label.parentNode === row ? label : null, valueElement, labelMeta?.label_value_layout);
        containerElement.appendChild(row);
    });
}
