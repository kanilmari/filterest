// @vitest-environment jsdom
// navbar_visibility_handler.test.js
// Verifies navbar visibility events and floating menu-button positioning in jsdom.
// Bridges navbar show/hide interactions, shared topbar listeners, and content-rect-based offsets.
// Exists to prevent regressions where menu-button state or placement drifts after layout changes.

import { beforeEach, describe, expect, test, vi } from "vitest";

const setupScrollPassthroughMock = vi.fn();

async function loadModule() {
    vi.resetModules();
    vi.doMock("../../../reusable_components/scroll_passthrough.js", () => ({
        setupScrollPassthrough: setupScrollPassthroughMock,
    }));

    return import("./navbar_visibility_handler.js");
}

describe("navbar_visibility_handler", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        document.body.innerHTML = `
            <div class="body_wrapper">
                <div class="body_content" style="max-width: 2560px;">
                    <button id="showMenuButton">☰</button>
                    <div id="navbar">
                        <div class="top-button-bar">
                            <button id="hideMenuButton">☰</button>
                            <div class="nav-history-buttons">
                                <button id="navBackBtn" disabled>Back</button>
                                <button id="navForwardBtn" disabled>Forward</button>
                            </div>
                        </div>
                    </div>
                    <div id="tabs_container"></div>
                </div>
            </div>
        `;

        Object.defineProperty(window, "innerWidth", {
            configurable: true,
            writable: true,
            value: 2000,
        });
    });

    test("dispatches navbar visibility change events from each persistent navbar button", async () => {
        localStorage.setItem("navVisibleWide", "true");
        const { initNavbar, NAVBAR_VISIBILITY_CHANGED_EVENT } = await loadModule();
        const events = [];
        window.addEventListener(NAVBAR_VISIBILITY_CHANGED_EVENT, (event) => {
            events.push(event.detail?.isVisible);
        });

        initNavbar();
        document.getElementById("hideMenuButton").click();
        document.getElementById("showMenuButton").click();

        expect(events.slice(-2)).toEqual([false, true]);
        expect(document.getElementById("hideMenuButton").getAttribute("aria-hidden")).toBe("false");
        expect(document.getElementById("hideMenuButton").tabIndex).toBe(0);
    });

    test("keeps only the menu button for the current navbar context reachable", async () => {
        localStorage.setItem("navVisibleWide", "true");
        const { initNavbar } = await loadModule();
        const navbar = document.getElementById("navbar");
        const showButton = document.getElementById("showMenuButton");
        const hideButton = document.getElementById("hideMenuButton");

        initNavbar();

        expect(showButton.classList.contains("menu-toggle-visible")).toBe(false);
        expect(showButton.getAttribute("aria-hidden")).toBe("true");
        expect(showButton.getAttribute("aria-expanded")).toBe("true");
        expect(showButton.tabIndex).toBe(-1);
        expect(hideButton.getAttribute("aria-hidden")).toBe("false");
        expect(hideButton.tabIndex).toBe(0);

        hideButton.click();

        expect(navbar.classList.contains("collapsed")).toBe(true);
        expect(showButton.getAttribute("aria-expanded")).toBe("false");
        expect(showButton.tabIndex).toBe(0);
        expect(hideButton.getAttribute("aria-hidden")).toBe("true");
        expect(hideButton.tabIndex).toBe(-1);

        showButton.click();

        expect(navbar.classList.contains("collapsed")).toBe(false);
        expect(showButton.getAttribute("aria-expanded")).toBe("true");
        expect(showButton.tabIndex).toBe(-1);
        expect(hideButton.getAttribute("aria-hidden")).toBe("false");
        expect(hideButton.tabIndex).toBe(0);
    });

    test("suppresses the floating fallback while a persistent topbar button owns the context", async () => {
        localStorage.setItem("navVisibleWide", "false");
        const {
            initNavbar,
            syncNavbarMenuButtonAccessibility,
        } = await loadModule();
        const showButton = document.getElementById("showMenuButton");

        initNavbar();
        expect(showButton.getAttribute("aria-hidden")).toBe("false");
        expect(showButton.tabIndex).toBe(0);
        expect(document.documentElement.style.getPropertyValue("--menu-button-search-offset"))
            .toBe("68px");

        showButton.classList.add("shared-topbar-menu-source-hidden");
        syncNavbarMenuButtonAccessibility();

        expect(showButton.getAttribute("aria-hidden")).toBe("true");
        expect(showButton.tabIndex).toBe(-1);
        expect(showButton.classList.contains("menu-toggle-visible")).toBe(false);
        expect(document.documentElement.style.getPropertyValue("--menu-button-search-offset"))
            .toBe("0px");
    });

    test("leaves the floating menu button's fixed inset to CSS", async () => {
        const { updateShowMenuButtonPosition } = await loadModule();
        const bodyContent = document.querySelector(".body_content");
        const showButton = document.getElementById("showMenuButton");

        bodyContent.getBoundingClientRect = vi.fn(() => ({
            left: 120,
            width: 1800,
            top: 0,
            right: 1920,
            bottom: 0,
            height: 0,
        }));
        showButton.getBoundingClientRect = vi.fn(() => ({
            width: 44,
            top: 0,
            left: 0,
            right: 44,
            bottom: 44,
            height: 44,
        }));

        updateShowMenuButtonPosition();

        expect(showButton.style.left).toBe("");
        expect(document.documentElement.style.getPropertyValue("--menu-button-search-offset")).toBe("0px");
    });

    test("keeps collapsed navbar marked incomplete until the slide-out transition finishes", async () => {
        Object.defineProperty(window, "innerWidth", {
            configurable: true,
            writable: true,
            value: 1400,
        });
        localStorage.setItem("navVisibleNarrow", "true");

        const { initNavbar } = await loadModule();
        const navbar = document.getElementById("navbar");

        initNavbar();
        document.body.click();

        expect(navbar.classList.contains("collapsed")).toBe(true);
        expect(navbar.classList.contains("navbar-collapse-complete")).toBe(false);

        const transitionEndEvent = new Event("transitionend", { bubbles: true });
        Object.defineProperty(transitionEndEvent, "propertyName", { value: "transform" });
        navbar.dispatchEvent(transitionEndEvent);

        expect(navbar.classList.contains("navbar-collapse-complete")).toBe(true);
    });

    test("keeps the opening cursor lock transient without enabling disabled controls", async () => {
        localStorage.setItem("navVisibleWide", "true");
        const { initNavbar } = await loadModule();
        const navbar = document.getElementById("navbar");
        const showButton = document.getElementById("showMenuButton");
        const hideButton = document.getElementById("hideMenuButton");
        const backButton = document.getElementById("navBackBtn");
        const forwardButton = document.getElementById("navForwardBtn");

        initNavbar();
        hideButton.click();
        expect(navbar.classList.contains("navbar-opening")).toBe(false);

        showButton.click();
        expect(navbar.classList.contains("navbar-opening")).toBe(true);
        expect(backButton.disabled).toBe(true);
        expect(forwardButton.disabled).toBe(true);

        const unrelatedTransition = new Event("transitionend", { bubbles: true });
        Object.defineProperty(unrelatedTransition, "propertyName", { value: "opacity" });
        navbar.dispatchEvent(unrelatedTransition);
        expect(navbar.classList.contains("navbar-opening")).toBe(true);

        const transformTransition = new Event("transitionend", { bubbles: true });
        Object.defineProperty(transformTransition, "propertyName", { value: "transform" });
        navbar.dispatchEvent(transformTransition);
        expect(navbar.classList.contains("navbar-opening")).toBe(false);
        expect(backButton.disabled).toBe(true);
        expect(forwardButton.disabled).toBe(true);

        hideButton.click();
        showButton.click();
        expect(navbar.classList.contains("navbar-opening")).toBe(true);
        hideButton.click();
        expect(navbar.classList.contains("navbar-opening")).toBe(false);
    });

    test.each([
        ["dev", "DEV", "environment-badge--dev"],
        ["test", "TEST", "environment-badge--test"],
        ["qa", "QA", "environment-badge--qa"],
    ])("adds the selected %s environment badge once", async (environment, label, modifier) => {
        document.head.innerHTML = `<meta name="installation-environment" content="${environment}">`;
        const { addEnvironmentBadgeIfNeeded } = await loadModule();
        addEnvironmentBadgeIfNeeded();
        addEnvironmentBadgeIfNeeded();
        const topbarButtonHost = document.createElement("div");
        topbarButtonHost.innerHTML = '<button data-navbar-menu-button="true">☰</button>';
        document.body.appendChild(topbarButtonHost);
        addEnvironmentBadgeIfNeeded(topbarButtonHost);
        const badges = document.querySelectorAll(".environment-badge");
        expect(badges).toHaveLength(3);
        expect(badges[0].textContent).toBe(label);
        expect(badges[0].classList.contains(modifier)).toBe(true);
    });

    test("does not add an environment badge in production", async () => {
        document.head.innerHTML = '<meta name="installation-environment" content="prod">';
        const { addEnvironmentBadgeIfNeeded } = await loadModule();
        addEnvironmentBadgeIfNeeded();
        expect(document.querySelector(".environment-badge")).toBeNull();
    });
});
