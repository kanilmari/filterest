// @vitest-environment jsdom
// admin_version_info_indicator.check_state.test.js
// Verifies release-check freshness, retry cooldown and disclosure continuity.
// Bridges administrator endpoint successes/failures with the two information-box actions.
// Exists so retained release evidence cannot appear fresh after an unsuccessful check.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const endpoint = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn() }));
vi.mock("../route_permission_checker.js", () => ({ hasRoutePermission: () => true }));
vi.mock("../endpoints/stable_endpoint_router.js", () => ({
    fetchAdminVersionInfo: endpoint.fetch, checkAdminVersionInfoAgain: endpoint.refresh,
}));
vi.mock("../state_stores/lang_preference_reader.js", () => ({
    getLanguageWithBrowserFallback: () => "en",
}));
import { buildAdminVersionInfoIndicator } from "./admin_version_info_indicator.js";
import { formatUpdateCheckedAt } from "./admin_version_info_formatter.js";

const checkedAt = "2026-10-06T10:00:00Z";
function snapshot(overrides = {}) {
    return {
        product_name: "Filterest", app_version: "9.3.21", latest_stable_version: "9.3.22",
        update_status: "available", update_available: true, update_checked_at: checkedAt,
        last_successful_check_at: checkedAt, upstream_check_performed: true,
        refresh_allowed_at: "2026-10-06T10:00:30Z", ...overrides,
    };
}
let shell;
function open() {
    shell = buildAdminVersionInfoIndicator();
    document.body.appendChild(shell);
    const indicator = shell.querySelector('[data-testid="filterbar-admin-version-info"]');
    indicator.click();
    const panel = document.querySelector('[data-testid="filterbar-admin-version-info-panel"]');
    const refresh = () => panel.querySelector('[data-testid="filterbar-admin-version-check-again"]');
    const update = () => panel.querySelector('[data-testid="filterbar-admin-update-preview-open"]');
    const fact = (name) => panel.querySelector(`[data-version-info-value="${name}"]`)?.textContent;
    return { indicator, panel, refresh, update, fact };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(checkedAt));
    document.documentElement.lang = "en";
    endpoint.fetch.mockReset(); endpoint.refresh.mockReset();
    document.body.replaceChildren();
});
afterEach(() => { shell?.destroy(); document.body.replaceChildren(); vi.useRealTimers(); });

describe("information box check evidence", () => {
    test.each([
        ["fi", "Tietojen päivitys", "Sovelluksen päivitys…"],
        ["en", "Refresh information", "Application update…"],
    ])("keeps both actions during loading, unknown and failure in %s", async (language, first, second) => {
        document.documentElement.lang = language;
        endpoint.fetch.mockRejectedValue(new Error("offline"));
        const { panel, refresh, update, indicator } = open();
        expect(refresh().textContent).toBe(first);
        expect(update().textContent).toBe(second);
        await vi.advanceTimersByTimeAsync(0);
        expect(refresh().disabled).toBe(false);
        expect(update().textContent).toBe(second);
        expect([...panel.querySelectorAll("button")].filter((button) => !button.closest("tr").hidden))
            .toHaveLength(2);
        expect(indicator.classList.contains("filterbar-clock-bar__version-info--update-available"))
            .toBe(false);
        update().click();
        expect(panel.querySelector('[data-testid="filterbar-admin-update-preview"]').closest("tr").hidden)
            .toBe(false);
    });

    test.each(["fi", "en"])("honours cooldown and exposes its exact reopen time in %s", async (language) => {
        document.documentElement.lang = language;
        endpoint.fetch.mockResolvedValue(snapshot());
        endpoint.refresh.mockResolvedValue(snapshot({ upstream_check_performed: false }));
        const { panel, refresh, update, fact } = open();
        await vi.advanceTimersByTimeAsync(0);
        expect(refresh().disabled).toBe(true);
        expect(refresh().title).toContain(formatUpdateCheckedAt("2026-10-06T10:00:30Z", language));
        expect(panel.querySelector(`#${refresh().getAttribute("aria-describedby")}`)?.textContent)
            .toBe(refresh().title);
        expect(fact("check-state")).toBe(language === "fi" ? "Tuore tarkistus onnistui" : "Fresh check succeeded");
        expect(update().classList.contains("filterbar-clock-bar__version-info--update-available"))
            .toBe(true);
        refresh().click();
        expect(endpoint.refresh).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(29_999);
        expect(refresh().disabled).toBe(true);
        await vi.advanceTimersByTimeAsync(1);
        expect(refresh().disabled).toBe(false);
        refresh().focus(); refresh().click();
        await vi.advanceTimersByTimeAsync(0);
        expect(endpoint.refresh).toHaveBeenCalledWith({ suppressAuthRedirect: true });
        expect(fact("check-state")).toContain(language === "fi" ? "Välimuistin tulos" : "Cached result");
        expect(fact("check-state")).toContain("30");
        expect(document.activeElement).toBe(refresh());
    });

    test.each(["fi", "en"])("keeps API failure evidence stale, with both times, in %s", async (language) => {
        document.documentElement.lang = language;
        endpoint.fetch.mockResolvedValue(snapshot());
        endpoint.refresh.mockRejectedValue(new Error("API error"));
        const { panel, refresh, update, indicator, fact } = open();
        await vi.advanceTimersByTimeAsync(0);
        update().click();
        const closeId = 'filterbar-admin-update-preview-close';
        expect(document.activeElement.dataset.testid).toBe(closeId);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(document.activeElement.dataset.testid).toBe(closeId);
        refresh().click();
        await vi.advanceTimersByTimeAsync(0);
        expect(fact("latest-stable")).toContain("9.3.22");
        expect(fact("latest-stable")).toContain(language === "fi" ? "vanhentunut" : "stale");
        expect(fact("check-state")).toContain(language === "fi" ? "epäonnistui" : "failed");
        expect(fact("check-state")).not.toContain(language === "fi" ? "Tuore" : "Fresh");
        expect(fact("last-success")).toBe(formatUpdateCheckedAt(checkedAt, language));
        expect(fact("last-checked")).toBe(formatUpdateCheckedAt("2026-10-06T10:00:30Z", language));
        expect(indicator.classList.contains("filterbar-clock-bar__version-info--update-available"))
            .toBe(false);
        expect(update().classList.contains("filterbar-clock-bar__version-info--update-available"))
            .toBe(false);
        expect(update().getAttribute("aria-expanded")).toBe("true");
        const details = panel.querySelector('[data-testid="filterbar-admin-update-preview"]');
        expect(details.closest("tr").hidden).toBe(false);
        expect(details.textContent).toContain(fact("last-success"));
        expect(details.textContent).toContain(fact("last-checked"));
        expect(details.querySelector("code")).toBeNull();
        indicator.click();
        expect(indicator.title).toContain(language === "fi" ? "vanhentunut" : "stale");
    });

    test("retains last success for an unavailable server response and recovers on fresh success", async () => {
        endpoint.fetch.mockResolvedValue(snapshot({ refresh_allowed_at: "" }));
        endpoint.refresh.mockResolvedValueOnce(snapshot({ update_status: "unavailable", update_available: false,
            latest_stable_version: undefined, last_successful_check_at: undefined,
            update_checked_at: "2026-10-06T10:01:00Z", refresh_allowed_at: "" }))
            .mockResolvedValueOnce(snapshot({ update_status: "current", update_available: false,
                app_version: "9.3.22", last_successful_check_at: "2026-10-06T10:02:00Z",
                update_checked_at: "2026-10-06T10:02:00Z", refresh_allowed_at: "" }));
        const { refresh, fact } = open();
        await vi.advanceTimersByTimeAsync(0);
        refresh().click(); await vi.advanceTimersByTimeAsync(0);
        expect(fact("latest-stable")).toContain("9.3.22");
        expect(fact("check-state")).toContain("stale");
        expect(fact("last-success")).toBe(formatUpdateCheckedAt(checkedAt));
        refresh().click(); await vi.advanceTimersByTimeAsync(0);
        expect(fact("check-state")).toBe("Fresh check succeeded");
        expect(fact("check-result")).toContain("up to date");
        expect(fact("last-success")).toBe(formatUpdateCheckedAt("2026-10-06T10:02:00Z"));
    });

    test("keeps server-retained history if a later response loses its process cache", async () => {
        endpoint.fetch.mockResolvedValue(snapshot({ update_status: "unavailable", update_available: false,
            update_checked_at: "2026-10-06T10:01:00Z", refresh_allowed_at: "" }));
        endpoint.refresh.mockResolvedValue({ update_status: "unavailable", update_available: false,
            update_checked_at: "2026-10-06T10:02:00Z" });
        const { refresh, fact } = open(); await vi.advanceTimersByTimeAsync(0);
        refresh().click(); await vi.advanceTimersByTimeAsync(0);
        expect(fact("latest-stable")).toContain("9.3.22");
        expect(fact("last-success")).toBe(formatUpdateCheckedAt(checkedAt));
        expect(fact("check-state")).toContain("stale");
    });

    test("preserves detail focus and open state when the page language changes", async () => {
        endpoint.fetch.mockResolvedValue(snapshot());
        const { panel, update } = open(); await vi.advanceTimersByTimeAsync(0);
        update().click(); document.documentElement.lang = "fi";
        await vi.advanceTimersByTimeAsync(0);
        expect(update().textContent).toBe("Sovelluksen päivitys…");
        expect(update().getAttribute("aria-expanded")).toBe("true");
        expect(document.activeElement.dataset.testid).toBe("filterbar-admin-update-preview-close");
        panel.querySelector('[data-testid="filterbar-admin-update-preview-close"]').click();
        expect(document.activeElement).toBe(update());
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(document.activeElement.dataset.testid).toBe("filterbar-admin-version-info");
    });


    test("labels a reused failed upstream check as cached, with the last release still stale", async () => {
        vi.setSystemTime(new Date("2026-10-06T10:01:30Z"));
        endpoint.fetch.mockResolvedValue(snapshot({ update_status: "unavailable", update_available: false,
            upstream_check_performed: false, update_checked_at: "2026-10-06T10:01:00Z" }));
        const { fact } = open(); await vi.advanceTimersByTimeAsync(0);
        expect(fact("check-state")).toContain("Cached result — 30 seconds ago");
        expect(fact("check-state")).toContain("previous result is stale");
        expect(fact("last-success")).toBe(formatUpdateCheckedAt(checkedAt));
        expect(fact("last-checked")).toBe(formatUpdateCheckedAt("2026-10-06T10:01:00Z"));
    });

    test("keeps release-link focus through a language redraw", async () => {
        endpoint.fetch.mockResolvedValue(snapshot({ latest_release_url:
            "https://github.com/kanilmari/filterest/releases/tag/v9.3.22" }));
        const { panel } = open(); await vi.advanceTimersByTimeAsync(0);
        panel.querySelector("a").focus(); document.documentElement.lang = "fi";
        await vi.advanceTimersByTimeAsync(0);
        expect(document.activeElement).toBe(panel.querySelector("a"));
    });

    test("does not steal focus when an in-flight refresh completes", async () => {
        endpoint.fetch.mockResolvedValue(snapshot({ refresh_allowed_at: "" }));
        let resolveRefresh;
        endpoint.refresh.mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve; }));
        const { refresh } = open(); await vi.advanceTimersByTimeAsync(0);
        refresh().focus(); refresh().click();
        const outside = document.createElement("button"); document.body.appendChild(outside); outside.focus();
        resolveRefresh(snapshot()); await vi.advanceTimersByTimeAsync(0);
        expect(document.activeElement).toBe(outside);
    });

    test("cancels cooldown and polling timers when removed", async () => {
        endpoint.fetch.mockResolvedValue(snapshot());
        open(); await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(2);
        shell.remove(); await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(0);
    });
});
