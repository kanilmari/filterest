// @vitest-environment jsdom
// admin_version_info_indicator.check_state.test.js
// Verifies unique release facts, retained evidence, cooldown and focus continuity.
// Bridges mocked release checks and translations with the single site-information table.
// Keeps failed evidence stale without offering an application-update action.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const endpoint = vi.hoisted(() => ({ fetch: vi.fn(), refresh: vi.fn(), translate: vi.fn() }));
vi.mock("../route_permission_checker.js", () => ({ hasRoutePermission: () => true }));
vi.mock("../endpoints/stable_endpoint_router.js", () => ({
    fetchAdminVersionInfo: endpoint.fetch, checkAdminVersionInfoAgain: endpoint.refresh,
}));
vi.mock("../state_stores/lang_preference_reader.js", () => ({
    getLanguageWithBrowserFallback: () => "en",
}));
vi.mock("../lang/translation_handler.js", () => ({ getTranslationForKey: endpoint.translate }));
import { buildAdminVersionInfoIndicator } from "./admin_version_info_indicator.js";
import { buildAdminUpdateCheckRows, formatUpdateCheckedAt } from "./admin_version_info_formatter.js";
import { refreshLocalizedDatasetValues } from "../table_views/dataset_value_localizer.js";

const checkedAt = "2026-10-06T10:00:00Z";
function snapshot(overrides = {}) {
    return {
        product_name: "Filterest", app_version: "9.3.21", latest_stable_version: "9.3.22",
        latest_release_url: "https://github.com/kanilmari/filterest/releases/tag/v9.3.22",
        db_version: "9.10.2", required_db_version: "9.10.2", db_compatible: true,
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
    const fact = (name) => panel.querySelector(`[data-version-info-value="${name}"]`)?.textContent;
    return { indicator, panel, refresh, fact };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(checkedAt));
    document.documentElement.lang = "en";
    endpoint.fetch.mockReset(); endpoint.refresh.mockReset(); endpoint.translate.mockReset();
    endpoint.translate.mockImplementation((_key, { fallback = "" } = {}) => fallback);
    document.body.replaceChildren();
});
afterEach(() => { shell?.destroy(); document.body.replaceChildren(); vi.useRealTimers(); });

describe("information box check evidence", () => {
    test.each([
        ["fi", "Tarkista julkaisut", "Päivitykset tekee toistaiseksi sivuston ylläpitäjä palvelimella."],
        ["en", "Check releases", "Updates are currently performed by the site operator."],
    ])("keeps one action and operator sentence during loading and failure in %s", async (language, action, guidance) => {
        document.documentElement.lang = language;
        endpoint.fetch.mockRejectedValue(new Error("offline"));
        const { panel, refresh, indicator } = open();
        expect(refresh().textContent).toBe(action);
        expect(refresh().disabled).toBe(true);
        expect(panel.querySelectorAll("button")).toHaveLength(1);
        expect(panel.textContent).toContain(guidance);
        await vi.advanceTimersByTimeAsync(0);
        expect(refresh().disabled).toBe(false);
        expect(panel.querySelectorAll("button")).toHaveLength(1);
        expect(panel.querySelector("tfoot, section, code")).toBeNull();
        expect(panel.querySelector('[data-testid="filterbar-admin-update-preview-open"]')).toBeNull();
        expect(panel.textContent.match(new RegExp(guidance, "g"))).toHaveLength(1);
        expect(indicator.classList.contains("filterbar-clock-bar__version-info--update-available")).toBe(false);
    });

    test.each(["fi", "en"])("honours cooldown and exposes its exact reopen time in %s", async (language) => {
        document.documentElement.lang = language;
        endpoint.fetch.mockResolvedValue(snapshot());
        endpoint.refresh.mockResolvedValue(snapshot({ upstream_check_performed: false }));
        const { panel, refresh, fact } = open();
        await vi.advanceTimersByTimeAsync(0);
        expect(refresh().disabled).toBe(true);
        expect(refresh().title).toContain(formatUpdateCheckedAt("2026-10-06T10:00:30Z", language));
        expect(panel.querySelector(`#${refresh().getAttribute("aria-describedby")}`)?.textContent)
            .toBe(refresh().title);
        expect(fact("check-state")).toBe(language === "fi" ? "Tuore tarkistus onnistui" : "Fresh check succeeded");
        expect(fact("checked-successfully")).toBe(formatUpdateCheckedAt(checkedAt, language));
        expect(fact("last-checked")).toBeUndefined(); expect(fact("last-success")).toBeUndefined();
        refresh().click(); expect(endpoint.refresh).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(29_999); expect(refresh().disabled).toBe(true);
        await vi.advanceTimersByTimeAsync(1); expect(refresh().disabled).toBe(false);
        refresh().focus(); refresh().click();
        await vi.advanceTimersByTimeAsync(0);
        expect(endpoint.refresh).toHaveBeenCalledWith({ suppressAuthRedirect: true });
        expect(fact("check-state")).toContain(language === "fi" ? "Välimuistin tulos" : "Cached result");
        expect(fact("check-state")).toContain("30");
        expect(document.activeElement).toBe(refresh());
    });

    test.each(["fi", "en"])("shows every fact once, and availability only in its result, in %s", async (language) => {
        document.documentElement.lang = language;
        endpoint.fetch.mockResolvedValue(snapshot());
        const { panel, fact } = open(); await vi.advanceTimersByTimeAsync(0);
        const ids = [...panel.querySelectorAll('[data-version-info-value]')].map((cell) => cell.dataset.versionInfoValue);
        expect(new Set(ids).size).toBe(ids.length);
        expect(fact("latest-stable")).toBe("v. 9.3.22");
        expect(panel.textContent.match(/9\.3\.22/g)).toHaveLength(1);
        expect(panel.textContent.match(/päivitys saatavilla|update available/g)).toHaveLength(1);
        expect(fact("check-result")).toBe(language === "fi" ? "päivitys saatavilla" : "update available");
        expect(panel.querySelector('[data-version-info-key="required-database"]').textContent)
            .toBe(language === "fi" ? "Käynnissä olevan sovelluksen vaatima" : "Required by the running application");
        expect(panel.querySelectorAll("button")).toHaveLength(1);
        expect(panel.querySelectorAll("a")).toHaveLength(1);
    });

    test.each([
        ["available", "update available"], ["current", "up to date"],
        ["ahead_of_stable", "local version is newer"], ["unavailable", "check unavailable"],
        [undefined, "check unavailable"],
    ])("keeps the result in one row and one action for %s", async (status, result) => {
        const unknown = status === undefined;
        endpoint.fetch.mockResolvedValue(snapshot({ update_status: status,
            latest_stable_version: unknown ? "" : "9.3.22",
            last_successful_check_at: unknown ? "" : checkedAt,
            update_checked_at: unknown ? "" : checkedAt }));
        const { panel, fact } = open(); await vi.advanceTimersByTimeAsync(0);
        expect(fact("check-result")).toBe(result);
        expect(fact("latest-stable")).toBe(unknown ? "Unknown" : "v. 9.3.22");
        expect([...panel.querySelectorAll('[data-version-info-value]')]
            .filter((cell) => cell.textContent.includes(result))).toHaveLength(1);
        expect(panel.querySelectorAll("button")).toHaveLength(1);
    });

    test.each(["fi", "en"])("keeps API failure evidence stale only in freshness, with both times, in %s", async (language) => {
        document.documentElement.lang = language;
        endpoint.fetch.mockResolvedValue(snapshot()); endpoint.refresh.mockRejectedValue(new Error("API error"));
        const { panel, refresh, indicator, fact } = open(); await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(30_000);
        refresh().focus(); refresh().click(); await vi.advanceTimersByTimeAsync(0);
        expect(fact("latest-stable")).toBe("v. 9.3.22");
        expect(panel.querySelector("a").href).toBe(snapshot().latest_release_url);
        expect(fact("check-state")).toContain(language === "fi" ? "vanhentunut" : "stale");
        expect(panel.textContent.match(/vanhentunut|stale/g)).toHaveLength(1);
        expect(fact("check-state")).not.toContain(language === "fi" ? "Tuore" : "Fresh");
        expect(fact("last-success")).toBe(formatUpdateCheckedAt(checkedAt, language));
        expect(fact("last-checked")).toBe(formatUpdateCheckedAt("2026-10-06T10:00:30Z", language));
        expect(fact("checked-successfully")).toBeUndefined();
        expect(indicator.classList.contains("filterbar-clock-bar__version-info--update-available")).toBe(false);
        expect(document.activeElement).toBe(refresh());
        indicator.click(); expect(indicator.title).toContain(language === "fi" ? "vanhentunut" : "stale");
    });

    test("retains last success for an unavailable server response and recovers on fresh success", async () => {
        endpoint.fetch.mockResolvedValue(snapshot({ refresh_allowed_at: "" }));
        endpoint.refresh.mockResolvedValueOnce(snapshot({ update_status: "unavailable", update_available: false,
            latest_stable_version: undefined, latest_release_url: undefined, last_successful_check_at: undefined,
            update_checked_at: "2026-10-06T10:01:00Z", refresh_allowed_at: "" }))
            .mockResolvedValueOnce(snapshot({ update_status: "current", update_available: false,
                app_version: "9.3.22", last_successful_check_at: "2026-10-06T10:02:00Z",
                update_checked_at: "2026-10-06T10:02:00Z", refresh_allowed_at: "" }));
        const { panel, refresh, fact } = open(); await vi.advanceTimersByTimeAsync(0);
        refresh().click(); await vi.advanceTimersByTimeAsync(0);
        expect(fact("latest-stable")).toBe("v. 9.3.22");
        expect(panel.querySelector("a").href).toBe(snapshot().latest_release_url);
        expect(fact("check-state")).toContain("stale");
        expect(fact("last-success")).toBe(formatUpdateCheckedAt(checkedAt));
        refresh().click(); await vi.advanceTimersByTimeAsync(0);
        expect(fact("check-state")).toBe("Fresh check succeeded");
        expect(fact("check-result")).toBe("up to date");
        expect(fact("checked-successfully")).toBe(formatUpdateCheckedAt("2026-10-06T10:02:00Z"));
        expect(fact("last-success")).toBeUndefined();
    });

    test("keeps server-retained history if a later response loses its process cache", async () => {
        endpoint.fetch.mockResolvedValue(snapshot({ update_status: "unavailable", update_available: false,
            update_checked_at: "2026-10-06T10:01:00Z", refresh_allowed_at: "" }));
        endpoint.refresh.mockResolvedValue({ update_status: "unavailable", update_available: false,
            update_checked_at: "2026-10-06T10:02:00Z" });
        const { refresh, fact } = open(); await vi.advanceTimersByTimeAsync(0);
        refresh().click(); await vi.advanceTimersByTimeAsync(0);
        expect(fact("latest-stable")).toBe("v. 9.3.22");
        expect(fact("last-success")).toBe(formatUpdateCheckedAt(checkedAt));
        expect(fact("check-state")).toContain("stale");
    });

    test("preserves the action's focus and open panel when the page language changes", async () => {
        endpoint.fetch.mockResolvedValue(snapshot({ refresh_allowed_at: "" }));
        const { panel, refresh } = open(); await vi.advanceTimersByTimeAsync(0);
        refresh().focus(); document.documentElement.lang = "fi"; await vi.advanceTimersByTimeAsync(0);
        expect(refresh().textContent).toBe("Tarkista julkaisut");
        expect(document.activeElement).toBe(refresh()); expect(panel.hidden).toBe(false);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(document.activeElement.dataset.testid).toBe("filterbar-admin-version-info");
    });

    test("reads reviewed catalog copy again after the shared language refresh", async () => {
        endpoint.fetch.mockResolvedValue(snapshot({ refresh_allowed_at: "" }));
        const { panel, refresh } = open(); await vi.advanceTimersByTimeAsync(0); refresh().focus();
        endpoint.translate.mockImplementation((key, { fallback = "" } = {}) =>
            key === "admin_version_info_check_releases" ? "Oma julkaisujen tarkistus" : fallback);
        await refreshLocalizedDatasetValues("fi");
        expect(refresh().textContent).toBe("Oma julkaisujen tarkistus");
        expect(endpoint.translate).toHaveBeenCalledWith("admin_version_info_required_by_running_app",
            { fallback: "Käynnissä olevan sovelluksen vaatima" });
        expect(panel.querySelector('[data-version-info-key="required-database"]').textContent)
            .toBe("Käynnissä olevan sovelluksen vaatima");
        expect(document.activeElement).toBe(refresh());
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
        endpoint.fetch.mockResolvedValue(snapshot());
        const { panel } = open(); await vi.advanceTimersByTimeAsync(0);
        panel.querySelector("a").focus(); document.documentElement.lang = "fi";
        await vi.advanceTimersByTimeAsync(0); expect(document.activeElement).toBe(panel.querySelector("a"));
    });

    test("keeps focus in the panel during checking and restores the action after cooldown", async () => {
        endpoint.fetch.mockResolvedValue(snapshot({ refresh_allowed_at: "" }));
        let resolveRefresh;
        endpoint.refresh.mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve; }));
        const { panel, refresh } = open(); await vi.advanceTimersByTimeAsync(0);
        refresh().focus(); refresh().click(); expect(document.activeElement).toBe(panel);
        refresh().click(); expect(endpoint.refresh).toHaveBeenCalledTimes(1);
        resolveRefresh(snapshot()); await vi.advanceTimersByTimeAsync(0);
        expect(document.activeElement).toBe(panel); expect(refresh().disabled).toBe(true);
        await vi.advanceTimersByTimeAsync(30_000); expect(document.activeElement).toBe(refresh());
    });

    test.each(["outside", "release-link"])("does not steal %s focus when an in-flight refresh completes", async (target) => {
        endpoint.fetch.mockResolvedValue(snapshot({ refresh_allowed_at: "" }));
        let resolveRefresh;
        endpoint.refresh.mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve; }));
        const { panel, refresh } = open(); await vi.advanceTimersByTimeAsync(0);
        refresh().focus(); refresh().click();
        const chosen = target === "release-link" ? panel.querySelector("a") : document.createElement("button");
        if (target === "outside") document.body.appendChild(chosen);
        chosen.focus(); resolveRefresh(snapshot()); await vi.advanceTimersByTimeAsync(0);
        expect(document.activeElement).toBe(target === "release-link" ? panel.querySelector("a") : chosen);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(document.activeElement).toBe(target === "release-link" ? panel.querySelector("a") : chosen);
    });

    test("cancels cooldown and polling timers when removed", async () => {
        endpoint.fetch.mockResolvedValue(snapshot()); open(); await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(2); shell.remove(); await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    test("combines equal instants, but keeps separate instants even if formatted times match", () => {
        let rows = buildAdminUpdateCheckRows(snapshot({ last_successful_check_at: "2026-10-06T13:00:00+03:00" }));
        expect(rows.map((row) => row.id)).toEqual(["check-result", "check-state", "checked-successfully"]);
        rows = buildAdminUpdateCheckRows(snapshot({ last_successful_check_at: "2026-10-06T10:00:00.001Z" }));
        expect(rows.map((row) => row.id)).toEqual(["check-result", "check-state", "last-checked", "last-success"]);
    });
});
