// card_detail_single_line_helpers.js
// Renders and sanitizes single-line card detail rows for the card view.
// Bridges metadata-driven label/icon settings and the card detail DOM structure.
// Exists so the SVG/fallback logic stays testable without importing the whole card renderer.

import { getCardDetailIconSvgMarkup } from "./card_detail_icon_builder.js";

const SAFE_CARD_DETAIL_SVG_TAGS = new Set([
    "svg",
    "g",
    "path",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "rect",
    "title",
    "desc",
]);

const SAFE_CARD_DETAIL_SVG_ATTRIBUTES = new Set([
    "viewbox",
    "fill",
    "fill-rule",
    "fill-opacity",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-opacity",
    "opacity",
    "transform",
    "cx",
    "cy",
    "width",
    "height",
    "r",
    "rx",
    "ry",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "d",
    "points",
    "xmlns",
    "preserveaspectratio",
]);

const SINGLE_LINE_CARD_DETAIL_DESKTOP_COLUMNS = 2;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const FALLBACK_CARD_DETAIL_ICON_KEY = "info";

export function normalizeClientCardDetailLabelMode(labelMode) {
    const normalized = String(labelMode || "").trim().toLowerCase();
    if (normalized === "icon" || normalized === "both") {
        return normalized;
    }
    return "label";
}

function isSafeCardDetailSvgAttribute(attribute) {
    const attributeName = attribute.name.toLowerCase();
    const attributeValue = String(attribute.value || "").trim().toLowerCase();
    const isDangerousValue = attributeValue.includes("javascript:")
        || attributeValue.includes("data:")
        || attributeValue.includes("url(");

    return !attributeName.startsWith("on")
        && attributeName !== "style"
        && attributeName !== "href"
        && attributeName !== "xlink:href"
        && SAFE_CARD_DETAIL_SVG_ATTRIBUTES.has(attributeName)
        && !isDangerousValue;
}

function cloneSafeCardDetailSvgElement(sourceElement) {
    const tagName = sourceElement.tagName.toLowerCase();
    if (!SAFE_CARD_DETAIL_SVG_TAGS.has(tagName)) {
        return null;
    }

    const targetElement = document.createElementNS(SVG_NAMESPACE, tagName);
    for (const attribute of Array.from(sourceElement.attributes)) {
        const attributeName = attribute.name.toLowerCase();
        if (
            isSafeCardDetailSvgAttribute(attribute)
            && !(tagName === "svg" && (attributeName === "width" || attributeName === "height"))
        ) {
            targetElement.setAttribute(attribute.name, attribute.value);
        }
    }

    for (const childNode of Array.from(sourceElement.childNodes)) {
        if (childNode.nodeType === Node.TEXT_NODE) {
            if (tagName === "title" || tagName === "desc") {
                targetElement.appendChild(document.createTextNode(childNode.textContent || ""));
            }
            continue;
        }

        if (childNode.nodeType !== Node.ELEMENT_NODE) {
            continue;
        }

        const clonedChild = cloneSafeCardDetailSvgElement(childNode);
        if (!clonedChild) {
            return null;
        }
        targetElement.appendChild(clonedChild);
    }

    return targetElement;
}

function sanitizeCardDetailSvgElement(rootSvgElement) {
    const sanitizedSvg = cloneSafeCardDetailSvgElement(rootSvgElement);
    if (!sanitizedSvg || sanitizedSvg.tagName.toLowerCase() !== "svg") {
        return null;
    }

    sanitizedSvg.classList.add("card_detail_row_icon_svg");
    sanitizedSvg.setAttribute("aria-hidden", "true");
    sanitizedSvg.setAttribute("focusable", "false");
    return sanitizedSvg;
}

export function appendSafeCardDetailSvg(container, svgMarkup) {
    const trimmedSvg = String(svgMarkup || "").trim();
    if (!trimmedSvg.startsWith("<svg")) {
        return false;
    }

    try {
        const parser = new DOMParser();
        const svgDocument = parser.parseFromString(trimmedSvg, "image/svg+xml");
        const svgElement = svgDocument.documentElement;
        if (!svgElement || svgElement.tagName.toLowerCase() !== "svg") {
            return false;
        }
        if (svgDocument.querySelector("parsererror, script, foreignObject")) {
            return false;
        }

        const sanitizedSvg = sanitizeCardDetailSvgElement(
            document.importNode(svgElement, true)
        );
        if (!sanitizedSvg || sanitizedSvg.tagName.toLowerCase() !== "svg") {
            return false;
        }

        container.appendChild(sanitizedSvg);
        return true;
    } catch {
        return false;
    }
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
    const registrySvg = getCardDetailIconSvgMarkup(
        labelMeta?.card_detail_icon_key,
        columnName
    );

    if (registrySvg && appendSafeCardDetailSvg(container, registrySvg)) {
        return true;
    }

    if (appendSafeCardDetailSvg(container, labelMeta?.card_detail_icon_svg)) {
        return true;
    }

    return appendSafeCardDetailSvg(
        container,
        getCardDetailIconSvgMarkup(FALLBACK_CARD_DETAIL_ICON_KEY)
    );
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

    const href = String(
        detailEntry?.href || (detailEntry?.isLink === true ? detailEntry?.rawValue : "") || ""
    ).trim();

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
