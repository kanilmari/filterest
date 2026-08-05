// dom_container_builder.js
// Creates and manages reusable DOM containers for app content and management views.
// Bridges feature modules with shared tab-content containers, modal scaffolding, and safe HTML rendering.
// Exists to keep container creation and trusted DOM assembly centralized.

import {
    extract_id_from_text,
    isValidIdentifier,
    ALLOWED_HTML_TAGS,
    containsAllowedHtml,
} from './dom_container_builder_helpers.js';

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


/**
 * Parses a limited HTML snippet and retains only tags from ALLOWED_HTML_TAGS.
 * Any attributes are stripped and nested elements are sanitized.
 *
 * @param {string} htmlString - The HTML snippet to render, e.g. "<div>Hello</div>".
 * @returns {DocumentFragment} A fragment containing the cleaned elements.
 */
export function renderAllowedHtml(htmlString) {
    const allowed = new Set(ALLOWED_HTML_TAGS);

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    function sanitize(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
            const tag = node.tagName.toLowerCase();
            if (!allowed.has(tag)) {
                const frag = document.createDocumentFragment();
                node.childNodes.forEach(child => {
                    const cleanChild = sanitize(child);
                    if (cleanChild) frag.appendChild(cleanChild);
                });
                return frag;
            }

            const cleanEl = document.createElement(tag);
            node.childNodes.forEach(child => {
                const cleanChild = sanitize(child);
                if (cleanChild) cleanEl.appendChild(cleanChild);
            });
            return cleanEl;
        } else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
            return document.createTextNode(node.textContent);
        }
        return null;
    }

    const frag = document.createDocumentFragment();
    doc.body.childNodes.forEach(node => {
        const cleaned = sanitize(node);
        if (cleaned) frag.appendChild(cleaned);
    });

    return frag;
}
