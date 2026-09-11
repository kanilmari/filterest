// row_article_image_caption.js
// Localizes image descriptions and attaches them only to article media surfaces.
// Bridges shared asset rows with ordinary and image-first article presentations.
// Exists so image credits never leak into compact cards and change with the UI language.

import { bindDatasetLanguageRenderer, resolveDatasetDisplayValue } from "../dataset_value_localizer.js";
import { resolveImagePath } from "./row_article_content_builder_helpers.js";
import { resolveRowArticleImageRows } from "./row_article_image_rows.js";

function normalizeImagePath(filename = "") {
    const resolvedPath = resolveImagePath(String(filename || "").trim());
    try {
        return new URL(resolvedPath, window.location.href).pathname;
    } catch {
        return resolvedPath;
    }
}
function resolveInlineImagePath(container) {
    const image = container?.querySelector?.("img:not([aria-hidden='true'])");
    const source = image?.dataset?.imageFirstSrc || image?.getAttribute?.("src") || "";
    try {
        return new URL(source, window.location.href).pathname;
    } catch {
        return source;
    }
}

const captionInteractionRoots = new WeakSet();
const CREDIT_LABELS = {
    fi: { photo: "Kuva", illustration: "Kuvituskuva" },
    en: { photo: "Photo", illustration: "Illustration" },
    ch: { photo: "图片", illustration: "示意图" },
    yue: { photo: "相片", illustration: "示意圖" },
    traditional: { photo: "圖片", illustration: "示意圖" },
};
const PROVIDERS = { unsplash: "Unsplash", pexels: "Pexels", pixabay: "Pixabay" };

// Credits are untrusted dataset content. Only explicit web URLs become links;
// HTML, executable schemes, embedded credentials and relative URLs never do.
function resolveCreditUrl(value) {
    if (typeof value !== "string" || !/^https?:\/\//i.test(value)
        || /[\u0000-\u0020\u007f]/.test(value)) return null;
    try {
        const url = new URL(value);
        return url.username || url.password ? null : url;
    } catch {
        return null;
    }
}

function resolveProviderName(url, provider = "") {
    const normalized = String(provider).toLowerCase();
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return PROVIDERS[normalized]
        || Object.entries(PROVIDERS).find(([key]) => host === key + ".com")?.[1]
        || "";
}

function resolveImageCredit(imageRow, description) {
    let metadata = imageRow?.metadata_json;
    if (typeof metadata === "string") {
        try { metadata = JSON.parse(metadata); } catch { metadata = null; }
    }
    const source = metadata?.image_source;
    const sourceUrl = resolveCreditUrl(source?.source_page_url);
    if (sourceUrl) {
        const creator = String(source.creator_name || "").trim();
        const provider = resolveProviderName(sourceUrl, source.provider);
        if (creator || provider) {
            const generatedCaption = /^(?:Kuva|Photo)\s*:\s*/i.test(description)
                && description.replace(/^(?:Kuva|Photo)\s*:\s*/i, "").replace(/\.$/, "")
                    === [creator, provider].filter(Boolean).join(" / ");
            return { url: sourceUrl, creator, provider, illustration: false,
                description: generatedCaption ? "" : description };
        }
    }

    // Historical illustration imports stored only a Markdown photographer link.
    // Recognize the whole credit so ordinary authored captions retain their prose.
    const legacy = description.match(
        /^(Kuvituskuva|Illustration(?: image)?|Kuva|Photo)\s*[:–—-]\s*\[([^\]\r\n]+)\]\((\S+)\)\.?$/i,
    );
    const legacyUrl = resolveCreditUrl(legacy?.[3]);
    if (!legacyUrl) return null;
    return { url: legacyUrl, creator: legacy[2].trim(), provider: resolveProviderName(legacyUrl),
        illustration: /^(Kuvituskuva|Illustration)/i.test(legacy[1]), description: "" };
}

function appendCreditLink(host, label, url) {
    const anchor = document.createElement("a");
    anchor.textContent = label;
    anchor.href = url.href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    host.appendChild(anchor);
}

function appendCaptionText(host, description) {
    let cursor = 0;
    // Named links may contain balanced URL parentheses. Never turn a truncated
    // destination into a link, and never interpret arbitrary Markdown or HTML.
    for (const match of description.matchAll(/\[([^\]\r\n]+)\]\(/g)) {
        if (match.index < cursor) continue;
        const urlStart = match.index + match[0].length;
        let end = urlStart;
        let depth = 1;
        for (; end < description.length && depth > 0; end += 1) {
            if (description[end] === "(") depth += 1;
            if (description[end] === ")") depth -= 1;
        }
        if (depth !== 0) continue;
        host.append(document.createTextNode(description.slice(cursor, match.index)));
        const url = resolveCreditUrl(description.slice(urlStart, end - 1));
        if (url) appendCreditLink(host, match[1], url);
        else host.append(document.createTextNode(match[1]));
        cursor = end;
    }
    host.append(document.createTextNode(description.slice(cursor)));
}

function resolveCreditLabels(language) {
    const locale = String(language).toLowerCase().replaceAll("_", "-");
    if (/^zh-(?:tw|hk|hant)(?:-|$)/.test(locale)) return CREDIT_LABELS.traditional;
    if (locale === "zh" || locale.startsWith("zh-")) return CREDIT_LABELS.ch;
    return CREDIT_LABELS[locale.split("-")[0]] || CREDIT_LABELS.en;
}

function isolateCaptionInteractions(caption) {
    if (captionInteractionRoots.has(caption)) return;
    captionInteractionRoots.add(caption);
    for (const name of ["click", "auxclick", "pointerdown", "pointerup", "touchstart", "touchend"]) {
        caption.addEventListener(name, (event) => event.stopPropagation());
    }
    caption.addEventListener("keydown", (event) => {
        // Preserve ordinary tab navigation and the modal's Escape-to-close behavior.
        if (["Enter", " ", "ArrowLeft", "ArrowRight"].includes(event.key)) event.stopPropagation();
    });
}

/**
 * Renders one localized caption with safe photographer/provider links.
 * Both article layouts share this boundary; language and image changes rebuild the credit.
 */
export function setRowArticleImageCaption(captionElement, imageRow) {
    if (!(captionElement instanceof HTMLElement)) return;
    isolateCaptionInteractions(captionElement);
    bindDatasetLanguageRenderer(captionElement, (language) => {
        const description = resolveDatasetDisplayValue(imageRow?.description, null, language).trim();
        const credit = resolveImageCredit(imageRow, description);
        captionElement.replaceChildren();
        if (credit) {
            if (credit.description) {
                appendCaptionText(captionElement, credit.description);
                captionElement.append(document.createTextNode(" — "));
            }
            const labels = resolveCreditLabels(language);
            captionElement.append(document.createTextNode(
                (credit.illustration ? labels.illustration : labels.photo) + ": ",
            ));
            appendCreditLink(captionElement,
                [credit.creator, credit.provider].filter(Boolean).join(" / "), credit.url);
        } else {
            appendCaptionText(captionElement, description);
        }
        captionElement.hidden = !captionElement.textContent.trim();
    });
}

/**
 * Synchronizes child image descriptions below ordinary article-view images.
 * Exact path matching wins; a lone image may use the sole canonical asset row.
 */
export function syncRowArticleInlineImageCaptions(articleContent, imageRows = []) {
    if (!(articleContent instanceof HTMLElement)) return;
    const imageContainers = Array.from(
        articleContent.querySelectorAll(".big_card_image[data-row-article-image-column]"),
    );
    const canonicalRows = resolveRowArticleImageRows(imageRows);

    imageContainers.forEach((container) => {
        container.querySelector(":scope > .row_article_inline_image_caption")?.remove();
        const inlinePath = resolveInlineImagePath(container);
        const matchingRow = canonicalRows.find(
            (row) => normalizeImagePath(row?.filename) === inlinePath,
        ) || (imageContainers.length === 1 && canonicalRows.length === 1
            ? canonicalRows[0]
            : null);
        if (!matchingRow) return;

        const caption = document.createElement("p");
        caption.classList.add("row_article_image_caption", "row_article_inline_image_caption");
        caption.dataset.testid = "row-article-inline-image-caption";
        setRowArticleImageCaption(caption, matchingRow);
        if (!caption.hidden) {
            container.appendChild(caption);
        }
    });
}
