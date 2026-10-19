// filterbar_section_order_handler.js
// Applies one loaded site or personal order to every mounted filterbar.
// Bridges filterbar disclosure DOM, route permissions, and the tableless system_config API.
// Exists so section layout stays shared application configuration instead of browser-local state.


import { DEFAULT_FILTERBAR_SECTION_ORDER, normalizeFilterbarSectionOrder,
    normalizeFilterbarSectionCollapsed } from './filterbar_section_layout_normalizer.js';
import { loadFilterbarPreferences, getFilterbarPreferences, subscribeFilterbarPreferences,
    saveFilterbarOrder, canEditFilterbarOrder, saveSharedFilterbarLayout } from './filterbar_preferences_controller.js';
export { DEFAULT_FILTERBAR_SECTION_ORDER, normalizeFilterbarSectionOrder,
    normalizeFilterbarSectionCollapsed } from './filterbar_section_layout_normalizer.js';
const SECTION_SELECTOR = "[data-filterbar-section-key]";

function getSectionElements(container) {
    return Array.from(container.querySelectorAll(`:scope > ${SECTION_SELECTOR}`))
        .filter((section) => section instanceof HTMLElement);
}

function getCurrentSectionOrder(container) {
    return normalizeFilterbarSectionOrder(
        getSectionElements(container).map((section) => section.dataset.filterbarSectionKey)
    );
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
        if (!Object.hasOwn(normalizedCollapsed, key)) {
            // Legacy layouts stored only collapsed sections. Missing keys must
            // retain their component defaults instead of reopening everything.
            return Promise.resolve();
        }
        const shouldCollapse = normalizedCollapsed[key] === true;
        const isCollapsed = section.classList.contains("is-collapsed");

        if (shouldCollapse && !isCollapsed && typeof section.collapse === "function") {
            return section.collapse({ animate: false });
        }
        if (!shouldCollapse && isCollapsed && typeof section.expand === "function") {
            return section.expand({ animate: false });
        }
        return Promise.resolve();
    });

    await Promise.all(operations);
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

/**
 * Decide whether one disclosure event represents a user-owned layout change.
 * Between section toggle events and the shared persisted section-layout payload.
 * Exists so temporary Filters shortcuts cannot overwrite the owner's saved layout.
 */
export function shouldPersistFilterbarSectionToggle(section, panelBody) {
    return (
        section instanceof HTMLElement &&
        section.parentElement === panelBody &&
        section.matches(SECTION_SELECTOR) &&
        section.dataset.filterbarTemporaryDisclosureOperation !== "true"
    );
}

export function setupFilterbarSectionOrdering(panelBody) {
    if (!(panelBody instanceof HTMLElement)) {
        return { ready: Promise.resolve(), destroy: () => {} };
    }

    const controller = new AbortController();
    const { signal } = controller;
    let draggedSection = null;
    let suppressNextHeaderClick = false;
    let applyingRemoteLayout = false;
    let pendingCollapsed = {};
    let orderChanged = false;
    let saveTimer = 0;

    function markSections() {
        getSectionElements(panelBody).forEach((section) => {
            const editable = canEditFilterbarOrder();
            section.classList.toggle("filterbar-disclosure-section--reorderable", editable);
            addHeaderDragBehavior(section, signal, () => suppressNextHeaderClick);
            const header = section.querySelector(":scope > .animated-disclosure-header");
            if (header) header.draggable = editable;
        });
    }

    function scheduleSave() {
        if (applyingRemoteLayout) {
            return;
        }
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            const order = orderChanged ? getCurrentSectionOrder(panelBody) : null;
            const collapsed = pendingCollapsed;
            orderChanged = false;
            pendingCollapsed = {};
            const operation = order ? saveFilterbarOrder(order, collapsed)
                : saveSharedFilterbarLayout({ section_collapsed: collapsed });
            operation.catch((err) => {
                applySectionOrder(panelBody, getFilterbarPreferences().order);
                console.warn("filterbar section layout save failed", err);
            });
        }, 200);
    }

    applySectionOrder(panelBody, DEFAULT_FILTERBAR_SECTION_ORDER);

    panelBody.addEventListener("dragstart", (event) => {
        if (!canEditFilterbarOrder()) { event.preventDefault(); return; }
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
        orderChanged = true;
        scheduleSave();
    }, { signal });

    panelBody.addEventListener("animated-disclosure-toggle", (event) => {
        const section = event.target;
        if (!shouldPersistFilterbarSectionToggle(section, panelBody)) {
            return;
        }
        // Personal disclosure clicks are not shared order edits. Editors save
        // only this explicit collapse delta, never an old whole-bar snapshot.
        if (!getFilterbarPreferences().canEditShared || getFilterbarPreferences().mode === 'own') return;
        pendingCollapsed[section.dataset.filterbarSectionKey] = section.classList.contains('is-collapsed');
        scheduleSave();
    }, { signal });

    markSections();
    let applyRevision = 0;
    let lastOrder = '';
    let lastCollapsed = '';
    async function applyLoadedLayout() {
        if (signal.aborted) return;
        const revision = ++applyRevision;
        const state = getFilterbarPreferences();
        if (!state.loaded) {
            clearTimeout(saveTimer);
            orderChanged = false;
            pendingCollapsed = {};
        }
        applyingRemoteLayout = true;
        const orderKey = JSON.stringify(state.order);
        if (lastOrder !== orderKey) { applySectionOrder(panelBody, state.order); lastOrder = orderKey; }
        markSections();
        const collapsedKey = JSON.stringify(state.shared.section_collapsed);
        if (lastCollapsed !== collapsedKey) {
            await applySectionCollapsedState(panelBody, state.shared.section_collapsed);
            lastCollapsed = collapsedKey;
        }
        if (revision === applyRevision) applyingRemoteLayout = false;
    }
    const unsubscribe = subscribeFilterbarPreferences(() => { void applyLoadedLayout(); });
    const sectionMountObserver = new MutationObserver((mutations) => {
        // Reordering moves existing children too. Only new/replaced sections
        // need their position and defaults applied, preventing observer loops.
        // Other children (a spacer, a status row) are not sections: re-applying
        // the layout for them would move every section after them and undo a
        // section the visitor opened only on this page.
        const added = mutations.flatMap(m => [...m.addedNodes]);
        if (!signal.aborted && added.some(node => node instanceof HTMLElement
            && node.matches(SECTION_SELECTOR) && !node.dataset.filterbarOrderMounted)) {
            getSectionElements(panelBody).forEach(section => { section.dataset.filterbarOrderMounted = 'true'; });
            lastOrder = ''; lastCollapsed = '';
            void applyLoadedLayout();
        }
    });
    getSectionElements(panelBody).forEach(section => { section.dataset.filterbarOrderMounted = 'true'; });
    sectionMountObserver.observe(panelBody, { childList: true });
    const ready = loadFilterbarPreferences().then(applyLoadedLayout).catch((err) => {
        console.warn("filterbar section layout load failed", err);
    });

    return {
        ready,
        destroy() {
            clearTimeout(saveTimer);
            unsubscribe();
            sectionMountObserver.disconnect();
            controller.abort();
        },
    };
}
