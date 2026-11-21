// filters_opener_and_closer.test.js
// Verifies the Filters shortcut owns panel visibility only for its reversible temporary state.
// Bridges duplicated shortcut buttons with disclosure public APIs and panel show/hide callbacks.
// Exists so manual UI choices win without persisting shortcut-created visibility.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";
import {
    createTemporaryFiltersOpenerAndCloser,
    createTemporaryFiltersToggleButton,
} from "./filters_opener_and_closer.js";

function buildFixture({ panelHidden = true } = {}) {
    const eventHost = document.createElement("div");
    const firstButton = createTemporaryFiltersToggleButton("tasks", "hero");
    const secondButton = createTemporaryFiltersToggleButton("tasks", "topbar");
    const panel = document.createElement("aside");
    const filtersSection = document.createElement("section");
    const header = document.createElement("button");
    header.classList.add("animated-disclosure-header");
    filtersSection.classList.add("is-collapsed");
    filtersSection.appendChild(header);
    panel.appendChild(filtersSection);
    eventHost.append(firstButton, secondButton, panel);
    document.body.appendChild(eventHost);

    filtersSection.expand = vi.fn(async () => {
        filtersSection.classList.remove("is-collapsed");
        filtersSection.classList.add("is-expanded");
        filtersSection.dispatchEvent(
            new CustomEvent("animated-disclosure-toggle", { bubbles: true })
        );
    });
    filtersSection.collapse = vi.fn(async () => {
        filtersSection.classList.remove("is-expanded");
        filtersSection.classList.add("is-collapsed");
        filtersSection.dispatchEvent(
            new CustomEvent("animated-disclosure-toggle", { bubbles: true })
        );
    });

    let hidden = panelHidden;
    const showPanel = vi.fn(() => {
        hidden = false;
    });
    const hidePanel = vi.fn(() => {
        hidden = true;
    });
    const controller = createTemporaryFiltersOpenerAndCloser({
        tableName: "tasks",
        eventHost,
        panel,
        filtersSection,
        isPanelHidden: () => hidden,
        showPanel,
        hidePanel,
    });

    return {
        controller,
        firstButton,
        secondButton,
        filtersSection,
        header,
        panel,
        showPanel,
        hidePanel,
    };
}

describe("createTemporaryFiltersOpenerAndCloser", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        window.requestAnimationFrame = (callback) => {
            callback();
            return 1;
        };
    });

    test("opens a hidden panel and restores that hidden state on second activation", async () => {
        const fixture = buildFixture({ panelHidden: true });

        fixture.firstButton.click();
        await fixture.controller.whenIdle();

        expect(fixture.showPanel).toHaveBeenCalledTimes(1);
        expect(fixture.filtersSection.expand).toHaveBeenCalledWith({ animate: true });
        expect(fixture.controller.isActive()).toBe(true);
        expect(fixture.secondButton.getAttribute("aria-expanded")).toBe("true");
        expect(fixture.secondButton.getAttribute("aria-pressed")).toBe("true");

        fixture.secondButton.click();
        await fixture.controller.whenIdle();

        expect(fixture.filtersSection.collapse).toHaveBeenCalledWith({ animate: true });
        expect(fixture.hidePanel).toHaveBeenCalledTimes(1);
        expect(fixture.controller.isActive()).toBe(false);
        expect(fixture.firstButton.getAttribute("aria-pressed")).toBe("false");
    });

    test("does not hide a panel that was visible before the temporary state", async () => {
        const fixture = buildFixture({ panelHidden: false });

        fixture.firstButton.click();
        await fixture.controller.whenIdle();
        fixture.firstButton.click();
        await fixture.controller.whenIdle();

        expect(fixture.showPanel).not.toHaveBeenCalled();
        expect(fixture.hidePanel).not.toHaveBeenCalled();
    });

    test("manual disclosure interaction releases ownership without undoing the user state", async () => {
        const fixture = buildFixture({ panelHidden: true });

        fixture.firstButton.click();
        await fixture.controller.whenIdle();
        fixture.header.click();

        expect(fixture.controller.isActive()).toBe(false);
        expect(fixture.hidePanel).not.toHaveBeenCalled();
        expect(fixture.panel.classList.contains("filterbar-panel--temporary-filters-open"))
            .toBe(false);
    });

    test("manual panel ownership cancels an opening request that is still awaiting layout", async () => {
        let releaseLayout;
        const sectionLayoutReady = new Promise((resolve) => {
            releaseLayout = resolve;
        });
        const fixture = buildFixture({ panelHidden: true });
        fixture.controller.destroy();
        const controller = createTemporaryFiltersOpenerAndCloser({
            tableName: "tasks",
            eventHost: fixture.panel.parentElement,
            panel: fixture.panel,
            filtersSection: fixture.filtersSection,
            sectionLayoutReady,
            isPanelHidden: () => true,
            showPanel: fixture.showPanel,
            hidePanel: fixture.hidePanel,
        });

        fixture.firstButton.click();
        controller.releaseTemporaryOwnership();
        releaseLayout();
        await controller.whenIdle();

        expect(fixture.showPanel).not.toHaveBeenCalled();
        expect(fixture.filtersSection.expand).not.toHaveBeenCalled();
        expect(controller.isActive()).toBe(false);
    });

    describe("ensureOpenForArrival (Home's Filter results)", () => {
        test("opens a hidden panel and its collapsed filters, reversible like the shortcut", async () => {
            const fixture = buildFixture({ panelHidden: true });

            await expect(fixture.controller.ensureOpenForArrival()).resolves.toBe("delivered");

            expect(fixture.showPanel).toHaveBeenCalledTimes(1);
            expect(fixture.filtersSection.expand).toHaveBeenCalledWith({ animate: true });
            expect(fixture.controller.isActive()).toBe(true);
            expect(fixture.filtersSection.dataset.filterbarTemporaryDisclosureOwner).toBe("true");
            expect(document.activeElement).toBe(fixture.header);

            // The shortcut then closes the reveal and restores the hidden panel.
            fixture.firstButton.click();
            await fixture.controller.whenIdle();
            expect(fixture.hidePanel).toHaveBeenCalledTimes(1);
            expect(fixture.filtersSection.dataset.filterbarTemporaryDisclosureOwner).toBeUndefined();
        });

        test("never closes: a second arrival keeps everything open", async () => {
            const fixture = buildFixture({ panelHidden: true });
            await fixture.controller.ensureOpenForArrival();
            await fixture.controller.ensureOpenForArrival();

            expect(fixture.filtersSection.collapse).not.toHaveBeenCalled();
            expect(fixture.hidePanel).not.toHaveBeenCalled();
            expect(fixture.filtersSection.classList.contains("is-expanded")).toBe(true);
        });

        test("reopens what an earlier visit's ownership no longer shows", async () => {
            let hidden = true;
            const fixture = buildFixture({ panelHidden: true });
            fixture.controller.destroy();
            const showPanel = vi.fn(() => { hidden = false; });
            const controller = createTemporaryFiltersOpenerAndCloser({
                tableName: "tasks", eventHost: fixture.panel.parentElement, panel: fixture.panel,
                filtersSection: fixture.filtersSection, isPanelHidden: () => hidden,
                showPanel, hidePanel: vi.fn(() => { hidden = true; }),
            });
            await controller.ensureOpenForArrival();
            // Remembered state hid the reused panel on a later visit while the reveal still owned it.
            hidden = true;
            await controller.ensureOpenForArrival();

            expect(showPanel).toHaveBeenCalledTimes(2);
            expect(controller.isActive()).toBe(true);
        });

        test("an already open panel and section are left as the person's own state", async () => {
            const fixture = buildFixture({ panelHidden: false });
            fixture.filtersSection.classList.replace("is-collapsed", "is-expanded");

            await expect(fixture.controller.ensureOpenForArrival()).resolves.toBe("delivered");

            expect(fixture.controller.isActive()).toBe(false);
            expect(fixture.filtersSection.expand).not.toHaveBeenCalled();
            expect(fixture.filtersSection.dataset.filterbarTemporaryDisclosureOwner).toBeUndefined();
        });

        test("waits for readiness, then opens only while the arrival is still current", async () => {
            let ready;
            const fixture = buildFixture({ panelHidden: true });
            let current = true;
            const result = fixture.controller.ensureOpenForArrival({
                whenReady: () => new Promise((resolve) => { ready = resolve; }),
                isCurrent: () => current,
            });
            await vi.waitFor(() => expect(ready).toBeTypeOf("function"));
            expect(fixture.showPanel).not.toHaveBeenCalled();
            current = false;
            ready();

            await expect(result).resolves.toBe("stale");
            expect(fixture.showPanel).not.toHaveBeenCalled();
            expect(fixture.filtersSection.expand).not.toHaveBeenCalled();
        });

        test("a person's own panel action while it waits wins", async () => {
            let ready;
            const fixture = buildFixture({ panelHidden: true });
            const result = fixture.controller.ensureOpenForArrival({
                whenReady: () => new Promise((resolve) => { ready = resolve; }),
            });
            await vi.waitFor(() => expect(ready).toBeTypeOf("function"));
            fixture.controller.releaseTemporaryOwnership();
            ready();

            await expect(result).resolves.toBe("stale");
            expect(fixture.showPanel).not.toHaveBeenCalled();
        });

        test("an explicit close while the arrival waits behind a toggle animation wins", async () => {
            const fixture = buildFixture({ panelHidden: true });
            let finishExpand;
            fixture.filtersSection.expand.mockImplementationOnce(() => new Promise((resolve) => {
                finishExpand = () => {
                    fixture.filtersSection.classList.replace("is-collapsed", "is-expanded");
                    resolve();
                };
            }));
            fixture.firstButton.click();
            await vi.waitFor(() => expect(finishExpand).toBeTypeOf("function"));
            const result = fixture.controller.ensureOpenForArrival();
            // The person hides the panel before the shortcut's animation ends.
            fixture.controller.releaseTemporaryOwnership();
            fixture.showPanel.mockClear();
            finishExpand();

            await expect(result).resolves.toBe("stale");
            expect(fixture.showPanel).not.toHaveBeenCalled();
        });

        test("a torn-down coordinator reports the arrival as replaced", async () => {
            let ready;
            const fixture = buildFixture({ panelHidden: true });
            const result = fixture.controller.ensureOpenForArrival({
                whenReady: () => new Promise((resolve) => { ready = resolve; }),
            });
            await vi.waitFor(() => expect(ready).toBeTypeOf("function"));
            fixture.controller.destroy();
            ready();

            await expect(result).resolves.toBe("replaced");
            expect(fixture.showPanel).not.toHaveBeenCalled();
        });
    });
});
