// filterbar_section_order_handler.js
// Adds admin-only drag ordering and DB persistence to compact filterbar sections.
// Bridges filterbar disclosure DOM, route permissions, and the tableless system_config API.
// Exists so section layout stays shared application configuration instead of browser-local state.

import { endpoint_router } from "../endpoints/endpoint_router.js";
import { hasRoutePermission } from "../route_permission_checker.js";

export const DEFAULT_FILTERBAR_SECTION_ORDER = Object.freeze([
    "filters",
    "search_overview",
    "search_controls",
    "tools",
    "views",
    "field_sets",
    "chat",
]);

const LEGACY_FILTERBAR_SECTION_ORDER = Object.freeze([
    "search_controls",
    "tools",
    "views",
    "field_sets",
    "filters",
    "chat",
]);

const FILTERBAR_SECTION_LAYOUT_ROUTE = "/api/filterbar-section-layout";
const FILTERBAR_SECTION_LAYOUT_SAVE_ROUTE = "/api/filterbar-section-layout/save";
const SECTION_SELECTOR = "[data-filterbar-section-key]";

const allowedSectionKeys = new Set(DEFAULT_FILTERBAR_SECTION_ORDER);

export function normalizeFilterbarSectionOrder(input = []) {
    if (sectionOrderEquals(input, LEGACY_FILTERBAR_SECTION_ORDER)) {
        return [...DEFAULT_FILTERBAR_SECTION_ORDER];
    }

    const normalized = [];
    const seen = new Set();
    const values = Array.isArray(input) ? input : [];

    for (const rawKey of values) {
        const key = String(rawKey || "").trim();
        if (!allowedSectionKeys.has(key) || seen.has(key)) {
            continue;
        }
        normalized.push(key);
        seen.add(key);
    }

    for (const key of DEFAULT_FILTERBAR_SECTION_ORDER) {
        if (!seen.has(key)) {
            normalized.push(key);
        }
    }

    return normalized;
}

export function normalizeFilterbarSectionCollapsed(input = {}) {
    const values = input && typeof input === "object" && !Array.isArray(input)
        ? input
        : {};
    const normalized = {};

    for (const key of DEFAULT_FILTERBAR_SECTION_ORDER) {
        if (values[key] === true) {
            normalized[key] = true;
        }
    }

    return normalized;
}

function normalizeFilterbarSectionLayout(input = {}) {
    return {
        section_order: normalizeFilterbarSectionOrder(input?.section_order),
        section_collapsed: normalizeFilterbarSectionCollapsed(input?.section_collapsed),
    };
}

function sectionOrderEquals(input, expected) {
    if (!Array.isArray(input) || input.length !== expected.length) {
        return false;
    }
    return input.every((key, index) => key === expected[index]);
}

function getSectionElements(container) {
    return Array.from(container.querySelectorAll(`:scope > ${SECTION_SELECTOR}`))
        .filter((section) => section instanceof HTMLElement);
}

function getCurrentSectionOrder(container) {
    return normalizeFilterbarSectionOrder(
        getSectionElements(container).map((section) => section.dataset.filterbarSectionKey)
    );
}

function getCurrentSectionCollapsed(container) {
    return normalizeFilterbarSectionCollapsed(
        Object.fromEntries(
            getSectionElements(container).map((section) => [
                section.dataset.filterbarSectionKey,
                section.classList.contains("is-collapsed"),
            ])
        )
    );
}

function getCurrentSectionLayout(container) {
    return {
        section_order: getCurrentSectionOrder(container),
        section_collapsed: getCurrentSectionCollapsed(container),
    };
}

function applySectionOrder(container, order) {
    const normalizedOrder = normalizeFilterbarSectionOrder(order);
    const sectionsByKey = new Map(
        getSectionElements(container).map((section) => [
            section.dataset.filterbarSectionKey,
            section,
        ])
    );

    for (const key of normalizedOrder) {
        const section = sectionsByKey.get(key);
        if (section) {
            container.appendChild(section);
        }
    }
}

export async function applySectionCollapsedState(container, collapsedState) {
    const normalizedCollapsed = normalizeFilterbarSectionCollapsed(collapsedState);
    const operations = getSectionElements(container).map((section) => {
        const key = section.dataset.filterbarSectionKey;
        const shouldCollapse = normalizedCollapsed[key] === true;
        const isCollapsed = section.classList.contains("is-collapsed");

        if (shouldCollapse && !isCollapsed && typeof section.collapse === "function") {
            return section.collapse({ animate: false });
        }
        // Remote layout can make a section stricter, but it must not reopen the
        // closed-by-default right sidebar during initial page construction.
        return Promise.resolve();
    });

    await Promise.all(operations);
}

async function fetchSectionLayout() {
    const response = await endpoint_router("getFilterbarSectionLayout", {
        method: "GET",
    });
    return normalizeFilterbarSectionLayout(response);
}

async function saveSectionLayout(sectionLayout) {
    const normalizedLayout = normalizeFilterbarSectionLayout(sectionLayout);
    return endpoint_router("saveFilterbarSectionLayout", {
        method: "POST",
        body_data: normalizedLayout,
    });
}

function addHeaderDragBehavior(section, signal, shouldSuppressClick) {
    const header = section.querySelector(":scope > .animated-disclosure-header");
    if (!(header instanceof HTMLElement)) {
        return;
    }
    if (header.dataset.filterbarDragReady === "true") {
        return;
    }
    header.dataset.filterbarDragReady = "true";
    header.draggable = true;
    header.addEventListener("click", (event) => {
        if (!shouldSuppressClick()) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
    }, { capture: true, signal });
}

function getDragAfterElement(container, clientY, draggedSection) {
    const candidates = getSectionElements(container).filter((section) => section !== draggedSection);
    return candidates.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = clientY - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset, element: child };
        }
        return closest;
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

export function setupFilterbarSectionOrdering(panelBody) {
    if (!(panelBody instanceof HTMLElement)) {
        return { destroy: () => {} };
    }

    const controller = new AbortController();
    const { signal } = controller;
    let draggedSection = null;
    let suppressNextHeaderClick = false;
    let applyingRemoteLayout = false;
    let saveTimer = 0;

    function markSections() {
        getSectionElements(panelBody).forEach((section) => {
            section.classList.add("filterbar-disclosure-section--reorderable");
            addHeaderDragBehavior(section, signal, () => suppressNextHeaderClick);
        });
    }

    function scheduleSave() {
        if (applyingRemoteLayout) {
            return;
        }
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveSectionLayout(getCurrentSectionLayout(panelBody)).catch((err) => {
                console.warn("filterbar section layout save failed", err);
            });
        }, 200);
    }

    applySectionOrder(panelBody, DEFAULT_FILTERBAR_SECTION_ORDER);

    const canPersistLayout =
        hasRoutePermission(FILTERBAR_SECTION_LAYOUT_ROUTE) &&
        hasRoutePermission(FILTERBAR_SECTION_LAYOUT_SAVE_ROUTE);
    if (!canPersistLayout) {
        return { destroy: () => {} };
    }

    panelBody.addEventListener("dragstart", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const header = target.closest(".animated-disclosure-header");
        if (!(header instanceof HTMLElement)) {
            event.preventDefault();
            return;
        }
        const section = header.closest(SECTION_SELECTOR);
        if (!(section instanceof HTMLElement) || section.parentElement !== panelBody) {
            return;
        }
        draggedSection = section;
        event.dataTransfer?.setData("text/plain", section.dataset.filterbarSectionKey || "");
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
        }
        requestAnimationFrame(() => {
            section.classList.add("filterbar-disclosure-section--dragging");
        });
    }, { signal });

    panelBody.addEventListener("dragover", (event) => {
        if (!draggedSection) {
            return;
        }
        event.preventDefault();
        const afterElement = getDragAfterElement(panelBody, event.clientY, draggedSection);
        if (afterElement === null) {
            panelBody.appendChild(draggedSection);
            return;
        }
        panelBody.insertBefore(draggedSection, afterElement);
    }, { signal });

    panelBody.addEventListener("dragend", () => {
        if (!draggedSection) {
            return;
        }
        draggedSection.classList.remove("filterbar-disclosure-section--dragging");
        draggedSection = null;
        suppressNextHeaderClick = true;
        setTimeout(() => {
            suppressNextHeaderClick = false;
        }, 0);
        scheduleSave();
    }, { signal });

    panelBody.addEventListener("animated-disclosure-toggle", (event) => {
        const section = event.target;
        if (!(section instanceof HTMLElement) || section.parentElement !== panelBody) {
            return;
        }
        if (!section.matches(SECTION_SELECTOR)) {
            return;
        }
        scheduleSave();
    }, { signal });

    markSections();
    fetchSectionLayout()
        .then(async (layout) => {
            applyingRemoteLayout = true;
            applySectionOrder(panelBody, layout.section_order);
            markSections();
            await applySectionCollapsedState(panelBody, layout.section_collapsed);
            applyingRemoteLayout = false;
        })
        .catch((err) => {
            applyingRemoteLayout = false;
            console.warn("filterbar section layout load failed", err);
        });

    return {
        destroy() {
            clearTimeout(saveTimer);
            controller.abort();
        },
    };
}
