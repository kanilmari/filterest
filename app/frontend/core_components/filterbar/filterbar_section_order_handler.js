// filterbar_section_order_handler.js
// Applies one loaded site or personal order to every mounted filterbar.
// Bridges filterbar disclosure DOM, route permissions, and the tableless system_config API.
// Exists so section layout stays shared application configuration instead of browser-local state.


import { DEFAULT_FILTERBAR_SECTION_ORDER, normalizeFilterbarSectionOrder } from './filterbar_section_layout_normalizer.js';
import { loadFilterbarPreferences, getFilterbarPreferences, subscribeFilterbarPreferences,
    saveFilterbarOrder, canEditFilterbarOrder } from './filterbar_preferences_controller.js';
export { DEFAULT_FILTERBAR_SECTION_ORDER, normalizeFilterbarSectionOrder } from './filterbar_section_layout_normalizer.js';
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
        return { ready: Promise.resolve(), destroy: () => {} };
    }

    const controller = new AbortController();
    const { signal } = controller;
    let draggedSection = null;
    let suppressNextHeaderClick = false;
    let applyingRemoteLayout = false;
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
            const operation = saveFilterbarOrder(getCurrentSectionOrder(panelBody));
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
        scheduleSave();
    }, { signal });

    markSections();
    let applyRevision = 0;
    let lastOrder = '';
    async function applyLoadedLayout() {
        if (signal.aborted) return;
        const revision = ++applyRevision;
        const state = getFilterbarPreferences();
        if (!state.loaded) {
            clearTimeout(saveTimer);
        }
        applyingRemoteLayout = true;
        const orderKey = JSON.stringify(state.order);
        if (lastOrder !== orderKey) { applySectionOrder(panelBody, state.order); lastOrder = orderKey; }
        markSections();
        if (revision === applyRevision) applyingRemoteLayout = false;
    }
    const unsubscribe = subscribeFilterbarPreferences(() => { void applyLoadedLayout(); });
    const sectionMountObserver = new MutationObserver((mutations) => {
        // Reordering moves existing children too. Only new/replaced sections
        // need their position applied, preventing observer loops.
        // Other children (a spacer, a status row) are not sections: re-applying
        // the layout for them would move every section after them and undo a
        // section the visitor opened only on this page.
        const added = mutations.flatMap(m => [...m.addedNodes]);
        if (!signal.aborted && added.some(node => node instanceof HTMLElement
            && node.matches(SECTION_SELECTOR) && !node.dataset.filterbarOrderMounted)) {
            getSectionElements(panelBody).forEach(section => { section.dataset.filterbarOrderMounted = 'true'; });
            lastOrder = '';
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
