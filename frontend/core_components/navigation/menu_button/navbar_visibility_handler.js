// navbar_visibility_handler.js
// Initialises the navbar show/hide toggle and repositions the floating show-button on resize.
// Bridges NAVBAR_WIDTH_THRESHOLD from ui_config with DOM event listeners and localStorage state.
// Exists to isolate all navbar collapse/expand logic from the main navigation entry point.
import { NAVBAR_WIDTH_THRESHOLD } from "../../../ui_config.js";
import { setupScrollPassthrough } from "../../../reusable_components/scroll_passthrough.js";

export const NAVBAR_VISIBILITY_CHANGED_EVENT = "navbar-visibility-changed";
const NAVBAR_SHOW_BUTTON_REVEAL_DELAY_MS = 0;
const NAVBAR_COLLAPSE_COMPLETE_CLASS = 'navbar-collapse-complete';
let showButtonRevealTimer = 0;
let navbarCollapseCompletionCleanup = null;

// Päivittää piilotetun navigaatiopalkin palauttavan napin paikan niin,
// että se pysyy saman app-kuoren vasemmassa yläkulmassa kuin itse navbar.
export function updateShowMenuButtonPosition() {
  const showButton = document.getElementById('showMenuButton');
  const bodyContent = document.querySelector('.body_content');
  if (!showButton || !bodyContent) return;

  const rootStyle = document.documentElement.style;
  if (showButton.classList.contains('shared-topbar-docked-button')) {
    showButton.style.width = '';
    showButton.style.height = '';
    showButton.style.left = '';
    rootStyle.setProperty('--menu-button-search-offset', '0px');
    return;
  }

  // Reset inline styles to let CSS handle the size (44px)
  showButton.style.width = '';
  showButton.style.height = '';

  if (!navVisible) {
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
  hideButton.setAttribute('aria-hidden', 'true');
  hideButton.tabIndex = -1;
  setShowButtonVisibility(showButton, true, { immediate: true });
  showButton.setAttribute('aria-expanded', 'true');
  bodyContent?.classList.add('navbar-transitions-ready');

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
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
  // The canonical menu button now toggles both directions. Keep the legacy
  // in-navbar control out of the visual and accessibility trees so there is
  // only one real target in every layout.
  hideButton.setAttribute('aria-hidden', 'true');
  hideButton.tabIndex = -1;
  showButton.setAttribute('aria-expanded', isVisible ? 'true' : 'false');
  setShowButtonVisibility(showButton, true, { immediate });

  if (isVisible) {
    clearNavbarCollapseCompletion(navbar);
    navbar.classList.remove('collapsed');
    tabsContainer.classList.remove('navbar_hidden');
  } else {
    navbar.classList.add('collapsed');
    finishNavbarCollapseAfterTransition(navbar, { immediate });
    tabsContainer.classList.add('navbar_hidden');
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
  showButton.addEventListener('click', () => {
    const currentIsWide = window.innerWidth >= NAVBAR_WIDTH_THRESHOLD;
    navVisible = !navVisible;
    if (currentIsWide) {
      localStorage.setItem('navVisibleWide', navVisible);
    } else {
      localStorage.setItem('navVisibleNarrow', navVisible);
    }
    applyNavbarVisibility(navbar, tabsContainer, showButton, hideButton, bodyContent, navVisible);
  });

  hideButton.addEventListener('click', () => {
    if (!navVisible) return;
    const currentIsWide = window.innerWidth >= NAVBAR_WIDTH_THRESHOLD;
    navVisible = false;
    if (currentIsWide) {
      localStorage.setItem('navVisibleWide', navVisible);
    } else {
      localStorage.setItem('navVisibleNarrow', navVisible);
    }
    applyNavbarVisibility(navbar, tabsContainer, showButton, hideButton, bodyContent, navVisible);
  });

  // Piilota navigaatio, jos klikataan sen ulkopuolelle kapeassa näkymässä
  document.addEventListener('click', (event) => {
    const currentIsWide = window.innerWidth >= NAVBAR_WIDTH_THRESHOLD;
    if (!currentIsWide && navVisible) {
      if (
        !navbar.contains(event.target) &&
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
export function addEnvironmentBadgeIfNeeded() {
  const environment = document.querySelector('meta[name="installation-environment"]')?.content;
  const labels = { dev: 'DEV', test: 'TEST', qa: 'QA' };
  const label = labels[environment] || '';
  if (!label) {
    return;
  }

  const showButton = document.getElementById('showMenuButton');
  const hideButton = document.getElementById('hideMenuButton');

  [showButton, hideButton].forEach(button => {
    if (button && !button.querySelector('.environment-badge')) {
      const badge = document.createElement('span');
      badge.className = `environment-badge environment-badge--${environment}`;
      badge.textContent = label;
      button.appendChild(badge);
    }
  });
}
