// navbar_admin_tools_section.js
// Builds the outer disclosure section that contains admin/user tools and the admin tree.
// Bridges post-auth nav-shell setup with the shared animated disclosure component.
// Exists so every admin-only navbar surface below SVG tabs lives in one collapsible group.

import { createAnimatedDisclosureSection } from '../../../reusable_components/animated_disclosure/animated_disclosure_builder.js';

export const NAVBAR_ADMIN_TOOLS_SECTION_ID = 'navbarAdminToolsSection';
export const NAVBAR_ADMIN_TOOLS_CONTENT_ID = 'navbarAdminToolsContent';
export const NAVBAR_ADMIN_TOOLS_STATE_STORAGE_KEY = 'navbar_admin_tools_section_state';

function readNavbarAdminToolsStartOpen() {
    try {
        const storedState = localStorage.getItem(NAVBAR_ADMIN_TOOLS_STATE_STORAGE_KEY);
        return storedState === 'expanded' || storedState === 'true';
    } catch (error) {
        console.warn('Failed to read navbar admin tools disclosure state:', error);
        return false;
    }
}

function attachNavbarAdminToolsStatePersistence(section) {
    section.addEventListener('animated-disclosure-toggle', (event) => {
        if (event?.detail?.section !== section) {
            return;
        }

        try {
            localStorage.setItem(
                NAVBAR_ADMIN_TOOLS_STATE_STORAGE_KEY,
                event.detail.expanded ? 'expanded' : 'collapsed',
            );
        } catch (error) {
            console.warn('Failed to store navbar admin tools disclosure state:', error);
        }
    });
}

// Ensures the shared admin/development navbar group exists around lower navigation tools.
// Operates between the post-auth navbar shell, the SVG tab anchor, and disclosure content.
// Keeps admin-only navbar surfaces grouped without changing the inner tree semantics.
export function ensureNavbarAdminToolsSection(navbar, anchorElement) {
    if (!(navbar instanceof HTMLElement) || !(anchorElement instanceof HTMLElement)) {
        return null;
    }

    let section = document.getElementById(NAVBAR_ADMIN_TOOLS_SECTION_ID);
    let content = document.getElementById(NAVBAR_ADMIN_TOOLS_CONTENT_ID);

    if (!(section instanceof HTMLElement) || !(content instanceof HTMLElement)) {
        content = document.createElement('div');
        content.id = NAVBAR_ADMIN_TOOLS_CONTENT_ID;
        content.classList.add('navbar-admin-tools-content');

        section = createAnimatedDisclosureSection({
            titleLangKey: 'admin_and_development_tools',
            titleText: 'Admin and development tools',
            iconPath: '/frontend/icons/general/table-tools-icon.svg',
            contentElement: content,
            startOpen: readNavbarAdminToolsStartOpen(),
            sectionClassNames: [
                'navbar-disclosure-section',
                'navbar-admin-tools-section',
            ],
            headerClassNames: [
                'navbar-section-heading',
                'collapsible',
            ],
            observeResize: false,
        });
        section.id = NAVBAR_ADMIN_TOOLS_SECTION_ID;
        section.dataset.group = 'admin_and_development_tools';
        attachNavbarAdminToolsStatePersistence(section);

        const header = section.querySelector(':scope > .navbar-section-heading');
        if (header instanceof HTMLElement) {
            header.dataset.group = 'admin_and_development_tools';
            header.dataset.testid = 'nav-group-admin-and-development-tools';
        }
    }

    if (section.parentElement !== navbar) {
        navbar.insertBefore(section, anchorElement.nextSibling);
    } else if (anchorElement.nextSibling !== section) {
        navbar.insertBefore(section, anchorElement.nextSibling);
    }

    return content;
}
