// tab_reorder_handler.js
// Enables drag-and-drop reordering of navigation tabs for admin users.
// Bridges tab drag events and the updateTabOrder API for persisted tab ordering.
// Exists to keep tab reorder behavior isolated from the main tab rendering flow.
import { endpoint_router } from "../../endpoints/endpoint_router.js";

const STATIC_TAB_PREFIX = "static:";
const STATIC_TAB_IDS = new Set(["user", "system_users", "register", "login", "logout"]);
const TAB_SELECTOR = ".navtablinks";
let draggedElement = null;
let initialTabOrder = [];

/**
 * Enables drag-and-drop reorder on tab buttons inside #navmenu.
 * Only call this when the user is an admin.
 * After reorder, saves the new order via POST /api/update-tab-order.
 */
export function enableTabDragAndDrop() {
    const container = document.getElementById("navmenu");
    if (!container) return;

    // Make all tabs draggable, including static auth/account tabs.
    const tabButtons = getTabElements(container);
    tabButtons.forEach((btn) => {
        if (btn.dataset.dragDropBound === "true") {
            return;
        }
        btn.dataset.dragDropBound = "true";

        btn.draggable = true;
        btn.addEventListener("click", suppressClickAfterDrag, { capture: true });
    });

    if (container.dataset.dragDropBound === "true") {
        return;
    }
    container.dataset.dragDropBound = "true";

    container.addEventListener("dragstart", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }

        const tabButton = target.closest(TAB_SELECTOR);
        if (!(tabButton instanceof HTMLElement) || tabButton.parentElement !== container) {
            event.preventDefault();
            return;
        }

        draggedElement = tabButton;
        initialTabOrder = readTabOrder(container);
        event.dataTransfer?.setData("text/plain", tabButton.getAttribute("data-id") || "");
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
        }
        requestAnimationFrame(() => {
            if (draggedElement !== tabButton) {
                return;
            }
            tabButton.classList.add("navtablinks--dragging");
            container.classList.add("navtabs--reordering");
        });
    });

    container.addEventListener("dragover", (event) => {
        if (!draggedElement) {
            return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
        }

        const afterElement = getDragAfterTab(container, event, draggedElement);
        if (afterElement === null) {
            container.appendChild(draggedElement);
            return;
        }
        container.insertBefore(draggedElement, afterElement);
    });

    container.addEventListener("drop", (event) => {
        if (draggedElement) {
            event.preventDefault();
        }
    });

    container.addEventListener("dragend", () => {
        if (!draggedElement) return;

        draggedElement.classList.remove("navtablinks--dragging");
        container.classList.remove("navtabs--reordering");
        const didOrderChange = !tabOrdersEqual(initialTabOrder, readTabOrder(container));

        draggedElement = null;
        initialTabOrder = [];

        suppressNextClick();
        if (didOrderChange) {
            void saveTabOrder(container);
        }
    });
}

function getTabElements(container) {
    return Array.from(container.children)
        .filter((child) => child instanceof HTMLElement && child.matches(TAB_SELECTOR));
}

function readTabOrder(container) {
    return getTabElements(container)
        .map((btn) => btn.getAttribute("data-id"))
        .filter(Boolean);
}

function tabOrdersEqual(left, right) {
    if (left.length !== right.length) {
        return false;
    }
    return left.every((tabId, index) => tabId === right[index]);
}

let shouldSuppressClick = false;

function suppressNextClick() {
    shouldSuppressClick = true;
    setTimeout(() => {
        shouldSuppressClick = false;
    }, 0);
}

function suppressClickAfterDrag(event) {
    if (!shouldSuppressClick) {
        return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
}

function usesVerticalTabOrdering(container) {
    return getTabElements(container).some((tab) =>
        String(tab.dataset.tabPresentation || "").startsWith("button")
    );
}

function getDragAfterTab(container, event, draggedTab) {
    const isVertical = usesVerticalTabOrdering(container);
    const isRtl = !isVertical && getComputedStyle(container).direction === "rtl";
    const pointerCoordinate = isVertical
        ? event.clientY
        : isRtl
            ? -event.clientX
            : event.clientX;

    const candidates = getTabElements(container).filter((tab) => tab !== draggedTab);
    return candidates.reduce((closest, tab) => {
        const box = tab.getBoundingClientRect();
        const tabCoordinate = isVertical
            ? box.top + box.height / 2
            : isRtl
                ? -(box.left + box.width / 2)
                : box.left + box.width / 2;
        const offset = pointerCoordinate - tabCoordinate;
        if (offset < 0 && offset > closest.offset) {
            return { offset, element: tab };
        }
        return closest;
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

/**
 * Reads the current tab button order from the DOM and saves it to the backend.
 * @param {HTMLElement} container - The #navmenu element
 */
async function saveTabOrder(container) {
    const buttons = getTabElements(container);
    const tabOrder = [];
    let sortIndex = 1;

    buttons.forEach((btn) => {
        const tabId = btn.getAttribute("data-id");
        if (!tabId) return;

        const normalizedTabId = STATIC_TAB_IDS.has(tabId)
            ? `${STATIC_TAB_PREFIX}${tabId}`
            : tabId;

        tabOrder.push({
            tab_id: normalizedTabId,
            sort_order: sortIndex++,
        });
    });

    try {
        await endpoint_router("updateTabOrder", {
            method: "POST",
            body_data: { tab_order: tabOrder },
        });
    } catch (err) {
        console.warn("Failed to save tab order:", err);
    }
}
