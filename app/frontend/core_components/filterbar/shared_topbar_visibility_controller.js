// shared_topbar_visibility_controller.js
// Keeps the dataset toolbar visible and accessible across view and panel changes.
// Connects live panel state and the shared toolbar to its phone search toggle.
// Phone identity and toolbar controls stay in place independently of scrolling.
import { getChosenDatasetView } from "../state_stores/dataset_view_choice_saver.js";
import { show_search_only_bar_in_big_card_view } from "../../ui_config.js";
import { isSharedTopBarHostActive, shouldShowSharedTopBar } from "./shared_topbar_builder.js";
import { CARD_VIEW_KEY, isArticleDatasetView } from "../table_views/dataset_view_registry.js";
import { updateShowMenuButtonPosition } from "../navigation/menu_button/navbar_visibility_handler.js";
import { createMobileTopbarSearchController } from './mobile_topbar_search_controller.js';
const SHARED_TOPBAR_TRANSITION_DURATION_MS = 260;

export function createSharedTopbarVisibilityController({ tableName, currentView, tablePartsContainer,
    sharedTopBar, sharedTopBarArticleClose, getState,
    isHidden, isNavbarVisible, syncCornerControls }) {
    let sharedTopBarHideTimer = null;
    let sharedTopBarShowFrame = 0;
    const mobileSearch = createMobileTopbarSearchController(sharedTopBar);
    function clearSharedTopBarTransitionTimers() {
        if (sharedTopBarHideTimer !== null) {
            clearTimeout(sharedTopBarHideTimer);
            sharedTopBarHideTimer = null;
        }

        if (sharedTopBarShowFrame) {
            cancelAnimationFrame(sharedTopBarShowFrame);
            sharedTopBarShowFrame = 0;
        }
    }

    function setSharedTopBarAccessibility(isInteractive) {
        sharedTopBar.setAttribute("aria-hidden", isInteractive ? "false" : "true");
        sharedTopBar.inert = !isInteractive;

        if (!isInteractive) {
            const activeElement = document.activeElement;
            if (activeElement instanceof HTMLElement && sharedTopBar.contains(activeElement)) {
                activeElement.blur();
            }
        }
    }

    function setSharedTopBarArticleCloseVisibility(shouldShowClose) {
        sharedTopBarArticleClose.hidden = !shouldShowClose;
        sharedTopBarArticleClose.setAttribute(
            "aria-hidden",
            shouldShowClose ? "false" : "true"
        );
        sharedTopBarArticleClose.tabIndex = shouldShowClose ? 0 : -1;
    }

    function setSharedTopBarVisibility(shouldShowBar) {
        tablePartsContainer.dataset.sharedTopbarVisible = shouldShowBar
            ? "true"
            : "false";

        if (shouldShowBar) {
            clearSharedTopBarTransitionTimers();
            sharedTopBar.hidden = false;
            setSharedTopBarAccessibility(true);
            if (window.innerWidth <= 700) {
                sharedTopBar.classList.add('dataset-shared-topbar--visible');
                return;
            }
            sharedTopBar.getBoundingClientRect();
            sharedTopBarShowFrame = requestAnimationFrame(() => {
                sharedTopBarShowFrame = 0;
                sharedTopBar.classList.add("dataset-shared-topbar--visible");
            });
            return;
        }

        setSharedTopBarAccessibility(false);
        sharedTopBar.classList.remove("dataset-shared-topbar--visible");

        // Popup/focus mutations can resync this same hidden state every frame.
        // Keep the original deadline so the collapsed 2px border cannot linger
        // and disappear later, after a category popup has measured its anchor.
        if (sharedTopBar.hidden || sharedTopBarHideTimer !== null) {
            return;
        }

        clearSharedTopBarTransitionTimers();
        sharedTopBarHideTimer = setTimeout(() => {
            sharedTopBarHideTimer = null;
            if (!sharedTopBar.classList.contains("dataset-shared-topbar--visible")) {
                sharedTopBar.hidden = true;
            }
        }, SHARED_TOPBAR_TRANSITION_DURATION_MS);
    }

    function syncSharedTopBar() {
        const { bigCardOpen, inlineHeroVisible } = getState();
        const navbarVisible = isNavbarVisible();
        const filterbarVisible = !isHidden();
        const activeView =
            getChosenDatasetView(tableName) || currentView || CARD_VIEW_KEY;
        // The selected view is the authoritative answer to "is the article view
        // showing". An article-open event cannot answer it, because an article
        // view with no matching rows never opens a row and never emits one.
        const articleViewActive = isArticleDatasetView(activeView);
        const phone = window.innerWidth <= 700;
        const shouldShowBar =
            isSharedTopBarHostActive(sharedTopBar) &&
            (phone || shouldShowSharedTopBar({
                navbarVisible,
                filterbarVisible,
                articleViewActive,
                allowBigCardSearchBar: show_search_only_bar_in_big_card_view,
                inlineHeroVisible,
            }));

        setSharedTopBarVisibility(shouldShowBar);
        mobileSearch.sync({ phone, active: shouldShowBar });
        setSharedTopBarArticleCloseVisibility(
            shouldShowBar && !phone && (bigCardOpen || activeView !== CARD_VIEW_KEY)
        );

        syncCornerControls();
        updateShowMenuButtonPosition();
    }

    return { syncSharedTopBar, clearSharedTopBarTransitionTimers,
        destroy() { clearSharedTopBarTransitionTimers(); mobileSearch.destroy(); } };
}
