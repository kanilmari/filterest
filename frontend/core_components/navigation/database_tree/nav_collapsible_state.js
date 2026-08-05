// nav_collapsible_state.js
// Synchronizes sidebar group button state with its matching content panel state.
// Bridges nav group aria/class markers and the panel's inline open/closed styles.
// Exists to keep sidebar chevrons and content visibility aligned across clicks and auto-open flows.

const EXPANDED_GROUP_PADDING_BOTTOM_PX = '5px';
const COLLAPSED_GROUP_PADDING_BOTTOM_PX = '0px';

function getAnimatedDisclosureSection(toggleButton, contentPanel) {
    const section = toggleButton?.closest?.('.animated-disclosure-section')
        || contentPanel?.closest?.('.animated-disclosure-section');
    if (section instanceof HTMLElement
        && typeof section.expand === 'function'
        && typeof section.collapse === 'function') {
        return section;
    }
    return null;
}

/**
 * Returns whether the sidebar group is currently expanded.
 *
 * @param {HTMLElement | null | undefined} toggleButton
 * @param {HTMLElement | null | undefined} contentPanel
 * @returns {boolean}
 */
export function isSidebarGroupExpanded(toggleButton, contentPanel) {
    const disclosureSection = getAnimatedDisclosureSection(toggleButton, contentPanel);
    if (disclosureSection) {
        return disclosureSection.dataset.disclosureState === 'expanded';
    }

    const isContentPanelExpanded = Boolean(contentPanel?.style.maxHeight);

    if (toggleButton instanceof HTMLElement) {
        const ariaExpanded = toggleButton.getAttribute('aria-expanded');
        if (ariaExpanded === 'true') {
            return true;
        }
        if (ariaExpanded === 'false' && !isContentPanelExpanded) {
            return false;
        }
    }

    return isContentPanelExpanded;
}

/**
 * Applies one expanded/collapsed state to both the group button and content panel.
 *
 * @param {HTMLElement | null | undefined} toggleButton
 * @param {HTMLElement | null | undefined} contentPanel
 * @param {boolean} isExpanded
 */
export function setSidebarGroupExpandedState(toggleButton, contentPanel, isExpanded) {
    const disclosureSection = getAnimatedDisclosureSection(toggleButton, contentPanel);
    if (disclosureSection) {
        const header = disclosureSection.querySelector(':scope > .animated-disclosure-header');
        if (header instanceof HTMLElement) {
            header.classList.toggle('opened', isExpanded);
        }
        const operation = isExpanded
            ? disclosureSection.expand({ animate: false })
            : disclosureSection.collapse({ animate: false });
        void operation;
        return;
    }

    if (toggleButton instanceof HTMLElement) {
        toggleButton.classList.toggle('opened', isExpanded);
        toggleButton.setAttribute('aria-expanded', String(isExpanded));
    }

    if (contentPanel instanceof HTMLElement) {
        contentPanel.style.maxHeight = isExpanded ? 'unset' : '';
        contentPanel.style.paddingBottom = isExpanded
            ? EXPANDED_GROUP_PADDING_BOTTOM_PX
            : COLLAPSED_GROUP_PADDING_BOTTOM_PX;
    }
}
