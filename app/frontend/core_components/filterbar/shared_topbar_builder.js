// shared_topbar_builder.js
// Resolves when each dataset's persistent shared topbar participates in the active layout.
// Bridges active dataset containers, navbar/filter visibility, and topbar DOM hosts.
// Exists to keep the shared search-bar shell predictable without moving controls between bars.

/**
 * Decides whether one dataset's shared topbar belongs in the current layout.
 *
 * `articleViewActive` must come from the selected dataset view, the one
 * authoritative answer given by `isArticleDatasetView` in the dataset view
 * registry. It deliberately does not come from an article-open event: an
 * article view whose search matches no rows can never open a row, so that
 * event never arrives and the bar — dataset title, search field and close
 * control — used to be built and then hidden, leaving the article view with
 * no header at all.
 *
 * @param {Object} [options]
 * @param {boolean} [options.navbarVisible] Left navigation is expanded.
 * @param {boolean} [options.filterbarVisible] Right filter panel is expanded.
 * @param {boolean} [options.articleViewActive] The selected view is the article view.
 * @param {boolean} [options.allowBigCardSearchBar] Installation permits the flat bar there.
 * @param {boolean} [options.inlineHeroVisible] The large inline heading is on screen.
 * @returns {boolean}
 */
export function shouldShowSharedTopBar({
    navbarVisible,
    filterbarVisible,
    articleViewActive = false,
    allowBigCardSearchBar = false,
    inlineHeroVisible = false,
} = {}) {
    if (inlineHeroVisible) {
        return false;
    }

    return (
        !navbarVisible ||
        !filterbarVisible ||
        (Boolean(allowBigCardSearchBar) && Boolean(articleViewActive))
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
