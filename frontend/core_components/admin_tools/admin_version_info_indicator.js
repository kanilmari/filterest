// admin_version_info_indicator.js
// Builds the administrator-only product/database version control for the filterbar footer.
// Bridges route rights, the protected endpoint, the shared Material icon, and a click disclosure.
// Exists so admins can inspect versions by hover or click without exposing them to other users.

import { hasRoutePermission } from "../route_permission_checker.js";
import { fetchAdminVersionInfo } from "../endpoints/stable_endpoint_router.js";
import { getLanguageWithBrowserFallback } from "../state_stores/lang_preference_reader.js";
import {
    formatSiteNameForDisplay,
    getCurrentSiteName,
} from "../state_stores/site_identity_reader.js";
import { createSymbolMaskElement } from "../../reusable_components/symbol_asset_resolver.js";

export const ADMIN_VERSION_INFO_ROUTE = "/api/admin/version-info";

let versionInfoPanelSequence = 0;

const VERSION_INFO_PANEL_GAP_PX = 8;
const VERSION_INFO_PANEL_VIEWPORT_MARGIN_PX = 12;

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

function renderAdminVersionInfoRows(panel, rows, title) {
    const heading = document.createElement("thead");
    const headingRow = document.createElement("tr");
    const headingCell = document.createElement("th");
    headingCell.colSpan = 2;
    headingCell.classList.add("filterbar-clock-bar__version-info-title");
    headingCell.textContent = title;
    headingRow.appendChild(headingCell);
    heading.appendChild(headingRow);

    const body = document.createElement("tbody");
    const rowElements = rows.map(({ id, label, value, href = "" }) => {
        const row = document.createElement("tr");

        const keyCell = document.createElement("th");
        keyCell.scope = "row";
        keyCell.classList.add("filterbar-clock-bar__version-info-key");
        keyCell.dataset.versionInfoKey = id;
        keyCell.textContent = label;

        const valueCell = document.createElement("td");
        valueCell.classList.add("filterbar-clock-bar__version-info-value");
        valueCell.dataset.versionInfoValue = id;
        if (href) {
            const releaseLink = document.createElement("a");
            releaseLink.classList.add("filterbar-clock-bar__version-info-link");
            releaseLink.href = href;
            releaseLink.target = "_blank";
            releaseLink.rel = "noopener noreferrer";
            releaseLink.textContent = value;
            valueCell.appendChild(releaseLink);
        } else {
            valueCell.textContent = value;
        }

        row.append(keyCell, valueCell);
        return row;
    });
    body.append(...rowElements);
    panel.replaceChildren(heading, body);
}

function clampPanelCoordinate(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function positionAdminVersionInfoPanel(indicator, panel) {
    if (panel.hidden || panel.parentElement !== document.body) {
        return;
    }

    const anchorRect = indicator.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const maximumLeft = viewportWidth
        - VERSION_INFO_PANEL_VIEWPORT_MARGIN_PX
        - panelRect.width;
    const left = clampPanelCoordinate(
        anchorRect.right - panelRect.width,
        VERSION_INFO_PANEL_VIEWPORT_MARGIN_PX,
        maximumLeft,
    );
    const topWhenAbove = anchorRect.top - VERSION_INFO_PANEL_GAP_PX - panelRect.height;
    const topWhenBelow = anchorRect.bottom + VERSION_INFO_PANEL_GAP_PX;
    const spaceAbove = anchorRect.top - VERSION_INFO_PANEL_VIEWPORT_MARGIN_PX;
    const spaceBelow = viewportHeight
        - anchorRect.bottom
        - VERSION_INFO_PANEL_VIEWPORT_MARGIN_PX;
    const placeAbove = topWhenAbove >= VERSION_INFO_PANEL_VIEWPORT_MARGIN_PX
        || spaceAbove >= spaceBelow;
    const maximumTop = viewportHeight
        - VERSION_INFO_PANEL_VIEWPORT_MARGIN_PX
        - panelRect.height;
    const top = clampPanelCoordinate(
        placeAbove ? topWhenAbove : topWhenBelow,
        VERSION_INFO_PANEL_VIEWPORT_MARGIN_PX,
        maximumTop,
    );

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.dataset.versionInfoPlacement = placeAbove ? "top" : "bottom";
}

export function buildAdminVersionInfoIndicator() {
    if (!hasRoutePermission(ADMIN_VERSION_INFO_ROUTE)) {
        return null;
    }

    const lifetimeController = new AbortController();
    const { signal } = lifetimeController;
    const shell = document.createElement("div");
    shell.classList.add("filterbar-clock-bar__version-info-shell");
    shell.hidden = true;

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
        panel.hidden = true;
        restorePanelToShell();
        indicator.setAttribute("aria-expanded", "false");
        if (indicator.dataset.closedTooltip) {
            indicator.title = indicator.dataset.closedTooltip;
        }
    };
    const positionOpenPanel = () => positionAdminVersionInfoPanel(indicator, panel);
    const togglePanel = () => {
        const shouldOpen = panel.hidden;
        if (shouldOpen) {
            document.body.appendChild(panel);
            panel.classList.add("filterbar-clock-bar__version-info-panel--portaled");
            panel.hidden = false;
            positionOpenPanel();
            indicator.setAttribute("aria-expanded", "true");
            indicator.removeAttribute("title");
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

    shell.destroy = () => {
        lifetimeController.abort();
        closePanel();
    };

    void hydrateAdminVersionInfoIndicator(
        shell,
        indicator,
        panel,
        signal,
        positionOpenPanel,
    );
    return shell;
}

async function hydrateAdminVersionInfoIndicator(
    shell,
    indicator,
    panel,
    signal,
    positionOpenPanel,
) {
    try {
        const versionInfo = await fetchAdminVersionInfo({ suppressAuthRedirect: true });
        if (signal.aborted) return;
        const siteName = formatSiteNameForDisplay(
            getCurrentSiteName() || String(versionInfo?.product_name || "").trim()
        );
        const renderLanguage = (language) => {
            const rows = buildAdminVersionInfoRows(versionInfo, language, siteName);
            const label = formatAdminVersionInfoLabel(versionInfo, language);
            indicator.dataset.closedTooltip = label;
            if (panel.hidden) {
                indicator.title = label;
            } else {
                indicator.removeAttribute("title");
            }
            indicator.setAttribute("aria-label", label.replaceAll("\n", ". "));
            const panelTitle = getAdminSiteInfoTitle(language);
            panel.setAttribute("aria-label", panelTitle);
            renderAdminVersionInfoRows(panel, rows, panelTitle);
            positionOpenPanel();
        };

        renderLanguage(getLanguageWithBrowserFallback());
        indicator.classList.toggle(
            "filterbar-clock-bar__version-info--update-available",
            versionInfo?.update_available === true
        );

        const languageObserver = new MutationObserver(() => {
            renderLanguage(
                document.documentElement.getAttribute("lang")
                || getLanguageWithBrowserFallback()
            );
        });
        languageObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["lang"],
        });
        signal.addEventListener("abort", () => languageObserver.disconnect(), { once: true });
        shell.hidden = false;
    } catch {
        shell.destroy();
        shell.remove();
    }
}
