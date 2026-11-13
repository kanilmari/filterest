// row_article_image_caption.js
// Localizes image descriptions and builds safe credits for article and card images.
// One renderer owns localized text, credit links and their click boundary.

import { bindDatasetLanguageRenderer, resolveDatasetDisplayValue } from "../dataset_value_localizer.js";
import { resolveRowArticleImageRows, resolveRowArticlePictureIdentity } from "./row_article_image_rows.js";

/** The identity of the picture an inline image container shows, or "" for none. */
function resolveInlinePicture(container) {
    // Logo renderers hide their inner mark from accessibility; the owning media
    // still identifies the asset. Never take a neighbouring record preview.
    const media = container?.querySelector?.(
        ":scope > [data-image-first-src], :scope > .row_article_inline_media > [data-image-first-src]",
    );
    const image = container?.querySelector?.("img:not([aria-hidden='true'])");
    const source = media?.dataset?.imageFirstSrc || image?.dataset?.imageFirstSrc || image?.getAttribute?.("src") || "";
    return resolveRowArticlePictureIdentity(source);
}

const captionInteractionRoots = new WeakSet();
const CREDIT_LABELS = {
    fi: { photo: "Kuva", illustration: "Kuvituskuva", archive: "Arkistokuva", details: "Kuvatiedot" },
    en: { photo: "Photo", illustration: "Illustration", archive: "Archive photo", details: "Image credits" },
    ch: { photo: "图片", illustration: "示意图", archive: "资料图片", details: "图片来源" },
    yue: { photo: "相片", illustration: "示意圖", archive: "資料圖片", details: "圖片來源" },
    traditional: { photo: "圖片", illustration: "示意圖", archive: "資料圖片", details: "圖片來源" },
};
const PROVIDERS = { unsplash: "Unsplash", pexels: "Pexels", pixabay: "Pixabay" };

// Credits are untrusted dataset content. Only explicit web URLs become links;
// HTML, executable schemes, embedded credentials and relative URLs never do.
function resolveCreditUrl(value) {
    if (typeof value !== "string" || !/^https?:\/\//i.test(value)
        // eslint-disable-next-line no-control-regex -- Reject control characters in untrusted credit URLs.
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
            return { url: sourceUrl, creator, provider, creatorUrl: resolveCreditUrl(source.creator_profile_url), illustration: false,
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

// Older imports give an explicit licence as plain text after the Commons file link.
function appendCommonsLicence(host, source, tail) {
    if (source?.hostname !== "commons.wikimedia.org" || !/^\/wiki\/File(?::|%3a).+/i.test(source.pathname)) return false;
    const licence = tail.match(/^(,\s*)(CC (BY(?:-SA)?) ([234]\.0))(\.?)$/);
    if (!licence) return false;
    const [, separator, label, type, version, punctuation] = licence;
    const url = new URL("https://creativecommons.org/licenses/" + type.toLowerCase() + "/" + version + "/");
    host.append(document.createTextNode(separator));
    appendCreditLink(host, label, url);
    host.append(document.createTextNode(punctuation));
    return true;
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
        if (cursor === 0 && appendCommonsLicence(host, url, description.slice(end))) return;
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

// Extract only attribution from legacy records. Editorial descriptions belong to the article.
const creditPrefix = /^(Kuvituskuva|Illustration(?: image)?|Arkistokuva|Archive photo|File photo|Kuva|Photo)\s*[:–—-]\s*/i;
const graphemes = typeof Intl.Segmenter === "function" ? new Intl.Segmenter() : null;

function creditLength(text) {
    return Array.from(graphemes ? graphemes.segment(text) : text).length;
}

function compactCreditProvider(url) {
    if (url?.hostname === "commons.wikimedia.org") return "Wikimedia Commons";
    if (url?.hostname === "elements.envato.com") return "Envato Elements";
    return url ? resolveProviderName(url) : "";
}

function trackedUnsplashUrl(url) {
    const tracked = new URL(url);
    if (["unsplash.com", "www.unsplash.com"].includes(tracked.hostname)) {
        tracked.searchParams.set("utm_source", "filterest");
        tracked.searchParams.set("utm_medium", "referral");
    }
    return tracked;
}

function appendCompactCredit(host, credit, description, labels) {
    const prefix = description.match(creditPrefix);
    if (!credit && !prefix) return;
    const kind = prefix?.[1] || "";
    const label = /^(arkisto|archive|file)/i.test(kind) ? labels.archive
        : /^(kuvitus|illustration)/i.test(kind) ? labels.illustration : labels.photo;
    const legacy = document.createElement("span");
    if (prefix) appendCaptionText(legacy, description.slice(prefix[0].length));
    const firstLink = legacy.firstElementChild;
    const sourceLink = firstLink instanceof HTMLAnchorElement ? firstLink : null;
    const url = credit?.url || (sourceLink && new URL(sourceLink.href));
    const provider = credit?.provider || compactCreditProvider(url);
    let creator = credit?.creator || sourceLink?.textContent || legacy.textContent.trim();
    // Older attachment rows often include the platform in the linked label.
    const separator = creator.lastIndexOf(" / ");
    if (provider && separator !== -1) {
        const suffix = creator.slice(separator + 3).toLowerCase();
        if (suffix === provider.toLowerCase() || (provider === "Wikimedia Commons" && suffix === "wikimedia")
            || (provider === "Envato Elements" && suffix === "envato")) creator = creator.slice(0, separator);
    }
    const identity = document.createDocumentFragment();
    if (creator) {
        const creatorUrl = credit?.creatorUrl || url;
        if (creatorUrl) appendCreditLink(identity, creator, provider === "Unsplash" ? trackedUnsplashUrl(creatorUrl) : creatorUrl);
        else identity.append(creator);
    }
    if (provider) {
        if (creator) identity.append(", ");
        if (provider === "Unsplash") appendCreditLink(identity, provider, trackedUnsplashUrl("https://unsplash.com/"));
        else if (provider === "Pexels") appendCreditLink(identity, provider, new URL("https://www.pexels.com/"));
        else if (!creator && url) appendCreditLink(identity, provider, url);
        else identity.append(provider);
    }
    if (!identity.textContent.trim()) return;
    const extra = document.createDocumentFragment();
    while (sourceLink?.nextSibling) extra.append(sourceLink.nextSibling);
    const essentialLength = creditLength(identity.textContent);
    const length = creditLength(identity.textContent + extra.textContent);
    if (creditLength(label + ", ") + length <= 60) host.append(label + ", ");
    // Retain visible attribution even when an unusually long name must wrap.
    const foldIdentity = length > 60 && essentialLength + creditLength(labels.details) > 60
        && provider !== "Unsplash" && provider !== "Pexels";
    if (!foldIdentity) host.append(identity);
    if (foldIdentity || (length > 60 && extra.textContent.trim())) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = labels.details;
        details.append(summary, identity, extra);
        host.append(details);
    } else host.append(extra);
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
export function setRowArticleImageCaption(captionElement, imageRow, { compact = false } = {}) {
    if (!(captionElement instanceof HTMLElement)) return;
    isolateCaptionInteractions(captionElement);
    bindDatasetLanguageRenderer(captionElement, (language) => {
        const description = resolveDatasetDisplayValue(imageRow?.description, null, language).trim();
        const credit = resolveImageCredit(imageRow, description);
        captionElement.replaceChildren();
        if (compact) {
            appendCompactCredit(captionElement, credit, description, resolveCreditLabels(language));
        } else if (credit) {
            if (credit.description) {
                appendCaptionText(captionElement, credit.description);
                captionElement.append(document.createTextNode(" — "));
            }
            const labels = resolveCreditLabels(language);
            captionElement.append((credit.illustration ? labels.illustration : labels.photo) + ": ");
            const { creator, provider } = credit;
            const label = provider && creator.toLowerCase().endsWith(" / " + provider.toLowerCase())
                ? creator : [creator, provider].filter(Boolean).join(" / ");
            appendCreditLink(captionElement, label, credit.url);
        } else {
            appendCaptionText(captionElement, description);
        }
        captionElement.hidden = !captionElement.textContent.trim();
    });
}

/**
 * Synchronizes child image descriptions below ordinary article-view images.
 * The row showing the same picture wins; a lone image may use the sole canonical asset row.
 */
export function syncRowArticleInlineImageCaptions(articleContent, imageRows = []) {
    if (!(articleContent instanceof HTMLElement)) return;
    const imageContainers = Array.from(
        articleContent.querySelectorAll(".big_card_image[data-row-article-image-column]"),
    );
    const canonicalRows = resolveRowArticleImageRows(imageRows);

    imageContainers.forEach((container) => {
        container.querySelector(":scope > .row_article_inline_image_caption")?.remove();
        const inlinePicture = resolveInlinePicture(container);
        const matchingRow = canonicalRows.find(
            (row) => resolveRowArticlePictureIdentity(row?.filename) === inlinePicture,
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
