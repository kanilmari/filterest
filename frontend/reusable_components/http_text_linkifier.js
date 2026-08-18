// Turns absolute HTTP(S) addresses inside user-facing text into safe links.
// Bridges plain-text card/article renderers with shared URL validation.
// Exists so links work consistently without using innerHTML or trusting unsafe schemes.

import { resolveSafeExternalHttpUrl } from "./safe_external_http_url.js";

const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"']+/giu;
const SIMPLE_TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", "…"]);

function splitTrailingPunctuation(candidate) {
    let urlText = candidate;
    let trailing = "";

    while (urlText && SIMPLE_TRAILING_PUNCTUATION.has(urlText.at(-1))) {
        trailing = `${urlText.at(-1)}${trailing}`;
        urlText = urlText.slice(0, -1);
    }

    for (const [opening, closing] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
        while (
            urlText.endsWith(closing)
            && urlText.split(closing).length > urlText.split(opening).length
        ) {
            trailing = `${closing}${trailing}`;
            urlText = urlText.slice(0, -1);
        }
    }

    return { urlText, trailing };
}

export function appendTextWithHttpLinks(container, value) {
    const text = String(value ?? "");
    let cursor = 0;

    for (const match of text.matchAll(HTTP_URL_PATTERN)) {
        const matchIndex = match.index ?? 0;
        if (matchIndex > cursor) {
            container.appendChild(document.createTextNode(text.slice(cursor, matchIndex)));
        }

        const originalCandidate = match[0];
        const { urlText, trailing } = splitTrailingPunctuation(originalCandidate);
        const safeHref = resolveSafeExternalHttpUrl(urlText);
        if (safeHref) {
            const link = document.createElement("a");
            link.href = safeHref;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.classList.add("auto-http-link");
            link.textContent = urlText;
            container.appendChild(link);
        } else {
            container.appendChild(document.createTextNode(urlText));
        }
        if (trailing) {
            container.appendChild(document.createTextNode(trailing));
        }
        cursor = matchIndex + originalCandidate.length;
    }

    if (cursor < text.length) {
        container.appendChild(document.createTextNode(text.slice(cursor)));
    }
}

export function linkifyHttpTextNodes(root) {
    if (!(root instanceof HTMLElement)) return;

    const textNodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
        const parent = node.parentElement;
        if (
            parent
            && !parent.closest("a, button, input, textarea, select, option, script, style")
            && /https?:\/\//iu.test(node.nodeValue || "")
        ) {
            textNodes.push(node);
        }
        node = walker.nextNode();
    }

    for (const textNode of textNodes) {
        const fragment = document.createDocumentFragment();
        appendTextWithHttpLinks(fragment, textNode.nodeValue || "");
        textNode.replaceWith(fragment);
    }
}
