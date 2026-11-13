// dom_container_builder.js
// Creates and manages reusable DOM containers for app content and management views.
// Bridges feature modules with shared tab-content containers, modal scaffolding, and safe HTML rendering.
// Exists to keep container creation and trusted DOM assembly centralized.

import {
    extract_id_from_text,
    isValidIdentifier,
    ALLOWED_HTML_TAGS,
    containsAllowedHtml,
    resolveSafeRichTextHref,
} from './dom_container_builder_helpers.js';
import { createExternalLink } from './http_text_linkifier.js';

// Re-export pure helpers so existing importers continue to work
export { extract_id_from_text, isValidIdentifier, ALLOWED_HTML_TAGS, containsAllowedHtml };

export function getOrCreateContainer(containerId) {
    let container = document.getElementById(containerId);
    if (!container) {
        container = document.createElement('div');
        container.id = containerId;
        container.classList.add('content_div');
        const tabs_container = document.getElementById('tabs_container');
        if (!tabs_container) {
            throw new Error(`getOrCreateContainer: #tabs_container not found in DOM (needed for "${containerId}")`);
        }
        tabs_container.appendChild(container);
    }
    return container;
}

/**
 * Yleinen funktio, joka hoitaa:
 * 1) Säiliön luonnin/hakemisen
 * 2) .management_forms -divin luonnin/hakemisen
 * 3) Sisällön luomisen vain kerran
 *
 * @param {string} containerId  - Divin id, esim. "foreign_keys_container"
 * @param {Function} generateFn - Funktio (async tai sync), joka generoi varsinainen sisällön
 */
export async function loadManagementView(containerId, generateFn) {
    // 1. Hae tai luo .content_div + .management_forms -elementit
    const management_div = getOrCreateManagementFormsContainer(containerId);

    // 2. Ladataan sisältö vain jos management_div on tyhjä
    if (!management_div.hasChildNodes()) {
        await generateFn(management_div);
    }
}

export function getOrCreateManagementFormsContainer(containerId) {
    // Hae tai luo content_div-luokan container
    let main_container = document.getElementById(containerId);
    if (!main_container) {
        main_container = document.createElement('div');
        main_container.id = containerId;
        main_container.classList.add('content_div');
        const tabs_container = document.getElementById('tabs_container');
        if (!tabs_container) {
            throw new Error(`getOrCreateManagementFormsContainer: #tabs_container not found in DOM (needed for "${containerId}")`);
        }
        tabs_container.appendChild(main_container);
    }
    // Etsi / luo .management_forms-luokan div
    let management_div = main_container.querySelector('.management_forms');
    if (!management_div) {
        management_div = document.createElement('div');
        management_div.classList.add('management_forms');
        main_container.appendChild(management_div);
    }

    return management_div;
}


const INLINE_HTML_TAGS = new Set(['strong', 'em', 'span', 'b', 'i', 'a']);

// Also recognize a complete unsupported element or non-visible markup. A bare
// literal such as "Vector<T>" is still the same ordinary text on every surface.
export function containsHeadingMarkup(text) {
    if (typeof text !== 'string') return false;
    return containsAllowedHtml(text) || /<(?:script|style|template)(?=[\s/>])/iu.test(text) ||
        (text.includes('</') && /<[a-z][\w:-]*(?=[\s/>])/iu.test(text));
}

/** Text-only surfaces use the same inline heading the card and article draw. */
export function readInlineHeadingText(value) {
    return containsHeadingMarkup(value)
        ? renderAllowedHtml(value, { inlineOnly: true }).textContent.trim()
        : String(value ?? '').trim();
}

/**
 * Parses a limited HTML snippet and retains only tags from ALLOWED_HTML_TAGS.
 * Only validated anchor hrefs survive; browsing attributes use the plain-URL policy.
 * All source attributes are otherwise stripped and nested elements are sanitized.
 *
 * @param {string} htmlString - The HTML snippet to render, e.g. "<div>Hello</div>".
 * @param {{inlineOnly?: boolean}} [options] Flattens blocks in a record heading.
 * @returns {DocumentFragment} A fragment containing the cleaned elements.
 */
export function renderAllowedHtml(htmlString, { inlineOnly = false } = {}) {
    const allowed = new Set(ALLOWED_HTML_TAGS);

    // An inert template also lets plain-text search labels read markup without
    // loading embedded resources. Full rich fields retain their document parser.
    let root;
    if (inlineOnly) {
        const template = document.createElement('template');
        template.innerHTML = htmlString;
        root = template.content;
    } else {
        root = new DOMParser().parseFromString(htmlString, 'text/html').body;
    }

    // A heading owns its size and outline. In that mode neighbouring blocks
    // need a word boundary, while adjacent inline text keeps its own spacing.
    let pendingBreak = false;
    let endsWithWord = false;
    function sanitize(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName.toLowerCase();
            if (inlineOnly && ['script', 'style', 'template'].includes(tag)) return null;
            const block = inlineOnly && allowed.has(tag) && !INLINE_HTML_TAGS.has(tag);
            if (block) pendingBreak = endsWithWord;
            const safeHref = tag === 'a' ? resolveSafeRichTextHref(node.getAttribute('href')) : '';
            let cleanEl;
            if (block || !allowed.has(tag) || (tag === 'a' && !safeHref)) {
                cleanEl = document.createDocumentFragment();
            } else {
                cleanEl = tag === 'a' ? createExternalLink(safeHref) : document.createElement(tag);
            }
            node.childNodes.forEach(child => {
                const cleanChild = sanitize(child);
                if (cleanChild) cleanEl.appendChild(cleanChild);
            });
            if (block) pendingBreak = endsWithWord;
            return cleanEl;
        } else if (node.nodeType === Node.TEXT_NODE && (inlineOnly || node.textContent.trim())) {
            let text = node.textContent;
            if (inlineOnly && text) {
                if (pendingBreak && !/^\s/u.test(text)) text = ' ' + text;
                pendingBreak = false;
                endsWithWord = !/\s$/u.test(text);
            }
            return document.createTextNode(text);
        }
        return null;
    }

    const frag = document.createDocumentFragment();
    root.childNodes.forEach(node => {
        const cleaned = sanitize(node);
        if (cleaned) frag.appendChild(cleaned);
    });

    return frag;
}
