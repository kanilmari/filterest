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

export const ADMIN_VERSION_INFO_ROUTE = "/api/admin/version-info";
export const ADMIN_VERSION_INFO_OPEN_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

let versionInfoPanelSequence = 0;

const VERSION_LABELS = Object.freeze({
    fi: {
        title: "Sivustotiedot",
        site: "Sivusto",
        app: "Sovellus",
        releaseChannel: "Julkaisukanava",
        artifactPurpose: "Julkaisun tarkoitus",
        artifactType: "Paketin tyyppi",
        releaseMaturity: "Julkaisuvaihe",
        identityVerification: "Tunnisteen varmistus",
        latestStable: "Uusin vakaa versio",
        database: "Tietokanta",
        requiredDatabase: "Vaadittu tietokanta",
        runtime: "Ajotapa",
        runtimeDocker: "Docker",
        runtimeNative: "Tavallinen",
        channelDevelopment: "Kehitys",
        channelStable: "Vakaa",
        channelUnknown: "Tuntematon",
        purposeDeveloperBackup: "Kehittäjän varmuuskopio",
        purposePublicRelease: "Julkiseksi tarkoitettu",
        purposeUnknown: "Tuntematon",
        typeRuntime: "Käyttöversio",
        typeBackup: "Varmuuskopio",
        typeUnknown: "Tuntematon",
        maturitySnapshot: "Kehitysvedos",
        maturityCandidate: "Julkaisuehdokas",
        maturityPublished: "Julkaistu",
        maturityUnknown: "Tuntematon",
        verificationLocalContract: "Paikallinen julkaisusopimus varmennettu",
        verificationLegacy: "Vanha tunniste, varmistamaton",
        verificationUnverified: "Varmistamaton",
        updateAvailable: "päivitys saatavilla",
        updateCurrent: "ajan tasalla",
        updateAhead: "paikallinen versio uudempi",
        updateUnavailable: "tarkistus ei saatavilla",
        lastChecked: "Tarkistettu viimeksi",
        checkAgain: "Tarkista uudelleen",
        checkingAgain: "Tarkistetaan…",
        checkFailed: "Tarkistus epäonnistui",
        loading: "Ladataan…",
        compatible: "yhteensopiva",
        incompatible: "ei yhteensopiva",
    },
    en: {
        title: "Site information",
        site: "Site",
        app: "Application",
        releaseChannel: "Release channel",
        artifactPurpose: "Release purpose",
        artifactType: "Package type",
        releaseMaturity: "Release stage",
        identityVerification: "Identity verification",
        latestStable: "Latest stable version",
        database: "Database",
        requiredDatabase: "Required database",
        runtime: "Runtime",
        runtimeDocker: "Docker",
        runtimeNative: "Native",
        channelDevelopment: "Development",
        channelStable: "Stable",
        channelUnknown: "Unknown",
        purposeDeveloperBackup: "Developer backup",
        purposePublicRelease: "Intended for public release",
        purposeUnknown: "Unknown",
        typeRuntime: "Runtime",
        typeBackup: "Backup",
        typeUnknown: "Unknown",
        maturitySnapshot: "Development snapshot",
        maturityCandidate: "Release candidate",
        maturityPublished: "Published",
        maturityUnknown: "Unknown",
        verificationLocalContract: "Local release contract validated",
        verificationLegacy: "Legacy marker, unverified",
        verificationUnverified: "Unverified",
        updateAvailable: "update available",
        updateCurrent: "up to date",
        updateAhead: "local version is newer",
        updateUnavailable: "check unavailable",
        lastChecked: "Last checked",
        checkAgain: "Check again",
        checkingAgain: "Checking…",
        checkFailed: "Check failed",
        loading: "Loading…",
        compatible: "compatible",
        incompatible: "incompatible",
    },
    ch: {
        title: "站点信息",
        site: "网站",
        app: "应用程序",
        releaseChannel: "发布渠道",
        artifactPurpose: "发布用途",
        artifactType: "软件包类型",
        releaseMaturity: "发布阶段",
        identityVerification: "身份验证状态",
        latestStable: "最新稳定版",
        database: "数据库",
        requiredDatabase: "所需数据库",
        runtime: "运行方式",
        runtimeDocker: "Docker",
        runtimeNative: "本机",
        channelDevelopment: "开发版",
        channelStable: "稳定版",
        channelUnknown: "未知",
        purposeDeveloperBackup: "开发者备份",
        purposePublicRelease: "用于公开发布",
        purposeUnknown: "未知",
        typeRuntime: "运行版本",
        typeBackup: "备份",
        typeUnknown: "未知",
        maturitySnapshot: "开发快照",
        maturityCandidate: "发布候选版",
        maturityPublished: "已发布",
        maturityUnknown: "未知",
        verificationLocalContract: "本地发布契约已验证",
        verificationLegacy: "旧版标记，未验证",
        verificationUnverified: "未验证",
        updateAvailable: "有可用更新",
        updateCurrent: "已是最新",
        updateAhead: "开发版较新",
        updateUnavailable: "无法检查",
        lastChecked: "上次检查",
        checkAgain: "再次检查",
        checkingAgain: "正在检查…",
        checkFailed: "检查失败",
        loading: "正在加载…",
        compatible: "兼容",
        incompatible: "不兼容",
    },
    zhTW: {
        title: "網站資訊",
        site: "網站",
        app: "應用程式",
        releaseChannel: "發布管道",
        artifactPurpose: "發布用途",
        artifactType: "套件類型",
        releaseMaturity: "發布階段",
        identityVerification: "身分驗證狀態",
        latestStable: "最新穩定版本",
        database: "資料庫",
        requiredDatabase: "必要資料庫",
        runtime: "執行方式",
        runtimeDocker: "Docker",
        runtimeNative: "本機",
        channelDevelopment: "開發版本",
        channelStable: "穩定版本",
        channelUnknown: "未知",
        purposeDeveloperBackup: "開發者備份",
        purposePublicRelease: "預定公開發布",
        purposeUnknown: "未知",
        typeRuntime: "執行版本",
        typeBackup: "備份",
        typeUnknown: "未知",
        maturitySnapshot: "開發快照",
        maturityCandidate: "發布候選版本",
        maturityPublished: "已發布",
        maturityUnknown: "未知",
        verificationLocalContract: "本機發布合約已驗證",
        verificationLegacy: "舊版標記，未驗證",
        verificationUnverified: "未驗證",
        updateAvailable: "有可用更新",
        updateCurrent: "已是最新",
        updateAhead: "本機版本較新",
        updateUnavailable: "無法檢查",
        lastChecked: "上次檢查",
        checkAgain: "再次檢查",
        checkingAgain: "正在檢查…",
        checkFailed: "檢查失敗",
        loading: "載入中…",
        compatible: "相容",
        incompatible: "不相容",
    },
    zhHK: {
        title: "網站資訊",
        site: "網站",
        app: "應用程式",
        releaseChannel: "發佈渠道",
        artifactPurpose: "發佈用途",
        artifactType: "軟件包類型",
        releaseMaturity: "發佈階段",
        identityVerification: "身份驗證狀態",
        latestStable: "最新穩定版本",
        database: "資料庫",
        requiredDatabase: "所需資料庫",
        runtime: "執行方式",
        runtimeDocker: "Docker",
        runtimeNative: "原生",
        channelDevelopment: "開發版本",
        channelStable: "穩定版本",
        channelUnknown: "未知",
        purposeDeveloperBackup: "開發者備份",
        purposePublicRelease: "擬作公開發佈",
        purposeUnknown: "未知",
        typeRuntime: "執行版本",
        typeBackup: "備份",
        typeUnknown: "未知",
        maturitySnapshot: "開發快照",
        maturityCandidate: "發佈候選版本",
        maturityPublished: "已發佈",
        maturityUnknown: "未知",
        verificationLocalContract: "本機發佈合約已驗證",
        verificationLegacy: "舊版標記，未驗證",
        verificationUnverified: "未驗證",
        updateAvailable: "有可用更新",
        updateCurrent: "已是最新",
        updateAhead: "本機版本較新",
        updateUnavailable: "無法檢查",
        lastChecked: "上次檢查",
        checkAgain: "再次檢查",
        checkingAgain: "正在檢查…",
        checkFailed: "檢查失敗",
        loading: "載入中…",
        compatible: "相容",
        incompatible: "不相容",
    },
    yue: {
        title: "網站資訊",
        site: "網站",
        app: "應用程式",
        releaseChannel: "發布渠道",
        artifactPurpose: "發布用途",
        artifactType: "軟件包類型",
        releaseMaturity: "發布階段",
        identityVerification: "身分驗證狀態",
        latestStable: "最新穩定版",
        database: "資料庫",
        requiredDatabase: "所需資料庫",
        runtime: "執行方式",
        runtimeDocker: "Docker",
        runtimeNative: "原生",
        channelDevelopment: "開發版",
        channelStable: "穩定版",
        channelUnknown: "未知",
        purposeDeveloperBackup: "開發者備份",
        purposePublicRelease: "用於公開發布",
        purposeUnknown: "未知",
        typeRuntime: "執行版本",
        typeBackup: "備份",
        typeUnknown: "未知",
        maturitySnapshot: "開發快照",
        maturityCandidate: "發布候選版本",
        maturityPublished: "已發布",
        maturityUnknown: "未知",
        verificationLocalContract: "本機發布合約已驗證",
        verificationLegacy: "舊版標記，未驗證",
        verificationUnverified: "未驗證",
        updateAvailable: "有可用更新",
        updateCurrent: "已是最新",
        updateAhead: "開發版較新",
        updateUnavailable: "無法檢查",
        lastChecked: "上次檢查",
        checkAgain: "再檢查",
        checkingAgain: "檢查緊…",
        checkFailed: "檢查失敗",
        loading: "載入緊…",
        compatible: "相容",
        incompatible: "不相容",
    },
});

function resolveVersionInfoLabels(language = "en") {
    const normalizedLanguage = String(language || "en")
        .trim()
        .toLowerCase()
        .replaceAll("_", "-");
    if (normalizedLanguage === "yue" || normalizedLanguage.startsWith("yue-")) {
        return VERSION_LABELS.yue;
    }
    if (normalizedLanguage === "zh-hk" || normalizedLanguage.startsWith("zh-hk-")
        || normalizedLanguage === "zh-mo" || normalizedLanguage.startsWith("zh-mo-")
        || normalizedLanguage.startsWith("zh-hant-hk")
        || normalizedLanguage.startsWith("zh-hant-mo")) {
        return VERSION_LABELS.zhHK;
    }
    if (normalizedLanguage === "zh-tw" || normalizedLanguage.startsWith("zh-tw-")
        || normalizedLanguage.startsWith("zh-hant")) {
        return VERSION_LABELS.zhTW;
    }
    if (normalizedLanguage === "ch" || normalizedLanguage.startsWith("ch-")
        || normalizedLanguage === "zh" || normalizedLanguage === "zh-cn"
        || normalizedLanguage.startsWith("zh-cn-") || normalizedLanguage === "zh-sg"
        || normalizedLanguage.startsWith("zh-sg-")
        || normalizedLanguage.startsWith("zh-hans")) {
        return VERSION_LABELS.ch;
    }
    return VERSION_LABELS[normalizedLanguage.split("-")[0]] || VERSION_LABELS.en;
}

export function getAdminSiteInfoTitle(language = "en") {
    return resolveVersionInfoLabels(language).title;
}

function localizeReleaseChannel(value, labels) {
    const channels = {
        development: labels.channelDevelopment,
        stable: labels.channelStable,
    };
    return channels[String(value || "").trim().toLowerCase()] || labels.channelUnknown;
}

function localizeArtifactPurpose(value, labels) {
    const purposes = {
        developer_backup: labels.purposeDeveloperBackup,
        public_release: labels.purposePublicRelease,
    };
    return purposes[String(value || "").trim().toLowerCase()] || labels.purposeUnknown;
}

function localizeArtifactType(value, labels) {
    const types = {
        runtime: labels.typeRuntime,
        backup: labels.typeBackup,
    };
    return types[String(value || "").trim().toLowerCase()] || labels.typeUnknown;
}

function localizeReleaseMaturity(value, labels) {
    const maturities = {
        snapshot: labels.maturitySnapshot,
        candidate: labels.maturityCandidate,
        published: labels.maturityPublished,
    };
    return maturities[String(value || "").trim().toLowerCase()] || labels.maturityUnknown;
}

function localizeIdentityVerification(value, labels) {
    const verification = {
        local_contract_validated: labels.verificationLocalContract,
        legacy_unverified: labels.verificationLegacy,
        unverified: labels.verificationUnverified,
    };
    return verification[String(value || "").trim().toLowerCase()]
        || labels.verificationUnverified;
}

function formatLatestStableStatus(versionInfo, labels) {
    const statuses = {
        available: labels.updateAvailable,
        current: labels.updateCurrent,
        ahead_of_stable: labels.updateAhead,
        unavailable: labels.updateUnavailable,
    };
    const status = statuses[String(versionInfo?.update_status || "unavailable").trim().toLowerCase()]
        || labels.updateUnavailable;
    const latestVersion = String(versionInfo?.latest_stable_version || "").trim();
    return latestVersion ? `v. ${latestVersion} (${status})` : status;
}

function resolveVersionInfoDateLocale(language = "en") {
    const normalizedLanguage = String(language || "en").trim().toLowerCase().replaceAll("_", "-");
    if (normalizedLanguage === "ch" || normalizedLanguage.startsWith("ch-")) return "zh-CN";
    if (normalizedLanguage === "yue" || normalizedLanguage.startsWith("yue-")) return "yue-HK";
    return normalizedLanguage || "en";
}

function formatUpdateCheckedAt(value, language = "en") {
    const checkedAt = new Date(String(value || ""));
    if (Number.isNaN(checkedAt.getTime())) return "";
    return new Intl.DateTimeFormat(resolveVersionInfoDateLocale(language), {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).format(checkedAt);
}

export function buildAdminVersionInfoRows(versionInfo, language = "en", siteName = "") {
    const labels = resolveVersionInfoLabels(language);
    const productName = String(versionInfo?.product_name || labels.app).trim();
    const appVersion = String(versionInfo?.app_version || "unknown").trim();
    const databaseVersion = String(versionInfo?.db_version || "unknown").trim();
    const requiredDatabaseVersion = String(versionInfo?.required_db_version || "unknown").trim();
    const runtimeMode = String(versionInfo?.runtime_mode || "native").trim().toLowerCase();
    const runtimeLabel = runtimeMode === "docker"
        ? labels.runtimeDocker
        : labels.runtimeNative;
    const compatibilityLabel = versionInfo?.db_compatible
        ? labels.compatible
        : labels.incompatible;

    const rows = [
        { id: "application", label: productName, value: `v. ${appVersion}` },
        {
            id: "release-channel",
            label: labels.releaseChannel,
            value: localizeReleaseChannel(versionInfo?.release_channel, labels),
        },
        {
            id: "artifact-purpose",
            label: labels.artifactPurpose,
            value: localizeArtifactPurpose(versionInfo?.artifact_purpose, labels),
        },
        {
            id: "artifact-type",
            label: labels.artifactType,
            value: localizeArtifactType(versionInfo?.artifact_type, labels),
        },
        {
            id: "release-maturity",
            label: labels.releaseMaturity,
            value: localizeReleaseMaturity(versionInfo?.release_maturity, labels),
        },
        {
            id: "identity-verification",
            label: labels.identityVerification,
            value: localizeIdentityVerification(versionInfo?.identity_verification, labels),
        },
        {
            id: "latest-stable",
            label: labels.latestStable,
            value: formatLatestStableStatus(versionInfo, labels),
            href: String(versionInfo?.latest_release_url || "").trim(),
        },
        {
            id: "database",
            label: labels.database,
            value: `v. ${databaseVersion} (${compatibilityLabel})`,
        },
        {
            id: "required-database",
            label: labels.requiredDatabase,
            value: `v. ${requiredDatabaseVersion}`,
        },
        { id: "runtime", label: labels.runtime, value: runtimeLabel },
    ];
    const checkedAt = formatUpdateCheckedAt(versionInfo?.update_checked_at, language);
    if (checkedAt) {
        const latestStableIndex = rows.findIndex(({ id }) => id === "latest-stable");
        rows.splice(latestStableIndex + 1, 0, {
            id: "last-checked",
            label: labels.lastChecked,
            value: checkedAt,
        });
    }
    const normalizedSiteName = formatSiteNameForDisplay(siteName);
    if (normalizedSiteName) {
        rows.unshift({ id: "site", label: labels.site, value: normalizedSiteName });
    }
    return Object.freeze(rows);
}

export function formatAdminVersionInfoLabel(versionInfo, language = "en") {
    return buildAdminVersionInfoRows(versionInfo, language)
        .map(({ label, value }) => `${label} ${value}`)
        .join("\n");
}

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
    let requestInFlight = false;
    let lastRequestFailed = false;
    let openRefreshTimer = null;
    let wasConnected = false;
    let currentLanguage = document.documentElement.getAttribute("lang")
        || getLanguageWithBrowserFallback();

    const positionOpenPanel = () => positionAdminVersionInfoPanel(indicator, panel);
    const renderCurrentState = () => {
        const labels = resolveVersionInfoLabels(currentLanguage);
        const panelTitle = labels.title;
        panel.setAttribute("aria-label", panelTitle);

        if (!currentVersionInfo) {
            renderAdminVersionInfoMessage(
                panel,
                panelTitle,
                lastRequestFailed ? labels.checkFailed : labels.loading,
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
            checkFailed: lastRequestFailed && Boolean(currentVersionInfo),
            onCheckAgain: () => void loadVersionInfo(true),
        });
        if (currentVersionInfo) {
            appendAdminUpdatePreview(
                panel,
                currentVersionInfo,
                currentLanguage,
                positionOpenPanel,
            );
        }
        indicator.classList.toggle(
            "filterbar-clock-bar__version-info--update-available",
            currentVersionInfo?.update_available === true
        );
        positionOpenPanel();
    };

    async function loadVersionInfo(forceUpstreamCheck) {
        if (requestInFlight || signal.aborted) return;
        requestInFlight = true;
        lastRequestFailed = false;
        renderCurrentState();
        try {
            currentVersionInfo = forceUpstreamCheck
                ? await checkAdminVersionInfoAgain({ suppressAuthRedirect: true })
                : await fetchAdminVersionInfo({ suppressAuthRedirect: true });
        } catch {
            lastRequestFailed = true;
        } finally {
            requestInFlight = false;
            if (!signal.aborted) renderCurrentState();
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
