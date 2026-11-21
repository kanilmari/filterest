// filters_opener_and_closer.js
// Builds filter-result shortcut buttons and coordinates their temporary panel ownership.
// Bridges duplicated sort rows with the filter panel and disclosure public APIs.
// Exists so a temporary reveal can be reversed without overwriting user visibility choices.

export const TEMPORARY_FILTERS_TOGGLE_REQUEST_EVENT =
    "temporary-filters-toggle-request";
const TEMPORARY_DISCLOSURE_OPERATION_ATTRIBUTE =
    "filterbarTemporaryDisclosureOperation";
// Marks the filters section for as long as the temporary reveal owns it, so the
// remembered-disclosure projection (disclosure_state_controller.js) cannot
// close a reveal whose private state arrived after it opened.
const TEMPORARY_DISCLOSURE_OWNER_ATTRIBUTE =
    "filterbarTemporaryDisclosureOwner";

function getFiltersToggleButtons(eventHost, tableName) {
    return Array.from(
        eventHost.querySelectorAll("[data-temporary-filters-toggle-for]")
    ).filter(
        (button) => button.dataset.temporaryFiltersToggleFor === tableName
    );
}

/**
 * Build one localized Filters shortcut for placement beside a sort control.
 * Between a duplicated query-action row and the dataset-level temporary coordinator.
 * Exists so every visible search/sort surface sends the same semantic request.
 */
export function createTemporaryFiltersToggleButton(tableName, surfaceName) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add(
        "filterbar-filters-toggle-button",
        "fw-btn",
        "fw-btn--ghost"
    );
    button.dataset.temporaryFiltersToggleFor = tableName;
    button.dataset.temporaryFiltersToggleSurface = surfaceName;
    button.dataset.testid = `temporary-filters-toggle-${surfaceName}`;
    button.dataset.langKey = "filterbar_filter_results";
    button.textContent = "Filter results";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
        button.dispatchEvent(
            new CustomEvent(TEMPORARY_FILTERS_TOGGLE_REQUEST_EVENT, {
                bubbles: true,
                detail: { tableName },
            })
        );
    });
    return button;
}

/**
 * Coordinate one reversible Filters reveal without persisting panel visibility.
 * Between shortcut buttons, panel show/hide functions, and disclosure expand/collapse.
 * Exists so a second activation restores the original panel state while manual user action wins.
 */
export function createTemporaryFiltersOpenerAndCloser({
    tableName,
    eventHost,
    panel,
    filtersSection,
    sectionLayoutReady = Promise.resolve(),
    isPanelHidden,
    showPanel,
    hidePanel,
}) {
    if (
        !(eventHost instanceof HTMLElement) ||
        !(panel instanceof HTMLElement) ||
        !(filtersSection instanceof HTMLElement) ||
        typeof filtersSection.expand !== "function" ||
        typeof filtersSection.collapse !== "function"
    ) {
        if (eventHost instanceof HTMLElement) {
            getFiltersToggleButtons(eventHost, tableName).forEach((button) => {
                button.hidden = true;
                button.setAttribute("aria-hidden", "true");
            });
        }
        return {
            isActive: () => false,
            releaseTemporaryOwnership: () => false,
            // A surface without a filters section has nothing to open; the
            // arrival still ends, so it never waits for a later visit.
            ensureOpenForArrival: () => Promise.resolve("stale"),
            whenIdle: () => Promise.resolve(),
            destroy() {},
        };
    }

    let destroyed = false;
    let ownsTemporaryState = false;
    let panelWasOriginallyHidden = false;
    let originalTrigger = null;
    let pendingToggle = Promise.resolve();
    let ownershipRevision = 0;
    const filtersHeader = filtersSection?.querySelector(
        ":scope > .animated-disclosure-header"
    );

    if (!filtersSection?.id) {
        filtersSection.id = `${tableName}_filterBar_filters_section`;
    }

    function setOwnership(owns) {
        ownsTemporaryState = owns;
        panel.classList.toggle("filterbar-panel--temporary-filters-open", owns);
        if (owns) filtersSection.dataset[TEMPORARY_DISCLOSURE_OWNER_ATTRIBUTE] = "true";
        else delete filtersSection.dataset[TEMPORARY_DISCLOSURE_OWNER_ATTRIBUTE];
    }

    function revealFiltersHeader() {
        filtersHeader?.scrollIntoView?.({ block: "nearest" });
        filtersHeader?.focus?.({ preventScroll: true });
    }

    function syncButtons() {
        const isExpanded = filtersSection.classList.contains("is-expanded");
        getFiltersToggleButtons(eventHost, tableName).forEach((button) => {
            button.setAttribute("aria-controls", filtersSection.id);
            button.setAttribute("aria-expanded", String(isExpanded));
            button.setAttribute("aria-pressed", String(ownsTemporaryState));
            button.classList.toggle(
                "filterbar-filters-toggle-button--temporary-owner",
                ownsTemporaryState
            );
        });
    }

    async function runTemporaryDisclosureOperation(operation) {
        filtersSection.dataset[TEMPORARY_DISCLOSURE_OPERATION_ATTRIBUTE] = "true";
        try {
            await operation();
        } finally {
            delete filtersSection.dataset[TEMPORARY_DISCLOSURE_OPERATION_ATTRIBUTE];
        }
    }

    async function openTemporarily(trigger, operationRevision) {
        await sectionLayoutReady;
        if (
            destroyed ||
            ownsTemporaryState ||
            ownershipRevision !== operationRevision
        ) return;

        panelWasOriginallyHidden = isPanelHidden();
        originalTrigger = trigger instanceof HTMLElement ? trigger : null;
        setOwnership(true);
        if (panelWasOriginallyHidden) {
            showPanel();
        }
        syncButtons();

        await runTemporaryDisclosureOperation(() =>
            filtersSection.expand({ animate: true })
        );
        if (
            !ownsTemporaryState ||
            destroyed ||
            ownershipRevision !== operationRevision
        ) return;

        revealFiltersHeader();
        syncButtons();
    }

    async function closeAndRestore() {
        if (!ownsTemporaryState || destroyed) return;
        const operationRevision = ownershipRevision;
        const shouldRestoreHiddenPanel = panelWasOriginallyHidden;

        await runTemporaryDisclosureOperation(() =>
            filtersSection.collapse({ animate: true })
        );
        if (destroyed || ownershipRevision !== operationRevision) return;
        setOwnership(false);
        if (shouldRestoreHiddenPanel) {
            hidePanel();
        }
        syncButtons();
        window.requestAnimationFrame(() => {
            if (!destroyed && originalTrigger?.isConnected) {
                originalTrigger.focus({ preventScroll: true });
            }
        });
        originalTrigger = null;
    }

    /**
     * Make sure the panel and its filters section are open for an arriving visitor.
     * Between Home's Filter results link (filters_arrival_request.js) and this coordinator.
     * Exists so the arrival opens what is actually closed, whatever this panel
     * remembered from an earlier visit, and never closes anything (unlike the toggle).
     * @param {{ whenReady?: () => Promise<unknown>, isCurrent?: () => boolean }} options
     * @returns {Promise<"delivered" | "replaced" | "stale">}
     */
    function ensureOpenForArrival({ whenReady = () => sectionLayoutReady, isCurrent = () => true } = {}) {
        // Counted from the request, as the toggle does: a person's own close
        // while this waits behind an unfinished toggle still wins.
        const operationRevision = ownershipRevision;
        const result = pendingToggle.then(async () => {
            await Promise.all([sectionLayoutReady, whenReady()]);
            if (destroyed) return "replaced";
            // A person's own panel or section action while this waited wins.
            if (!isCurrent() || ownershipRevision !== operationRevision) return "stale";
            const isExpanded = () => filtersSection.classList.contains("is-expanded");
            if (!ownsTemporaryState) {
                if (!isPanelHidden() && isExpanded()) {
                    revealFiltersHeader();
                    return "delivered";
                }
                panelWasOriginallyHidden = isPanelHidden();
                originalTrigger = null;
                setOwnership(true);
            }
            if (isPanelHidden()) showPanel();
            syncButtons();
            if (!isExpanded()) {
                await runTemporaryDisclosureOperation(() =>
                    filtersSection.expand({ animate: true })
                );
            }
            if (destroyed) return "replaced";
            if (!ownsTemporaryState || ownershipRevision !== operationRevision) return "stale";
            revealFiltersHeader();
            syncButtons();
            return "delivered";
        });
        pendingToggle = result.catch(() => {});
        return result;
    }

    function handleToggleRequest(event) {
        if (event.detail?.tableName !== tableName) return;
        const trigger = event.target;
        const requestRevision = ownershipRevision;
        pendingToggle = pendingToggle.then(() =>
            ownsTemporaryState
                ? closeAndRestore()
                : openTemporarily(trigger, requestRevision)
        );
    }

    function handleManualDisclosureToggle() {
        releaseTemporaryOwnership();
    }

    function handleDisclosureStateChange() {
        syncButtons();
    }

    /**
     * Release temporary ownership without undoing the user's current UI action.
     * Between manual panel/disclosure events and the pending reversible shortcut state.
     * Exists so explicit user changes always outrank the earlier temporary snapshot.
     */
    function releaseTemporaryOwnership() {
        ownershipRevision += 1;
        if (!ownsTemporaryState) return false;
        setOwnership(false);
        originalTrigger = null;
        syncButtons();
        return true;
    }

    eventHost.addEventListener(
        TEMPORARY_FILTERS_TOGGLE_REQUEST_EVENT,
        handleToggleRequest
    );
    filtersHeader?.addEventListener("click", handleManualDisclosureToggle);
    filtersSection.addEventListener(
        "animated-disclosure-toggle",
        handleDisclosureStateChange
    );
    syncButtons();

    return {
        isActive: () => ownsTemporaryState,
        releaseTemporaryOwnership,
        ensureOpenForArrival,
        whenIdle: () => pendingToggle,
        destroy() {
            destroyed = true;
            ownershipRevision += 1;
            setOwnership(false);
            delete filtersSection.dataset[TEMPORARY_DISCLOSURE_OPERATION_ATTRIBUTE];
            eventHost.removeEventListener(
                TEMPORARY_FILTERS_TOGGLE_REQUEST_EVENT,
                handleToggleRequest
            );
            filtersHeader?.removeEventListener(
                "click",
                handleManualDisclosureToggle
            );
            filtersSection.removeEventListener(
                "animated-disclosure-toggle",
                handleDisclosureStateChange
            );
        },
    };
}
