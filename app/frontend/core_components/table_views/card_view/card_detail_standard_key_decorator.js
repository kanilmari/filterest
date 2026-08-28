// Adds semantic field icons to ordinary card-detail labels.
// Bridges the shared key-value renderer and card-detail icon metadata.
// Exists so standard cards match article and modern-card semantics without changing generic KV defaults.

import { appendConfiguredCardDetailIcon } from "./card_detail_single_line_helpers.js";

export function decorateStandardCardDetailKey(keyElement, pairData = {}) {
    if (!(keyElement instanceof HTMLElement)) {
        return;
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

    const iconElement = document.createElement("span");
    iconElement.className = "card_detail_row_icon";
    const renderedIcon = appendConfiguredCardDetailIcon(
        iconElement,
        pairData?.labelMeta || {},
        metadataColumn
    );

    if (!renderedIcon) {
        return;
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
}
