// @vitest-environment jsdom
// admin_update_preflight_view.test.js
// Verifies the release-identity gate and non-mutating update-preview disclosure.
// Bridges representative administrator version payloads with the rendered preview facts.
// Exists to prevent development or unverified builds from presenting an installation path.

import { describe, expect, test, vi } from "vitest";
import {
    appendAdminUpdatePreview,
    canShowAdminUpdatePreview,
} from "./admin_update_preflight_view.js";

function eligibleVersionInfo(overrides = {}) {
    return {
        product_name: "Filterest",
        app_version: "8.37.1",
        release_channel: "stable",
        artifact_purpose: "public_release",
        artifact_type: "runtime",
        release_maturity: "published",
        identity_verification: "local_contract_validated",
        public_distribution: true,
        latest_stable_version: "8.40.0",
        latest_release_url: "https://github.com/kanilmari/filterest/releases/tag/v8.40.0",
        update_available: true,
        db_version: "9.2.5",
        required_db_version: "9.2.5",
        db_compatible: true,
        runtime_mode: "docker",
        ...overrides,
    };
}

describe("admin update preflight view", () => {
    test("requires an available update on a verified published Filterest runtime", () => {
        expect(canShowAdminUpdatePreview(eligibleVersionInfo())).toBe(true);
        expect(canShowAdminUpdatePreview(eligibleVersionInfo({ update_available: false })))
            .toBe(false);
        expect(canShowAdminUpdatePreview(eligibleVersionInfo({ release_channel: "development" })))
            .toBe(false);
        expect(canShowAdminUpdatePreview(eligibleVersionInfo({ public_distribution: false })))
            .toBe(false);
        expect(canShowAdminUpdatePreview(eligibleVersionInfo({ latest_release_url: "" })))
            .toBe(false);
        expect(canShowAdminUpdatePreview(eligibleVersionInfo({ release_maturity: "candidate" })))
            .toBe(false);
        expect(canShowAdminUpdatePreview(eligibleVersionInfo({
            identity_verification: "legacy_unverified",
        }))).toBe(false);
        expect(canShowAdminUpdatePreview(eligibleVersionInfo({ runtime_mode: "unknown" })))
            .toBe(false);
    });

    test("reveals a Finnish read-only preview without invoking an updater", () => {
        const panel = document.createElement("table");
        panel.id = "site-information";
        document.body.appendChild(panel);
        const onLayoutChange = vi.fn();

        appendAdminUpdatePreview(panel, eligibleVersionInfo(), "fi", onLayoutChange);

        const openButton = panel.querySelector(
            '[data-testid="filterbar-admin-update-preview-open"]'
        );
        const preview = panel.querySelector('[data-testid="filterbar-admin-update-preview"]');
        const previewRow = preview.closest("tr");
        expect(openButton.textContent).toBe("Päivitä…");
        expect(previewRow.hidden).toBe(true);

        openButton.click();

        expect(previewRow.hidden).toBe(false);
        expect(document.activeElement).toBe(
            preview.querySelector(".filterbar-clock-bar__update-preview-close"),
        );
        expect(preview.textContent).toContain("Tästä näkymästä ei asenneta eikä muuteta mitään.");
        expect(preview.textContent).toContain("Nykyinen versio");
        expect(preview.textContent).toContain("v. 8.37.1");
        expect(preview.textContent).toContain("Saatavilla oleva versio");
        expect(preview.textContent).toContain("v. 8.40.0");
        expect(preview.textContent).toContain("v. 9.2.5 / v. 9.2.5");
        expect(preview.textContent).toContain("Yhteensopiva nykyisen sovelluksen kanssa");
        expect(preview.textContent).toContain("pysäyttää palvelun");
        expect(preview.querySelector("code")?.textContent)
            .toBe("./filterest update --dry-run");
        expect(onLayoutChange).toHaveBeenCalledTimes(1);
    });

    test("labels an incompatible current database without hiding the preview", () => {
        const panel = document.createElement("table");
        panel.id = "site-information";

        appendAdminUpdatePreview(panel, eligibleVersionInfo({
            db_version: "9.2.4",
            required_db_version: "9.2.5",
            db_compatible: false,
            runtime_mode: "native",
        }), "en");
        panel.querySelector('[data-testid="filterbar-admin-update-preview-open"]').click();

        const preview = panel.querySelector('[data-testid="filterbar-admin-update-preview"]');
        expect(preview.textContent).toContain("Nothing is installed or changed from this view.");
        expect(preview.textContent).toContain("v. 9.2.4 / v. 9.2.5");
        expect(preview.textContent).toContain("Not compatible with the running application");
        expect(preview.textContent).toContain("Installation remains available only");
    });
});
