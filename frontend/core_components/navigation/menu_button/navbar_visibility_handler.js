// navbar_visibility_handler.js
// Initialises the navbar show/hide toggle and repositions the floating show-button on resize.
// Bridges NAVBAR_WIDTH_THRESHOLD from ui_config with DOM event listeners and localStorage state.
// Exists to isolate all navbar collapse/expand logic from the main navigation entry point.
import { NAVBAR_WIDTH_THRESHOLD } from "../../../ui_config.js";
import { setupScrollPassthrough } from "../../../reusable_components/scroll_passthrough.js";

export const NAVBAR_VISIBILITY_CHANGED_EVENT = "navbar-visibility-changed";
const NAVBAR_SHOW_BUTTON_REVEAL_DELAY_MS = 0;
const NAVBAR_COLLAPSE_COMPLETE_CLASS = 'navbar-collapse-complete';
const NAVBAR_OPENING_CLASS = 'navbar-opening';
let showButtonRevealTimer = 0;
let navbarCollapseCompletionCleanup = null;
let navbarOpeningCleanup = null;

// Päivittää piilotetun navigaatiopalkin palauttavan napin paikan niin,
// että se pysyy saman app-kuoren vasemmassa yläkulmassa kuin itse navbar.
export function updateShowMenuButtonPosition() {
  const showButton = document.getElementById('showMenuButton');
  const bodyContent = document.querySelector('.body_content');
  if (!showButton || !bodyContent) return;

  const rootStyle = document.documentElement.style;
  // Reset inline styles to let CSS handle the size (44px)
  showButton.style.width = '';
  showButton.style.height = '';
  showButton.style.left = '';

  if (
    !navVisible &&
    !showButton.classList.contains('shared-topbar-menu-source-hidden')
  ) {
    rootStyle.setProperty('--menu-button-search-offset', '68px');
  } else {
    rootStyle.setProperty('--menu-button-search-offset', '0px');
  }
}

function clearShowButtonRevealTimer() {
  if (!showButtonRevealTimer) return;
  window.clearTimeout(showButtonRevealTimer);
  showButtonRevealTimer = 0;
}

function parseCssTimeToMs(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) return null;
  if (rawValue.endsWith('ms')) {
    const ms = Number.parseFloat(rawValue);
    return Number.isFinite(ms) ? ms : null;
  }
  if (rawValue.endsWith('s')) {
    const seconds = Number.parseFloat(rawValue);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }
  const numberValue = Number.parseFloat(rawValue);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function getNavbarTransformTransitionDurationMs(navbar) {
  const styles = window.getComputedStyle(navbar);
  const properties = styles.transitionProperty.split(',').map((item) => item.trim());
  const durations = styles.transitionDuration.split(',').map((item) => item.trim());
  const transformIndex = properties.findIndex((property) => property === 'transform' || property === 'all');
  const duration = durations[transformIndex >= 0 ? transformIndex : 0] || durations[0];
  return parseCssTimeToMs(duration) ?? 700;
}

function clearNavbarCollapseCompletion(navbar) {
  if (navbarCollapseCompletionCleanup) {
    navbarCollapseCompletionCleanup();
    navbarCollapseCompletionCleanup = null;
  }
  navbar?.classList.remove(NAVBAR_COLLAPSE_COMPLETE_CLASS);
}

function finishNavbarCollapseAfterTransition(navbar, { immediate = false } = {}) {
  clearNavbarCollapseCompletion(navbar);

  if (!navbar.classList.contains('collapsed')) {
    return;
  }

  if (immediate) {
    navbar.classList.add(NAVBAR_COLLAPSE_COMPLETE_CLASS);
    return;
  }

  const completeCollapse = () => {
    if (navbarCollapseCompletionCleanup) {
      navbarCollapseCompletionCleanup();
      navbarCollapseCompletionCleanup = null;
    }
    if (navbar.classList.contains('collapsed')) {
      navbar.classList.add(NAVBAR_COLLAPSE_COMPLETE_CLASS);
    }
  };

  const handleTransitionEnd = (event) => {
    if (event.target === navbar && event.propertyName === 'transform') {
      completeCollapse();
    }
  };

  const fallbackTimer = window.setTimeout(
    completeCollapse,
    getNavbarTransformTransitionDurationMs(navbar) + 50
  );

  navbar.addEventListener('transitionend', handleTransitionEnd);
  navbarCollapseCompletionCleanup = () => {
    window.clearTimeout(fallbackTimer);
    navbar.removeEventListener('transitionend', handleTransitionEnd);
  };
}

function clearNavbarOpening(navbar) {
  if (navbarOpeningCleanup) {
    navbarOpeningCleanup();
    navbarOpeningCleanup = null;
  }
  navbar?.classList.remove(NAVBAR_OPENING_CLASS);
}

/**
 * Keeps the top-row cursor visually stable only while the navbar slides in.
 * This class is cosmetic: it never changes disabled state or pointer events.
 */
function markNavbarOpeningUntilTransitionEnds(navbar, { immediate = false } = {}) {
  clearNavbarOpening(navbar);
  if (immediate) {
    return;
  }

  const transitionDurationMs = getNavbarTransformTransitionDurationMs(navbar);
  if (transitionDurationMs <= 0) {
    return;
  }

  navbar.classList.add(NAVBAR_OPENING_CLASS);

  const finishOpening = () => {
    clearNavbarOpening(navbar);
  };
  const handleTransitionStop = (event) => {
    if (event.target === navbar && event.propertyName === 'transform') {
      finishOpening();
    }
  };
  const fallbackTimer = window.setTimeout(
    finishOpening,
    transitionDurationMs + 50
  );

  navbar.addEventListener('transitionend', handleTransitionStop);
  navbar.addEventListener('transitioncancel', handleTransitionStop);
  navbarOpeningCleanup = () => {
    window.clearTimeout(fallbackTimer);
    navbar.removeEventListener('transitionend', handleTransitionStop);
    navbar.removeEventListener('transitioncancel', handleTransitionStop);
  };
}

function setShowButtonVisibility(showButton, shouldShow, { immediate = false } = {}) {
  clearShowButtonRevealTimer();
  showButton.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
  showButton.tabIndex = shouldShow ? 0 : -1;

  if (!shouldShow) {
    showButton.classList.remove('menu-toggle-visible');
    return;
  }

  const revealButton = () => {
    showButton.classList.add('menu-toggle-visible');
    updateShowMenuButtonPosition();
  };

  if (immediate) {
    revealButton();
    return;
  }

  showButtonRevealTimer = window.setTimeout(() => {
    showButtonRevealTimer = 0;
    revealButton();
  }, NAVBAR_SHOW_BUTTON_REVEAL_DELAY_MS);
}

function animateInitialNavbarEntrance(
  navbar,
  tabsContainer,
  showButton,
  hideButton,
  bodyContent
) {
  hideButton.setAttribute('aria-hidden', 'false');
  hideButton.setAttribute('aria-expanded', 'true');
  hideButton.tabIndex = 0;
  setShowButtonVisibility(showButton, false, { immediate: true });
  showButton.setAttribute('aria-expanded', 'true');
  bodyContent?.classList.add('navbar-transitions-ready');

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      markNavbarOpeningUntilTransitionEnds(navbar);
      navbar.classList.remove('collapsed');
      tabsContainer.classList.remove('navbar_hidden');
      if (bodyContent) {
        delete bodyContent.dataset.navbarInitialOpen;
      }
      updateShowMenuButtonPosition();
    });
  });
}

function applyNavbarVisibility(
  navbar,
  tabsContainer,
  showButton,
  hideButton,
  bodyContent,
  isVisible,
  { immediate = false } = {}
) {
  const wasCollapsed = navbar.classList.contains('collapsed');
  hideButton.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
  hideButton.setAttribute('aria-expanded', isVisible ? 'true' : 'false');
  hideButton.tabIndex = isVisible ? 0 : -1;
  showButton.setAttribute('aria-expanded', isVisible ? 'true' : 'false');

  if (isVisible) {
    clearNavbarCollapseCompletion(navbar);
    if (wasCollapsed) {
      markNavbarOpeningUntilTransitionEnds(navbar, { immediate });
    } else {
      clearNavbarOpening(navbar);
    }
    navbar.classList.remove('collapsed');
    setShowButtonVisibility(showButton, false, { immediate: true });
    tabsContainer.classList.remove('navbar_hidden');
  } else {
    clearNavbarOpening(navbar);
    navbar.classList.add('collapsed');
    finishNavbarCollapseAfterTransition(navbar, { immediate });
    tabsContainer.classList.add('navbar_hidden');
    setShowButtonVisibility(
      showButton,
      !showButton.classList.contains('shared-topbar-menu-source-hidden'),
      { immediate }
    );
  }

  updateShowMenuButtonPosition();
  window.dispatchEvent(
    new CustomEvent(NAVBAR_VISIBILITY_CHANGED_EVENT, {
      detail: { isVisible },
    })
  );
}

// Kynnysarvo pikseleinä
let navVisible = true; // Nykyisen leveyden näkyvyystila

function storeNavbarVisibility(isVisible) {
  const currentIsWide = window.innerWidth >= NAVBAR_WIDTH_THRESHOLD;
  localStorage.setItem(
    currentIsWide ? 'navVisibleWide' : 'navVisibleNarrow',
    String(isVisible)
  );
}

/**
 * Toggles the shared navbar state from any surface-specific menu button.
 * Between persistent navbar/floating/topbar controls and the one navigation panel.
 * Exists so controls never forward clicks through another DOM button.
 */
export function toggleNavbarVisibility() {
  const navbar = document.getElementById('navbar');
  const showButton = document.getElementById('showMenuButton');
  const hideButton = document.getElementById('hideMenuButton');
  const tabsContainer = document.getElementById('tabs_container');
  const bodyContent = document.querySelector('.body_content');

  if (!navbar || !showButton || !hideButton || !tabsContainer) {
    return false;
  }

  navVisible = !navVisible;
  storeNavbarVisibility(navVisible);
  applyNavbarVisibility(
    navbar,
    tabsContainer,
    showButton,
    hideButton,
    bodyContent,
    navVisible
  );
  return navVisible;
}

/**
 * Reconciles the fixed fallback after a context topbar takes or releases menu ownership.
 * Between filterbar-owned menu buttons and the navbar's persistent fixed controls.
 * Exists to keep exactly one collapsed-state menu target interactive and reachable.
 */
export function syncNavbarMenuButtonAccessibility() {
  const showButton = document.getElementById('showMenuButton');
  if (!showButton) {
    return;
  }

  const shouldShowFloatingButton =
    !navVisible &&
    !showButton.classList.contains('shared-topbar-menu-source-hidden');
  setShowButtonVisibility(showButton, shouldShowFloatingButton, { immediate: true });
  updateShowMenuButtonPosition();
}

export function initNavbar() {
  const navbar = document.getElementById('navbar');
  const showButton = document.getElementById('showMenuButton');
  const hideButton = document.getElementById('hideMenuButton');
  const tabsContainer = document.getElementById('tabs_container');
  const bodyContent = document.querySelector('.body_content');


  // Tarkistetaan, että DOM-elementit löytyvät
  if (!navbar || !showButton || !hideButton || !tabsContainer) {
    console.warn('Navbar-elementtejä ei löydy DOM:sta');
    return;
  }

  // Haetaan tilat localStoragesta ja asetetaan alkutila
  const storedNavVisibleWide = localStorage.getItem('navVisibleWide');
  const storedNavVisibleNarrow = localStorage.getItem('navVisibleNarrow');
  const isWide = window.innerWidth >= NAVBAR_WIDTH_THRESHOLD;
  if (isWide) {
    navVisible = storedNavVisibleWide !== null ? storedNavVisibleWide === 'true' : true;
  } else {
    navVisible = storedNavVisibleNarrow !== null ? storedNavVisibleNarrow === 'true' : false;
  }

  const shouldAnimateInitialOpen =
    navVisible && bodyContent?.dataset.navbarInitialOpen === 'true';

  if (shouldAnimateInitialOpen) {
    animateInitialNavbarEntrance(
      navbar,
      tabsContainer,
      showButton,
      hideButton,
      bodyContent
    );
  } else {
    applyNavbarVisibility(navbar, tabsContainer, showButton, hideButton, bodyContent, navVisible, {
      immediate: true,
    });

    requestAnimationFrame(() => {
      bodyContent?.classList.add('navbar-transitions-ready');
    });
  }

  // Menu-painikkeiden klikkaukset
  showButton.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleNavbarVisibility();
  });

  hideButton.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleNavbarVisibility();
  });

  // Piilota navigaatio, jos klikataan sen ulkopuolelle kapeassa näkymässä
  document.addEventListener('click', (event) => {
    const currentIsWide = window.innerWidth >= NAVBAR_WIDTH_THRESHOLD;
    if (!currentIsWide && navVisible) {
      if (
        !navbar.contains(event.target) &&
        !event.target.closest?.('[data-navbar-menu-button="true"]') &&
        !showButton.contains(event.target)
      ) {
        navVisible = false;
        localStorage.setItem('navVisibleNarrow', navVisible);
        applyNavbarVisibility(navbar, tabsContainer, showButton, hideButton, bodyContent, navVisible);
      }
    }
  });

  // Kuunnellaan ikkunan koon muuttumista (debounced 150ms)
  let _navbarResizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_navbarResizeTimer);
    _navbarResizeTimer = setTimeout(checkWindowWidth, 150);
  });

  // Scroll pass-through: when navbar content fits on screen (no scrollbar),
  // forward wheel events to the main content area.
  setupScrollPassthrough(navbar, {
      getScrollTarget: () =>
          document.querySelector("#tabs_container .scrollable_content:not([style*='display: none'])"),
      isActive: () => !navbar.classList.contains("collapsed"),
  });

  // Add the user-selected non-production environment badge.
  addEnvironmentBadgeIfNeeded();
}

// Funktio, joka tarkistaa ruudun leveyden ja päivittää navigaatiopalkin
function checkWindowWidth() {
  const navbar = document.getElementById('navbar');
  const showButton = document.getElementById('showMenuButton');
  const hideButton = document.getElementById('hideMenuButton');
  const tabsContainer = document.getElementById('tabs_container');
  const bodyContent = document.querySelector('.body_content');

  const isWide = window.innerWidth >= NAVBAR_WIDTH_THRESHOLD;
  const storedNavVisibleWide = localStorage.getItem('navVisibleWide');
  const storedNavVisibleNarrow = localStorage.getItem('navVisibleNarrow');

  if (isWide) {
    navVisible = storedNavVisibleWide !== null ? storedNavVisibleWide === 'true' : true;
  } else {
    navVisible = storedNavVisibleNarrow !== null ? storedNavVisibleNarrow === 'true' : false;
  }

  applyNavbarVisibility(navbar, tabsContainer, showButton, hideButton, bodyContent, navVisible);

}

/**
 * Adds the user-facing DEV/TEST/QA badge selected during First Run.
 * Uses a display-only meta tag; app-env remains the runtime capability boundary.
 */
export function addEnvironmentBadgeIfNeeded(root = document) {
  const environment = document.querySelector('meta[name="installation-environment"]')?.content;
  const labels = { dev: 'DEV', test: 'TEST', qa: 'QA' };
  const label = labels[environment] || '';
  if (!label) {
    return;
  }

  const buttons = root.querySelectorAll(
    '#showMenuButton, #hideMenuButton, [data-navbar-menu-button="true"]'
  );
  buttons.forEach(button => {
    if (button && !button.querySelector('.environment-badge')) {
      const badge = document.createElement('span');
      badge.className = `environment-badge environment-badge--${environment}`;
      badge.textContent = label;
      button.appendChild(badge);
    }
  });
}
