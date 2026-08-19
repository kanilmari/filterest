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
            release_channel: "stable",
            artifact_purpose: "public_release",
            artifact_type: "runtime",
            release_maturity: "published",
            identity_verification: "local_contract_validated",
            public_distribution: true,
            latest_stable_version: "8.28.0",
            update_status: "available",
            update_available: true,
            latest_release_url: "https://github.com/kanilmari/filterest/releases/tag/v8.28.0",
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
        expect(indicator.title).toContain("Julkaisukanava Vakaa");
        expect(indicator.title).toContain("Julkaisun tarkoitus Julkiseksi tarkoitettu");
        expect(indicator.title).toContain("Paketin tyyppi Käyttöversio");
        expect(indicator.title).toContain("Julkaisuvaihe Julkaistu");
        expect(indicator.title).toContain("Tunnisteen varmistus Paikallinen julkaisusopimus varmennettu");
        expect(indicator.title).toContain("Uusin vakaa versio v. 8.28.0 (päivitys saatavilla)");
        expect(indicator.title).toContain("Tietokanta v. 8.0.55 (yhteensopiva)");
        expect(indicator.title).toContain("Vaadittu tietokanta v. 8.0.55");
        expect(indicator.title).toContain("Ajotapa Docker");
        expect(indicator.title).not.toContain(":");
        expect(indicator.getAttribute("aria-expanded")).toBe("false");
        expect(indicator.classList.contains("filterbar-clock-bar__version-info--update-available"))
            .toBe(true);
        expect(indicator.getAttribute("aria-controls")).toBe(panel.id);
        expect(panel.tagName).toBe("TABLE");
        expect(panel.getAttribute("aria-label")).toBe("Sivustotiedot");
        expect(panel.querySelector("caption")).toBeNull();
        expect(panel.querySelector("thead th")?.textContent).toBe("Sivustotiedot");
        expect(panel.querySelector("thead th")?.colSpan).toBe(2);
        expect(panel.querySelectorAll("tbody > tr")).toHaveLength(11);
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
        expect(panel.querySelector('[data-version-info-value="release-channel"]')?.textContent)
            .toBe("Vakaa");
        expect(panel.querySelector('[data-version-info-value="artifact-purpose"]')?.textContent)
            .toBe("Julkiseksi tarkoitettu");
        expect(panel.querySelector('[data-version-info-value="artifact-type"]')?.textContent)
            .toBe("Käyttöversio");
        expect(panel.querySelector('[data-version-info-value="release-maturity"]')?.textContent)
            .toBe("Julkaistu");
        expect(panel.querySelector('[data-version-info-value="identity-verification"]')?.textContent)
            .toBe("Paikallinen julkaisusopimus varmennettu");
        expect(panel.querySelector('[data-version-info-value="latest-stable"]')?.textContent)
            .toBe("v. 8.28.0 (päivitys saatavilla)");
        const releaseLink = panel.querySelector('[data-version-info-value="latest-stable"] a');
        expect(releaseLink?.getAttribute("href"))
            .toBe("https://github.com/kanilmari/filterest/releases/tag/v8.28.0");
        expect(releaseLink?.getAttribute("target")).toBe("_blank");
        expect(releaseLink?.getAttribute("rel")).toBe("noopener noreferrer");
        expect(panel.querySelector('[data-version-info-key="runtime"]')?.textContent)
            .toBe("Ajotapa");
        expect(panel.querySelector('[data-version-info-value="runtime"]')?.textContent)
            .toBe("Docker");
        expect(panel.hidden).toBe(true);

        indicator.click();
        expect(indicator.getAttribute("aria-expanded")).toBe("true");
        expect(panel.hidden).toBe(false);
        expect(indicator.hasAttribute("title")).toBe(false);
        panel.click();
        expect(panel.hidden).toBe(false);

        indicator.click();
        expect(indicator.getAttribute("aria-expanded")).toBe("false");
        expect(panel.hidden).toBe(true);
        expect(indicator.title).toContain("Filterest v. 8.27.99");

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
            release_channel: "development",
            artifact_purpose: "developer_backup",
            artifact_type: "backup",
            release_maturity: "snapshot",
            identity_verification: "legacy_unverified",
            latest_stable_version: "8.27.98",
            update_status: "ahead_of_stable",
            update_available: false,
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
        expect(panel.querySelector('[data-version-info-value="release-channel"]')?.textContent)
            .toBe("Development");
        expect(panel.querySelector('[data-version-info-value="artifact-purpose"]')?.textContent)
            .toBe("Developer backup");
        expect(panel.querySelector('[data-version-info-value="artifact-type"]')?.textContent)
            .toBe("Backup");
        expect(panel.querySelector('[data-version-info-value="release-maturity"]')?.textContent)
            .toBe("Development snapshot");
        expect(panel.querySelector('[data-version-info-value="identity-verification"]')?.textContent)
            .toBe("Legacy marker, unverified");
        expect(panel.querySelector('[data-version-info-value="latest-stable"]')?.textContent)
            .toBe("v. 8.27.98 (local version is newer)");
        expect(panel.querySelector('[data-version-info-key="required-database"]')?.textContent)
            .toBe("Required database");
        expect(panel.querySelector('[data-version-info-key="runtime"]')?.textContent).toBe("Runtime");
        expect(indicator.hasAttribute("title")).toBe(false);
        expect(indicator.dataset.closedTooltip).toContain("Database v. 8.0.55 (compatible)");
        expect(indicator.dataset.closedTooltip).toContain("Runtime Native");

        document.documentElement.setAttribute("lang", "zh-CN");
        await vi.waitFor(() => {
            expect(panel.querySelector("thead th")?.textContent).toBe("站点信息");
        });
        expect(panel.querySelector('[data-version-info-key="site"]')?.textContent).toBe("网站");
        expect(panel.querySelector('[data-version-info-key="runtime"]')?.textContent).toBe("运行方式");

        indicator.click();
        expect(indicator.title).toContain("运行方式 本机");

        shell.destroy();
    });

    test("portals the open panel above toolbar stacking contexts and keeps it anchored", async () => {
        hasRoutePermissionMock.mockReturnValue(true);
        fetchAdminVersionInfoMock.mockResolvedValue({
            product_name: "Filterest",
            app_version: "8.34.1",
            db_version: "9.2.0",
            required_db_version: "9.2.0",
            db_compatible: true,
            runtime_mode: "native",
        });
        const { buildAdminVersionInfoIndicator } = await import(
            "./admin_version_info_indicator.js"
        );
        const shell = buildAdminVersionInfoIndicator();
        document.body.appendChild(shell);
        await vi.waitFor(() => expect(shell.hidden).toBe(false));

        const indicator = shell.querySelector('[data-testid="filterbar-admin-version-info"]');
        const panel = shell.querySelector('[data-testid="filterbar-admin-version-info-panel"]');
        let anchorRect = {
            left: 700,
            right: 718,
            top: 600,
            bottom: 618,
            width: 18,
            height: 18,
        };
        indicator.getBoundingClientRect = vi.fn(() => anchorRect);
        panel.getBoundingClientRect = vi.fn(() => ({
            left: 0,
            right: 320,
            top: 0,
            bottom: 220,
            width: 320,
            height: 220,
        }));

        indicator.click();
        expect(panel.parentElement).toBe(document.body);
        expect(panel.classList.contains("filterbar-clock-bar__version-info-panel--portaled"))
            .toBe(true);
        expect(panel.style.left).toBe("398px");
        expect(panel.style.top).toBe("372px");
        expect(panel.dataset.versionInfoPlacement).toBe("top");

        anchorRect = { ...anchorRect, top: 20, bottom: 38 };
        window.dispatchEvent(new Event("resize"));
        expect(panel.style.top).toBe("46px");
        expect(panel.dataset.versionInfoPlacement).toBe("bottom");

        anchorRect = { ...anchorRect, left: 500, right: 518 };
        document.dispatchEvent(new Event("scroll"));
        expect(panel.style.left).toBe("198px");

        panel.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(panel.hidden).toBe(false);
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        expect(panel.hidden).toBe(true);
        expect(panel.parentElement).toBe(shell);
        expect(panel.classList.contains("filterbar-clock-bar__version-info-panel--portaled"))
            .toBe(false);
        expect(panel.style.left).toBe("");
        expect(panel.style.top).toBe("");
        expect(indicator.getAttribute("aria-expanded")).toBe("false");
        expect(document.activeElement).toBe(indicator);

        indicator.click();
        expect(panel.parentElement).toBe(document.body);
        shell.destroy();
        expect(panel.hidden).toBe(true);
        expect(panel.parentElement).toBe(shell);
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
        [
            "fi",
            { release_channel: "development", artifact_purpose: "developer_backup" },
            "Julkaisukanava Kehitys",
            "Julkaisun tarkoitus Kehittäjän varmuuskopio",
        ],
        [
            "en",
            { release_channel: "stable", artifact_purpose: "public_release" },
            "Release channel Stable",
            "Release purpose Intended for public release",
        ],
        [
            "zh-CN",
            { release_channel: "development", artifact_purpose: "developer_backup" },
            "发布渠道 开发版",
            "发布用途 开发者备份",
        ],
        [
            "zh-TW",
            { release_channel: "stable", artifact_purpose: "public_release" },
            "發布管道 穩定版本",
            "發布用途 預定公開發布",
        ],
        [
            "zh-HK",
            { release_channel: "stable", artifact_purpose: "public_release" },
            "發佈渠道 穩定版本",
            "發佈用途 擬作公開發佈",
        ],
    ])("localizes release identity for %s", async (language, versionInfo, channel, purpose) => {
        const { formatAdminVersionInfoLabel } = await import("./admin_version_info_indicator.js");

        const label = formatAdminVersionInfoLabel(versionInfo, language);

        expect(label).toContain(channel);
        expect(label).toContain(purpose);
    });

    test.each([
        ["fi", "Sivustotiedot"],
        ["en", "Site information"],
        ["ch", "站点信息"],
        ["zh", "站点信息"],
        ["zh-CN", "站点信息"],
        ["zh-TW", "網站資訊"],
        ["yue", "網站資訊"],
        ["zh-HK", "網站資訊"],
        ["unsupported", "Site information"],
    ])("localizes the site information title for %s", async (language, expected) => {
        const { getAdminSiteInfoTitle } = await import("./admin_version_info_indicator.js");

        expect(getAdminSiteInfoTitle(language)).toBe(expected);
    });
});
