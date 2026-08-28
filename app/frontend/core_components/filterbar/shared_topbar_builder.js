// shared_topbar_builder.js
// Resolves when each dataset's persistent shared topbar participates in the active layout.
// Bridges active dataset containers, navbar/filter visibility, and topbar DOM hosts.
// Exists to keep the shared search-bar shell predictable without moving controls between bars.

export function shouldShowSharedTopBar({
    navbarVisible,
    filterbarVisible,
    bigCardOpen = false,
    allowBigCardSearchBar = false,
    inlineHeroVisible = false,
} = {}) {
    if (inlineHeroVisible) {
        return false;
    }

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
