// shared_topbar_builder.js
// Resolves shared topbar visibility and docks existing control buttons into dataset topbar slots.
// Bridges active dataset containers, reusable menu/filter toggle buttons, and topbar DOM hosts.
// Exists to keep the shared search-bar shell predictable without cloning global controls.

const DEFAULT_DOCKED_CLASS = "shared-topbar-docked-button";

function ensureDockHomeMarker(button) {
    if (!(button instanceof HTMLElement)) {
        return null;
    }

    if (button.__sharedTopbarHomeMarker instanceof Comment) {
        return button.__sharedTopbarHomeMarker;
    }

    const parent = button.parentNode;
    if (!parent) {
        return null;
    }

    const marker = document.createComment(
        `${button.id || button.className || "button"}-shared-topbar-home`
    );
    parent.insertBefore(marker, button);
    button.__sharedTopbarHomeMarker = marker;
    return marker;
}

export function shouldShowSharedTopBar({
    navbarVisible,
    filterbarVisible,
    bigCardOpen = false,
    allowBigCardSearchBar = false,
} = {}) {
    return (
        !navbarVisible ||
        !filterbarVisible ||
        (Boolean(allowBigCardSearchBar) && Boolean(bigCardOpen))
    );
}

export function isSharedTopBarHostActive(hostElement) {
    if (!(hostElement instanceof HTMLElement)) {
        return false;
    }

    const contentContainer = hostElement.closest(".content_div");
    if (!contentContainer) {
        return true;
    }

    return !contentContainer.classList.contains("hidden");
}

export function dockButtonIntoSharedTopBar(
    button,
    host,
    owner,
    dockedClass = DEFAULT_DOCKED_CLASS
) {
    if (!(button instanceof HTMLElement) || !(host instanceof HTMLElement) || !owner) {
        return false;
    }

    ensureDockHomeMarker(button);
    button.__sharedTopbarOwner = owner;
    button.classList.add(dockedClass);
    host.replaceChildren(button);
    return true;
}

export function restoreButtonFromSharedTopBar(
    button,
    owner,
    dockedClass = DEFAULT_DOCKED_CLASS
) {
    if (!(button instanceof HTMLElement) || !owner) {
        return false;
    }

    if (button.__sharedTopbarOwner !== owner) {
        return false;
    }

    const marker = button.__sharedTopbarHomeMarker;
    button.__sharedTopbarOwner = null;
    button.classList.remove(dockedClass);

    if (marker?.parentNode) {
        marker.parentNode.insertBefore(button, marker.nextSibling);
        return true;
    }

    return false;
}
