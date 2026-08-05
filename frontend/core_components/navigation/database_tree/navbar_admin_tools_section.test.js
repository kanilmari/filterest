// navbar_admin_tools_section.test.js
// Verifies the outer admin/development sidebar disclosure is configured for nested content.
// Bridges the nav shell wrapper and the shared disclosure builder option contract.
// Exists so inner tree/disclosure height changes are not delayed by the outer wrapper.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const { createAnimatedDisclosureSectionMock } = vi.hoisted(() => ({
    createAnimatedDisclosureSectionMock: vi.fn(),
}));

vi.mock("../../../reusable_components/animated_disclosure/animated_disclosure_builder.js", () => ({
    createAnimatedDisclosureSection: createAnimatedDisclosureSectionMock,
}));

describe("ensureNavbarAdminToolsSection", () => {
    beforeEach(() => {
        localStorage.clear();
        createAnimatedDisclosureSectionMock.mockReset();
        createAnimatedDisclosureSectionMock.mockImplementation((options) => {
            const section = document.createElement("section");
            section.classList.add(...options.sectionClassNames);
            const header = document.createElement("button");
            header.classList.add(...options.headerClassNames);
            section.append(header, options.contentElement);
            return section;
        });
        document.body.innerHTML = `
            <nav id="navbar">
                <div id="tabsAnchor"></div>
            </nav>
        `;
    });

    test("disables outer resize observation so nested nav sections resize immediately", async () => {
        const { ensureNavbarAdminToolsSection } = await import("./navbar_admin_tools_section.js");
        const navbar = document.getElementById("navbar");
        const anchor = document.getElementById("tabsAnchor");

        const content = ensureNavbarAdminToolsSection(navbar, anchor);

        expect(content?.id).toBe("navbarAdminToolsContent");
        expect(createAnimatedDisclosureSectionMock).toHaveBeenCalledWith(
            expect.objectContaining({
                observeResize: false,
            })
        );
    });

    test("starts the admin tools section closed when no browser preference is stored", async () => {
        const { ensureNavbarAdminToolsSection } = await import("./navbar_admin_tools_section.js");
        const navbar = document.getElementById("navbar");
        const anchor = document.getElementById("tabsAnchor");

        ensureNavbarAdminToolsSection(navbar, anchor);

        expect(createAnimatedDisclosureSectionMock).toHaveBeenCalledWith(
            expect.objectContaining({
                startOpen: false,
            })
        );
    });

    test("restores the stored open state from localStorage", async () => {
        const {
            NAVBAR_ADMIN_TOOLS_STATE_STORAGE_KEY,
            ensureNavbarAdminToolsSection,
        } = await import("./navbar_admin_tools_section.js");
        localStorage.setItem(NAVBAR_ADMIN_TOOLS_STATE_STORAGE_KEY, "expanded");
        const navbar = document.getElementById("navbar");
        const anchor = document.getElementById("tabsAnchor");

        ensureNavbarAdminToolsSection(navbar, anchor);

        expect(createAnimatedDisclosureSectionMock).toHaveBeenCalledWith(
            expect.objectContaining({
                startOpen: true,
            })
        );
    });

    test("remembers direct admin tools disclosure toggles", async () => {
        const {
            NAVBAR_ADMIN_TOOLS_STATE_STORAGE_KEY,
            ensureNavbarAdminToolsSection,
        } = await import("./navbar_admin_tools_section.js");
        const navbar = document.getElementById("navbar");
        const anchor = document.getElementById("tabsAnchor");

        ensureNavbarAdminToolsSection(navbar, anchor);
        const section = document.getElementById("navbarAdminToolsSection");
        section.dispatchEvent(new CustomEvent("animated-disclosure-toggle", {
            bubbles: true,
            detail: {
                expanded: true,
                section,
            },
        }));

        expect(localStorage.getItem(NAVBAR_ADMIN_TOOLS_STATE_STORAGE_KEY)).toBe("expanded");
    });

    test("ignores nested disclosure toggle events when remembering outer state", async () => {
        const {
            NAVBAR_ADMIN_TOOLS_STATE_STORAGE_KEY,
            ensureNavbarAdminToolsSection,
        } = await import("./navbar_admin_tools_section.js");
        const navbar = document.getElementById("navbar");
        const anchor = document.getElementById("tabsAnchor");

        ensureNavbarAdminToolsSection(navbar, anchor);
        const section = document.getElementById("navbarAdminToolsSection");
        const nestedSection = document.createElement("section");
        section.appendChild(nestedSection);
        nestedSection.dispatchEvent(new CustomEvent("animated-disclosure-toggle", {
            bubbles: true,
            detail: {
                expanded: true,
                section: nestedSection,
            },
        }));

        expect(localStorage.getItem(NAVBAR_ADMIN_TOOLS_STATE_STORAGE_KEY)).toBeNull();
    });
});
