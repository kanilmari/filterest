// admin_version_info_indicator.js
// Builds the administrator-only product/database version control for the filterbar footer.
// Bridges route rights, the protected endpoint, the shared Material icon, and a click disclosure.
// Exists so admins can inspect versions by hover or click without exposing them to other users.

import { hasRoutePermission } from "../route_permission_checker.js";
import {
    checkAdminVersionInfoAgain,
    fetchAdminVersionInfo,
} from "../endpoints/stable_endpoint_router.js";
import { getLanguageWithBrowserFallback } from "../state_stores/lang_preference_reader.js";
import {
    formatSiteNameForDisplay,
    getCurrentSiteName,
} from "../state_stores/site_identity_reader.js";
import { createSymbolMaskElement } from "../../reusable_components/symbol_asset_resolver.js";
import { appendAdminUpdatePreview } from "./admin_update_preflight_view.js";
import {
    appendAdminVersionRefreshControl,
    positionAdminVersionInfoPanel,
    renderAdminVersionInfoMessage,
    renderAdminVersionInfoRows,
} from "./admin_version_info_panel_view.js";

import {
    buildAdminVersionInfoRows,
    formatAdminVersionInfoLabel,
    formatUpdateCheckedAt,
    getAdminSiteInfoTitle,
    resolveVersionInfoLabels,
} from "./admin_version_info_formatter.js";

export { buildAdminVersionInfoRows, formatAdminVersionInfoLabel, getAdminSiteInfoTitle }
    from "./admin_version_info_formatter.js";

export const ADMIN_VERSION_INFO_ROUTE = "/api/admin/version-info";
export const ADMIN_VERSION_INFO_OPEN_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

let versionInfoPanelSequence = 0;

/** Builds the role-gated disclosure and owns its check, cooldown and cleanup lifecycle. */
export function buildAdminVersionInfoIndicator() {
    if (!hasRoutePermission(ADMIN_VERSION_INFO_ROUTE)) {
        return null;
    }

    const lifetimeController = new AbortController();
    const { signal } = lifetimeController;
    const shell = document.createElement("div");
    shell.classList.add("filterbar-clock-bar__version-info-shell");

    const indicator = document.createElement("button");
    indicator.type = "button";
    indicator.classList.add("filterbar-clock-bar__version-info");
    indicator.dataset.testid = "filterbar-admin-version-info";
    indicator.setAttribute("aria-expanded", "false");

    const panelId = `filterbar-admin-version-info-panel-${++versionInfoPanelSequence}`;
    const panel = document.createElement("table");
    panel.id = panelId;
    panel.classList.add("filterbar-clock-bar__version-info-panel");
    panel.dataset.testid = "filterbar-admin-version-info-panel";
    panel.setAttribute("aria-live", "polite");
    panel.hidden = true;
    indicator.setAttribute("aria-controls", panelId);

    const icon = createSymbolMaskElement("info", "filterbar-clock-bar__version-info-icon");
    indicator.appendChild(icon);
    shell.append(indicator, panel);

    let currentVersionInfo = null;
    let lastSuccessfulVersionInfo = null;
    let cooldownTimer = null;
    let refreshFocusPending = false;
    let requestInFlight = false;
    let openRefreshTimer = null;
    let wasConnected = false;
    let currentLanguage = document.documentElement.getAttribute("lang")
        || getLanguageWithBrowserFallback();

    const positionOpenPanel = () => positionAdminVersionInfoPanel(indicator, panel);
    const renderCurrentState = () => {
        const focusedControl = panel.contains(document.activeElement)
            ? document.activeElement.dataset.testid : "";
        const labels = resolveVersionInfoLabels(currentLanguage);
        const panelTitle = labels.title;
        panel.setAttribute("aria-label", panelTitle);

        if (!currentVersionInfo) {
            renderAdminVersionInfoMessage(
                panel,
                panelTitle,
                labels.loading,
            );
        } else {
            const siteName = formatSiteNameForDisplay(
                getCurrentSiteName()
                || String(currentVersionInfo?.product_name || "").trim()
            );
            const rows = buildAdminVersionInfoRows(
                currentVersionInfo,
                currentLanguage,
                siteName,
            );
            const label = formatAdminVersionInfoLabel(currentVersionInfo, currentLanguage);
            indicator.dataset.closedTooltip = label;
            if (panel.hidden) {
                indicator.title = label;
            } else {
                indicator.removeAttribute("title");
            }
            indicator.setAttribute("aria-label", label.replaceAll("\n", ". "));
            renderAdminVersionInfoRows(panel, rows, panelTitle);
        }

        appendAdminVersionRefreshControl(panel, labels, {
            checking: requestInFlight,
            cooldownUntil: Date.parse(currentVersionInfo?.refresh_allowed_at) > Date.now()
                ? formatUpdateCheckedAt(currentVersionInfo.refresh_allowed_at, currentLanguage) : "",
            onCheckAgain: () => void loadVersionInfo(true),
        });
        appendAdminUpdatePreview(panel, currentVersionInfo, currentLanguage, positionOpenPanel);
        indicator.classList.toggle(
            "filterbar-clock-bar__version-info--update-available",
            currentVersionInfo?.update_available === true
                && currentVersionInfo?.update_status === "available"
                && !currentVersionInfo?.client_check_failed_at
        );
        if (!panel.hidden && focusedControl) {
            const focusId = refreshFocusPending && !requestInFlight
                ? "filterbar-admin-version-check-again" : focusedControl;
            const control = panel.querySelector(`[data-testid="${focusId}"]`);
            if (control?.disabled) {
                panel.querySelector('[data-testid="filterbar-admin-update-preview-open"]')?.focus();
            } else control?.focus();
        }
        if (!requestInFlight) refreshFocusPending = false;
        positionOpenPanel();
    };

    const stopCooldownTimer = () => {
        if (cooldownTimer !== null) window.clearTimeout(cooldownTimer);
        cooldownTimer = null;
    };
    const scheduleCooldown = () => {
        stopCooldownTimer();
        const remaining = Date.parse(currentVersionInfo?.refresh_allowed_at) - Date.now();
        if (panel.hidden || signal.aborted || !(remaining > 0)) return;
        cooldownTimer = window.setTimeout(() => {
            cooldownTimer = null;
            renderCurrentState();
        }, Math.min(remaining, 2 ** 31 - 1));
    };

    async function loadVersionInfo(forceUpstreamCheck) {
        if (requestInFlight || signal.aborted) return;
        if (forceUpstreamCheck && Date.parse(currentVersionInfo?.refresh_allowed_at) > Date.now()) return;
        refreshFocusPending = document.activeElement?.dataset.testid
            === "filterbar-admin-version-check-again";
        requestInFlight = true;
        renderCurrentState();
        try {
            const received = forceUpstreamCheck
                ? await checkAdminVersionInfoAgain({ suppressAuthRedirect: true })
                : await fetchAdminVersionInfo({ suppressAuthRedirect: true });
            if (!received || typeof received !== "object") throw new Error("Missing version information");
            const succeeded = ["available", "current", "ahead_of_stable"].includes(received.update_status);
            currentVersionInfo = { ...received };
            if (succeeded) {
                currentVersionInfo.last_successful_check_at = received.last_successful_check_at
                    || received.update_checked_at;
            } else if (lastSuccessfulVersionInfo && !received.last_successful_check_at) {
                // Preserve release evidence while the failed attempt remains unavailable.
                Object.assign(currentVersionInfo, {
                    latest_stable_version: lastSuccessfulVersionInfo.latest_stable_version,
                    latest_release_url: lastSuccessfulVersionInfo.latest_release_url,
                    last_successful_check_at: lastSuccessfulVersionInfo.last_successful_check_at,
                    update_status: "unavailable", update_available: false,
                });
            }
            if (currentVersionInfo.last_successful_check_at && currentVersionInfo.latest_stable_version) {
                lastSuccessfulVersionInfo = currentVersionInfo;
            }
        } catch {
            currentVersionInfo = {
                ...currentVersionInfo,
                update_status: "unavailable", update_available: false,
                upstream_check_performed: false,
                client_check_failed_at: new Date().toISOString(),
            };
        } finally {
            requestInFlight = false;
            if (!signal.aborted) {
                renderCurrentState();
                scheduleCooldown();
            }
        }
    }

    const stopOpenRefreshTimer = () => {
        if (openRefreshTimer === null) return;
        window.clearTimeout(openRefreshTimer);
        openRefreshTimer = null;
    };
    const scheduleOpenRefresh = () => {
        stopOpenRefreshTimer();
        if (panel.hidden || signal.aborted) return;
        wasConnected = wasConnected || shell.isConnected;
        openRefreshTimer = window.setTimeout(async () => {
            openRefreshTimer = null;
            if (panel.hidden || signal.aborted) return;
            await loadVersionInfo(false);
            scheduleOpenRefresh();
        }, ADMIN_VERSION_INFO_OPEN_REFRESH_INTERVAL_MS);
    };

    const restorePanelToShell = () => {
        panel.classList.remove("filterbar-clock-bar__version-info-panel--portaled");
        panel.style.removeProperty("left");
        panel.style.removeProperty("top");
        delete panel.dataset.versionInfoPlacement;
        if (shell.isConnected) {
            shell.appendChild(panel);
        } else {
            panel.remove();
        }
    };
    const closePanel = () => {
        stopOpenRefreshTimer();
        stopCooldownTimer();
        panel.hidden = true;
        restorePanelToShell();
        indicator.setAttribute("aria-expanded", "false");
        if (indicator.dataset.closedTooltip) {
            indicator.title = indicator.dataset.closedTooltip;
        }
    };
    const togglePanel = () => {
        const shouldOpen = panel.hidden;
        if (shouldOpen) {
            document.body.appendChild(panel);
            panel.classList.add("filterbar-clock-bar__version-info-panel--portaled");
            panel.hidden = false;
            positionOpenPanel();
            indicator.setAttribute("aria-expanded", "true");
            indicator.removeAttribute("title");
            scheduleOpenRefresh();
            void loadVersionInfo(false);
            return;
        }
        closePanel();
    };

    indicator.addEventListener("click", (event) => {
        event.stopPropagation();
        togglePanel();
    }, { signal });
    document.addEventListener("click", (event) => {
        if (!panel.hidden
            && !shell.contains(event.target)
            && !panel.contains(event.target)) {
            closePanel();
        }
    }, { signal, capture: true });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !panel.hidden) {
            closePanel();
            indicator.focus();
        }
    }, { signal });
    window.addEventListener("resize", positionOpenPanel, { signal });
    document.addEventListener("scroll", positionOpenPanel, {
        signal,
        capture: true,
        passive: true,
    });

    const languageObserver = new MutationObserver(() => {
        currentLanguage = document.documentElement.getAttribute("lang")
            || getLanguageWithBrowserFallback();
        renderCurrentState();
    });
    languageObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["lang"],
    });

    const connectionObserver = new MutationObserver(() => {
        if (shell.isConnected) {
            wasConnected = true;
        } else if (wasConnected) {
            shell.destroy();
        }
    });
    connectionObserver.observe(document.documentElement, { childList: true, subtree: true });

    shell.destroy = () => {
        lifetimeController.abort();
        languageObserver.disconnect();
        connectionObserver.disconnect();
        closePanel();
    };

    const initialTitle = getAdminSiteInfoTitle(currentLanguage);
    indicator.title = initialTitle;
    indicator.setAttribute("aria-label", initialTitle);
    renderCurrentState();
    return shell;
}
