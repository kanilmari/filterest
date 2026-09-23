// Adapts a generic key/value pair to card-detail semantics.
// Bridges the shared key-value renderer and card-detail column metadata: it adds
// the field's icon, and it tells the renderer where that field's name belongs.
// Exists so standard cards match article and modern-card semantics without teaching
// the portable key-value component anything about card roles.

import {
    appendConfiguredCardDetailIcon,
    resolveCardDetailFieldLabelPlacement,
} from "./card_detail_single_line_helpers.js";

/**
 * Decorate one card-detail key and state the pair's name placement.
 *
 * The placement is read from the column that owns the field — never from the one
 * row being drawn — through the single card-wide rule in
 * card_field_label_placement.js. The key-value renderer applies whatever this
 * returns; it does not decide it.
 *
 * @param {HTMLElement} keyElement - the pair's key element, already carrying its text
 * @param {object} [pairData] - the pair the renderer is building, including labelMeta
 * @returns {{labelPlacement: "hidden"|"inline"|"stacked"}|undefined}
 */
export function decorateStandardCardDetailKey(keyElement, pairData = {}) {
    if (!(keyElement instanceof HTMLElement)) {
        return undefined;
    }

    const labelText = String(
        pairData?.labelText || keyElement.textContent || pairData?.key || ""
    ).trim();
    const labelKey = String(
        pairData?.labelKey || keyElement.dataset.langKey || pairData?.key || ""
    ).trim();
    const metadataColumn = String(
        pairData?.sourceColumn || pairData?.dataColumn || pairData?.column || pairData?.key || ""
    ).trim();
    const labelPlacement = resolveCardDetailFieldLabelPlacement(
        labelText,
        pairData?.labelMeta
    );

    const iconElement = document.createElement("span");
    iconElement.className = "card_detail_row_icon";
    const renderedIcon = appendConfiguredCardDetailIcon(
        iconElement,
        pairData?.labelMeta || {},
        metadataColumn
    );

    if (!renderedIcon) {
        return { labelPlacement };
    }

    iconElement.setAttribute("aria-hidden", "true");
    const labelTextElement = document.createElement("span");
    labelTextElement.className = "card_detail_row_label_text";
    labelTextElement.textContent = labelText;
    if (labelKey) {
        labelTextElement.dataset.langKey = labelKey;
    }

    keyElement.removeAttribute("data-lang-key");
    keyElement.classList.add("card_detail_row_label");
    keyElement.replaceChildren(iconElement, labelTextElement);

    return { labelPlacement };
}
