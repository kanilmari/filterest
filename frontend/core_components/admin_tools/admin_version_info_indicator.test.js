// @vitest-environment jsdom
// admin_version_info_indicator.test.js
// Verifies route-gated rendering and localized version labels in the filterbar footer.
// Bridges mocked admin permissions and the protected version endpoint with the DOM indicator.
// Exists to prevent version details from leaking into non-admin browser shells.

import { beforeEach, describe, expect, test, vi } from "vitest";

const hasRoutePermissionMock = vi.fn();
const fetchAdminVersionInfoMock = vi.fn();
const getLanguageWithBrowserFallbackMock = vi.fn();

vi.mock("../route_permission_checker.js", () => ({
    hasRoutePermission: hasRoutePermissionMock,
}));

vi.mock("../endpoints/stable_endpoint_router.js", () => ({
    fetchAdminVersionInfo: fetchAdminVersionInfoMock,
}));

vi.mock("../state_stores/lang_preference_reader.js", () => ({
    getLanguageWithBrowserFallback: getLanguageWithBrowserFallbackMock,
}));

describe("admin version info indicator", () => {
    beforeEach(() => {
        hasRoutePermissionMock.mockReset();
        fetchAdminVersionInfoMock.mockReset();
        getLanguageWithBrowserFallbackMock.mockReset();
        getLanguageWithBrowserFallbackMock.mockReturnValue("fi");
        document.body.innerHTML = "";
        document.head.innerHTML = '<meta property="og:site_name" content="filt">';
        document.documentElement.removeAttribute("lang");
    });

    test("does not render without the protected route permission", async () => {
        hasRoutePermissionMock.mockReturnValue(false);
        const { buildAdminVersionInfoIndicator } = await import("./admin_version_info_indicator.js");

        expect(buildAdminVersionInfoIndicator()).toBeNull();
        expect(fetchAdminVersionInfoMock).not.toHaveBeenCalled();
    });

    test("hydrates a shared info icon and toggles the version panel by click", async () => {
        hasRoutePermissionMock.mockReturnValue(true);
        fetchAdminVersionInfoMock.mockResolvedValue({
            product_name: "Filterest",
            app_version: "8.27.99",
            db_version: "8.0.55",
            required_db_version: "8.0.55",
            db_compatible: true,
            runtime_mode: "docker",
        });
        const { buildAdminVersionInfoIndicator } = await import("./admin_version_info_indicator.js");

        const shell = buildAdminVersionInfoIndicator();
        document.body.appendChild(shell);

        await vi.waitFor(() => expect(shell.hidden).toBe(false));
        const indicator = shell.querySelector('[data-testid="filterbar-admin-version-info"]');
        const panel = shell.querySelector('[data-testid="filterbar-admin-version-info-panel"]');

        expect(fetchAdminVersionInfoMock).toHaveBeenCalledWith({ suppressAuthRedirect: true });
        expect(indicator.tagName).toBe("BUTTON");
        expect(indicator.querySelector("svg")).toBeTruthy();
        expect(indicator.title).toContain("Filterest v. 8.27.99");
        expect(indicator.title).toContain("Tietokanta v. 8.0.55 (yhteensopiva)");
        expect(indicator.title).toContain("Vaadittu tietokanta v. 8.0.55");
        expect(indicator.title).toContain("Ajotapa Docker");
        expect(indicator.title).not.toContain(":");
        expect(indicator.getAttribute("aria-expanded")).toBe("false");
        expect(indicator.getAttribute("aria-controls")).toBe(panel.id);
        expect(panel.tagName).toBe("TABLE");
        expect(panel.getAttribute("aria-label")).toBe("Sivustotiedot");
        expect(panel.querySelector("caption")).toBeNull();
        expect(panel.querySelector("thead th")?.textContent).toBe("Sivustotiedot");
        expect(panel.querySelector("thead th")?.colSpan).toBe(2);
        expect(panel.querySelectorAll("tbody > tr")).toHaveLength(5);
        expect(panel.querySelector('[data-version-info-key="site"]')?.textContent)
            .toBe("Sivusto");
        expect(panel.querySelector('[data-version-info-value="site"]')?.textContent)
            .toBe("Filt");
        expect(panel.querySelector('[data-version-info-key="application"]')?.tagName)
            .toBe("TH");
        expect(panel.querySelector('[data-version-info-value="application"]')?.tagName)
            .toBe("TD");
        expect(panel.querySelector('[data-version-info-key="application"]')?.textContent)
            .toBe("Filterest");
        expect(panel.querySelector('[data-version-info-value="application"]')?.textContent)
            .toBe("v. 8.27.99");
        expect(panel.querySelector('[data-version-info-key="runtime"]')?.textContent)
            .toBe("Ajotapa");
        expect(panel.querySelector('[data-version-info-value="runtime"]')?.textContent)
            .toBe("Docker");
        expect(panel.hidden).toBe(true);

        indicator.click();
        expect(indicator.getAttribute("aria-expanded")).toBe("true");
        expect(panel.hidden).toBe(false);
        panel.click();
        expect(panel.hidden).toBe(false);

        indicator.click();
        expect(indicator.getAttribute("aria-expanded")).toBe("false");
        expect(panel.hidden).toBe(true);

        const outsideButton = document.createElement("button");
        outsideButton.addEventListener("click", (event) => event.stopPropagation());
        document.body.appendChild(outsideButton);
        indicator.click();
        outsideButton.click();
        expect(indicator.getAttribute("aria-expanded")).toBe("false");
        expect(panel.hidden).toBe(true);

        shell.destroy();
    });

    test("updates the open panel immediately when the active page language changes", async () => {
        hasRoutePermissionMock.mockReturnValue(true);
        fetchAdminVersionInfoMock.mockResolvedValue({
            product_name: "Filterest",
            app_version: "8.27.99",
            db_version: "8.0.55",
            required_db_version: "8.0.55",
            db_compatible: true,
            runtime_mode: "native",
        });
        const { buildAdminVersionInfoIndicator } = await import("./admin_version_info_indicator.js");

        const shell = buildAdminVersionInfoIndicator();
        document.body.appendChild(shell);
        await vi.waitFor(() => expect(shell.hidden).toBe(false));

        const indicator = shell.querySelector('[data-testid="filterbar-admin-version-info"]');
        const panel = shell.querySelector('[data-testid="filterbar-admin-version-info-panel"]');
        indicator.click();
        expect(panel.querySelector("thead th")?.textContent).toBe("Sivustotiedot");

        document.documentElement.setAttribute("lang", "en");
        await vi.waitFor(() => {
            expect(panel.querySelector("thead th")?.textContent).toBe("Site information");
        });
        expect(panel.hidden).toBe(false);
        expect(panel.getAttribute("aria-label")).toBe("Site information");
        expect(panel.querySelector('[data-version-info-key="site"]')?.textContent).toBe("Site");
        expect(panel.querySelector('[data-version-info-key="database"]')?.textContent).toBe("Database");
        expect(panel.querySelector('[data-version-info-key="required-database"]')?.textContent)
            .toBe("Required database");
        expect(panel.querySelector('[data-version-info-key="runtime"]')?.textContent).toBe("Runtime");
        expect(indicator.title).toContain("Database v. 8.0.55 (compatible)");
        expect(indicator.title).toContain("Runtime Native");

        document.documentElement.setAttribute("lang", "zh-CN");
        await vi.waitFor(() => {
            expect(panel.querySelector("thead th")?.textContent).toBe("站点信息");
        });
        expect(panel.querySelector('[data-version-info-key="site"]')?.textContent).toBe("网站");
        expect(panel.querySelector('[data-version-info-key="runtime"]')?.textContent).toBe("运行方式");

        shell.destroy();
    });

    test.each([
        ["fi", "Ajotapa Tavallinen"],
        ["en", "Runtime Native"],
        ["ch", "运行方式 本机"],
        ["yue", "執行方式 原生"],
    ])("localizes the native runtime label for %s", async (language, expected) => {
        const { formatAdminVersionInfoLabel } = await import("./admin_version_info_indicator.js");

        const label = formatAdminVersionInfoLabel({ runtime_mode: "native" }, language);

        expect(label).toContain(expected);
        expect(label).not.toContain(":");
    });

    test.each([
        ["fi", "Sivustotiedot"],
        ["en", "Site information"],
        ["ch", "站点信息"],
        ["zh", "站点信息"],
        ["zh-CN", "站点信息"],
        ["yue", "網站資訊"],
        ["zh-HK", "網站資訊"],
        ["unsupported", "Site information"],
    ])("localizes the site information title for %s", async (language, expected) => {
        const { getAdminSiteInfoTitle } = await import("./admin_version_info_indicator.js");

        expect(getAdminSiteInfoTitle(language)).toBe(expected);
    });
});
