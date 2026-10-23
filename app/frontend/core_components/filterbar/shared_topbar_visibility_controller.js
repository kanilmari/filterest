// shared_topbar_visibility_controller.js
// Keeps the dataset toolbar visible and accessible across view and panel changes.
// Connects live panel state and the shared toolbar to phone search and menu focus.
// Phone identity and toolbar controls stay in place independently of scrolling.
import { getChosenDatasetView } from "../state_stores/dataset_view_choice_saver.js";
import { PHONE_BREAKPOINT_PX, show_search_only_bar_in_big_card_view } from "../../ui_config.js";
import { isSharedTopBarHostActive, shouldShowSharedTopBar } from "./shared_topbar_builder.js";
import { CARD_VIEW_KEY, isArticleDatasetView } from "../table_views/dataset_view_registry.js";
import { updateShowMenuButtonPosition } from "../navigation/menu_button/navbar_visibility_handler.js";
import { createMobileTopbarSearchController } from './mobile_topbar_search_controller.js';
import { createTopNavHomeButton, placeTopNavHomeButton } from '../front_page/top_nav_home_button.js';
import { isHeroControlAreaVisible } from './dataset_corner_controls.js';
import { canShowFrontPageLink, refreshFrontPageLinkLabel } from '../front_page/front_page_link.js';
import { HOME_AVAILABILITY_CHANGED_EVENT } from '../front_page/front_page_availability.js';
const SHARED_TOPBAR_TRANSITION_DURATION_MS = 260;

export function createSharedTopbarVisibilityController({ tableName, currentView, tablePartsContainer,
    sharedTopBar, sharedTopBarArticleClose, inlineHeroHost, getState,
    isHidden, isNavbarVisible, captureMenuFocus, syncCornerControls }) {
    let sharedTopBarHideTimer = null;
    const mobileSearch = createMobileTopbarSearchController(sharedTopBar);
    let homeLink = null;
    function reconcileHomeAvailability() {
        if (!canShowFrontPageLink(localStorage.getItem('button_state') === 'logout')) {
            homeLink?.remove();
            homeLink = null;
        } else {
            homeLink ||= createTopNavHomeButton();
            refreshFrontPageLinkLabel(homeLink);
        }
    }
    function clearSharedTopBarTransitionTimers() {
        if (sharedTopBarHideTimer !== null) {
            clearTimeout(sharedTopBarHideTimer);
            sharedTopBarHideTimer = null;
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
            if (window.innerWidth <= PHONE_BREAKPOINT_PX) {
                sharedTopBar.classList.add('dataset-shared-topbar--visible');
                return;
            }
            sharedTopBar.getBoundingClientRect();
            // The layout read establishes the collapsed start; begin the CSS
            // reveal before announcing its owner, without an empty RAF gap.
            sharedTopBar.classList.add("dataset-shared-topbar--visible");
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
        // Settings refresh updates mounted headers immediately; the same check
        // also runs when the runtime's host observer reactivates a cached dataset.
        reconcileHomeAvailability();
        const { bigCardOpen, inlineHeroVisible, activeScrollable } = getState();
        const navbarVisible = isNavbarVisible();
        const filterbarVisible = !isHidden();
        const activeView =
            getChosenDatasetView(tableName) || currentView || CARD_VIEW_KEY;
        // The selected view is the authoritative answer to "is the article view
        // showing". An article-open event cannot answer it, because an article
        // view with no matching rows never opens a row and never emits one.
        const articleViewActive = isArticleDatasetView(activeView);
        const phone = window.innerWidth <= PHONE_BREAKPOINT_PX;
        const active = isSharedTopBarHostActive(sharedTopBar);
        const homeInHero = !phone && !bigCardOpen
            && isHeroControlAreaVisible(inlineHeroHost, activeScrollable);
        const shouldShowBar =
            active &&
            (phone || shouldShowSharedTopBar({
                navbarVisible,
                filterbarVisible,
                articleViewActive,
                allowBigCardSearchBar: show_search_only_bar_in_big_card_view,
                inlineHeroVisible,
            }));
        // Hiding/inerting the bar can blur its menu before corner reconciliation.
        // Carry only this update's outgoing focus intent, including on history restore.
        const menuHadFocus = captureMenuFocus(active);
        const homeHadFocus = document.activeElement === homeLink;
        setSharedTopBarVisibility(shouldShowBar);
        // Home follows its row, independently of the menu and bar visibility.
        // Phone DOM order is menu → Home → identity → search → filter toolbar.
        // Desktop keeps the existing end slot and hero placement.
        placeTopNavHomeButton(homeLink, homeInHero || !shouldShowBar
            ? inlineHeroHost?.querySelector('.hero-dataset-tabs')
            : sharedTopBar.querySelector(phone
                ? '.dataset-shared-topbar__slot--start'
                : '.dataset-shared-topbar__slot--end'));
        if (active && homeHadFocus) homeLink.focus({ preventScroll: true });
        mobileSearch.sync({ phone, active: shouldShowBar });
        setSharedTopBarArticleCloseVisibility(
            shouldShowBar && !phone && (bigCardOpen || activeView !== CARD_VIEW_KEY)
        );

        syncCornerControls(active, menuHadFocus);
        updateShowMenuButtonPosition();
    }

    window.addEventListener(HOME_AVAILABILITY_CHANGED_EVENT, syncSharedTopBar);
    return { syncSharedTopBar, clearSharedTopBarTransitionTimers,
        destroy() {
            window.removeEventListener(HOME_AVAILABILITY_CHANGED_EVENT, syncSharedTopBar);
            clearSharedTopBarTransitionTimers(); mobileSearch.destroy(); homeLink?.remove();
        } };
}
