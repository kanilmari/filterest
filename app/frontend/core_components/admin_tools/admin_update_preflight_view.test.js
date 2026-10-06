// @vitest-environment jsdom
// admin_update_preflight_view.test.js
// Verifies always-available, truthful application update details and installation guidance.
// Bridges representative check and checkout metadata with translated disclosure facts.
// Exists to keep target compatibility and operator procedures separate from running readiness.

import { afterEach, describe, expect, test, vi } from "vitest";
import { formatUpdateCheckedAt } from "./admin_version_info_formatter.js";
import { appendAdminUpdatePreview, canShowAdminUpdateDryRun } from "./admin_update_preflight_view.js";

function versionInfo(overrides = {}) {
    return {
        product_name: "Filterest", app_version: "8.37.1", release_channel: "stable",
        artifact_purpose: "public_release", artifact_type: "runtime", release_maturity: "published",
        identity_verification: "local_contract_validated", public_distribution: true,
        latest_stable_version: "8.40.0", update_status: "available", update_available: true,
        update_checked_at: "2026-10-06T10:00:00Z", last_successful_check_at: "2026-10-06T10:00:00Z",
        upstream_check_performed: true, db_version: "9.2.5", required_db_version: "9.2.5",
        db_compatible: true, runtime_mode: "docker", update_procedure: "main_checkout", ...overrides,
    };
}

function render(info, language = "en", onLayoutChange = vi.fn()) {
    const panel = document.createElement("table");
    panel.id = "site-information";
    document.body.appendChild(panel);
    appendAdminUpdatePreview(panel, info, language, onLayoutChange);
    const button = panel.querySelector('[data-testid="filterbar-admin-update-preview-open"]');
    const preview = panel.querySelector('[data-testid="filterbar-admin-update-preview"]');
    button.click();
    return { panel, button, preview };
}

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });

describe("admin update details", () => {
    test.each([
        ["fi", "Sovelluksen päivitys…", "ei tarkistettu", "Tästä näkymästä ei asenneta"],
        ["en", "Application update…", "not checked", "Nothing is installed"],
        ["sv", "Application update…", "not checked", "Nothing is installed"],
    ])("always exposes translated, read-only details in %s", (language, label, unchecked, notice) => {
        const { button, preview } = render(versionInfo(), language);
        expect(button.textContent).toBe(label);
        expect(button.closest("tr").hidden).toBe(false);
        expect(button.getAttribute("aria-expanded")).toBe("true");
        expect(preview.textContent).toContain(notice);
        expect(preview.textContent).toContain("v. 8.37.1");
        expect(preview.textContent).toContain("v. 8.40.0");
        expect(preview.textContent.match(new RegExp(unchecked, "g"))).toHaveLength(2);
        expect(button.classList.contains("filterbar-clock-bar__version-info--update-available"))
            .toBe(true);
        const close = preview.querySelector('[data-testid="filterbar-admin-update-preview-close"]');
        expect(document.activeElement).toBe(close);
        close.click();
        expect(preview.closest("tr").hidden).toBe(true);
        expect(document.activeElement).toBe(button);
        expect(button.getAttribute("aria-expanded")).toBe("false");
    });

    test.each([
        ["fi", "current", "ajan tasalla"], ["en", "current", "up to date"],
        ["fi", "ahead_of_stable", "paikallinen versio uudempi"],
        ["en", "ahead_of_stable", "local version is newer"],
        ["fi", "unavailable", "tarkistus ei saatavilla"],
        ["en", "unavailable", "check unavailable"],
    ])("gives the no-update reason in %s (%s)", (language, status, reason) => {
        const { button, preview } = render(versionInfo({ update_status: status, update_available: false }), language);
        expect(preview.textContent).toContain(reason);
        expect(button.classList.contains("filterbar-clock-bar__version-info--update-available"))
            .toBe(false);
        expect(preview.querySelector("code")).toBeNull();
    });

    test("opens details before information is known", () => {
        const { preview } = render(null);
        expect(preview.textContent).toContain("No successful check");
        expect(preview.querySelector("code")).toBeNull();
    });

    test.each(["native", "docker"])("pins the dry run for %s main installations", (runtime) => {
        const { preview } = render(versionInfo({ runtime_mode: runtime }));
        expect(preview.querySelector("code").textContent)
            .toBe("./filterest update --dry-run --version 8.40.0");
        expect(preview.textContent).toContain("does not test the database, migrations or restoration");
        expect(preview.textContent).not.toContain("The site operator performs updates");
    });

    test.each([
        { update_procedure: "site_operator" }, { update_procedure: undefined },
        { runtime_mode: "unknown" }, { identity_verification: "legacy_unverified" },
        { release_maturity: "candidate" }, { public_distribution: false },
        { latest_stable_version: "8.40.0; command" }, { client_check_failed_at: "2026-10-06T10:01:00Z" },
    ])("uses neutral operator guidance for unsupported or stale metadata %j", (overrides) => {
        const info = versionInfo(overrides);
        expect(canShowAdminUpdateDryRun(info)).toBe(false);
        const { preview } = render(info);
        expect(preview.querySelector("code")).toBeNull();
        expect(preview.textContent).toContain("The site operator performs updates using the site's update procedure.");
        expect(preview.textContent).not.toContain("stops the service");
    });

    test("gives Finnish operator guidance for a detached or managed installation", () => {
        const { preview } = render(versionInfo({ update_procedure: "site_operator" }), "fi");
        expect(preview.textContent).toContain("Sivuston ylläpitäjä tekee päivitykset sivuston päivitysmenettelyllä.");
        expect(preview.querySelector("code")).toBeNull();
    });

    test("keeps the current database mark distinct from unchecked target compatibility", () => {
        const { preview } = render(versionInfo({ db_compatible: false }));
        expect(preview.textContent).toContain("Not compatible with the running application");
        expect(preview.textContent).toContain("New version database compatibilitynot checked");
        expect(preview.textContent).toContain("New version migration compatibilitynot checked");
        expect(preview.textContent).toContain("concerns only the running version");
    });

    test("shares cached age and both failure times with the information box", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-06T10:01:00Z"));
        let result = render(versionInfo({ upstream_check_performed: false }));
        expect(result.preview.textContent).toContain("Cached result — 1 minute ago");
        result = render(versionInfo({ update_status: "unavailable", update_available: false,
            update_checked_at: "2026-10-06T10:01:00Z" }));
        expect(result.preview.textContent).toContain("Check failed; previous result is stale");
        expect(result.preview.textContent).toContain("Last successful check");
        expect(result.preview.textContent).toContain(formatUpdateCheckedAt("2026-10-06T10:00:00Z"));
        expect(result.preview.textContent).toContain(formatUpdateCheckedAt("2026-10-06T10:01:00Z"));
    });
});
