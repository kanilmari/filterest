// shared_topbar_visibility_controller.js
// Keeps the dataset toolbar visible and accessible across view and panel changes.
// Connects live panel state and the shared toolbar to phone search and menu focus.
// Phone identity and toolbar controls stay in place independently of scrolling.
import { getChosenDatasetView } from "../state_stores/dataset_view_choice_saver.js";
import { PHONE_BREAKPOINT_PX, show_search_only_bar_in_big_card_view } from "../../ui_config.js";
import { isSharedTopBarHostActive, shouldShowSharedTopBar, resolveDatasetTopbarMode } from "./shared_topbar_builder.js";
import { CARD_VIEW_KEY, isArticleDatasetView } from "../table_views/dataset_view_registry.js";
import { updateShowMenuButtonPosition } from "../navigation/menu_button/navbar_visibility_handler.js";
import { createMobileTopbarSearchController } from './mobile_topbar_search_controller.js';
import { canShowTopNavHomeButton, createTopNavHomeButton, placeTopNavHomeButton } from '../front_page/top_nav_home_button.js';
import { refreshFrontPageLinkLabel } from '../front_page/front_page_link.js';
import { HOME_AVAILABILITY_CHANGED_EVENT } from '../front_page/front_page_availability.js';
const SHARED_TOPBAR_TRANSITION_DURATION_MS = 260;

export function createSharedTopbarVisibilityController({ tableName, currentView, tablePartsContainer,
    sharedTopBar, sharedTopBarArticleClose, inlineHeroHost, getState,
    isHidden, isNavbarVisible, captureControlFocus, syncCornerControls }) {
    let sharedTopBarHideTimer = null;
    const mobileSearch = createMobileTopbarSearchController(sharedTopBar);
    let homeLink = null;
    const heroRow = inlineHeroHost?.querySelector('.filterbar-inline-hero__top-row');
    const heroTabs = heroRow?.querySelector('.hero-dataset-tabs');
    const center = sharedTopBar.querySelector('.dataset-shared-topbar__center');
    const end = sharedTopBar.querySelector('.dataset-shared-topbar__slot--end');

    function placeHeroRow(barVisible, showTabs) {
        if (!heroRow) return;
        // Keep the same node outside the scroller on both sides of the scroll
        // threshold, including while the content tools occupy the centre.
        const host = barVisible ? center : inlineHeroHost;
        if (heroRow.parentElement !== host) host.prepend(heroRow);
        heroRow.hidden = barVisible && !showTabs;
        heroRow.inert = heroRow.hidden;
    }
    function reconcileHomeAvailability() {
        if (!canShowTopNavHomeButton()) {
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

    function syncSharedTopBar(event) {
        // Settings refresh updates mounted headers immediately; the same check
        // also runs when the runtime's host observer reactivates a cached dataset.
        reconcileHomeAvailability();
        const { bigCardOpen, inlineHeroVisible } = getState();
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
        const mode = resolveDatasetTopbarMode({ bigCardOpen, articleViewActive, inlineHeroVisible });
        const shouldShowBar = active && shouldShowSharedTopBar({
            navbarVisible, filterbarVisible, articleViewActive,
            allowBigCardSearchBar: show_search_only_bar_in_big_card_view,
        });
        const showTabs = mode === "hero" && !phone;
        const previous = document.activeElement;
        // Hiding the navbar closer can return focus to body before the event reaches this toolbar.
        const restoreMenuFocus = active && event?.detail?.menuCloserHadFocus && previous === document.body;
        const focus = restoreMenuFocus ? "menu" : captureControlFocus(active);
        const focusedTab = heroRow?.contains(previous);
        const homeHadFocus = homeLink && previous === homeLink;
        const contentHadFocus = center.contains(previous) && !focusedTab;
        sharedTopBar.dataset.topbarMode = mode;
        placeHeroRow(shouldShowBar, showTabs);
        setSharedTopBarVisibility(shouldShowBar);
        placeTopNavHomeButton(homeLink, !shouldShowBar || showTabs ? heroTabs : end);
        mobileSearch.sync({ phone, active: shouldShowBar, article: mode === "article", hero: showTabs });
        setSharedTopBarArticleCloseVisibility(
            shouldShowBar && !phone && mode !== "hero" && (bigCardOpen || activeView !== CARD_VIEW_KEY)
        );
        // Return disappearing header content to the menu in the actual left corner.
        const focusMenu = (focusedTab && heroRow.hidden) || (contentHadFocus && showTabs);
        syncCornerControls(active, focusMenu && active ? "menu" : focus);
        if (active && homeHadFocus) homeLink.focus({ preventScroll: true });
        else if (active && focusedTab && !heroRow.hidden && previous.isConnected) previous.focus({ preventScroll: true });
        updateShowMenuButtonPosition();
    }

    window.addEventListener(HOME_AVAILABILITY_CHANGED_EVENT, syncSharedTopBar);
    return { syncSharedTopBar, clearSharedTopBarTransitionTimers,
        destroy() {
            window.removeEventListener(HOME_AVAILABILITY_CHANGED_EVENT, syncSharedTopBar);
            clearSharedTopBarTransitionTimers(); mobileSearch.destroy(); homeLink?.remove();
        } };
}
