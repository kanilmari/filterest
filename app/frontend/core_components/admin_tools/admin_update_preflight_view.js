// admin_update_preflight_view.js
// Builds a read-only Filterest update preview inside the administrator site-information panel.
// Bridges verified release metadata with the existing command-line updater's operational contract.
// Exists so an administrator can assess update status without starting or simulating installation.

import {
    buildAdminUpdateCheckRows,
    resolveVersionInfoLabels,
} from "./admin_version_info_formatter.js";

const UPDATE_DRY_RUN_COMMAND = "./filterest update --dry-run";

const UPDATE_PREVIEW_LABELS = Object.freeze({
    fi: {
        title: "Sovelluksen päivitystiedot",
        noInstall: "Tästä näkymästä ei asenneta eikä muuteta mitään.",
        currentVersion: "Nykyinen versio",
        availableVersion: "Uusin vakaa versio",
        database: "Nykyinen tietokanta",
        databaseCompatible: "Yhteensopiva nykyisen sovelluksen kanssa",
        databaseIncompatible: "Ei yhteensopiva nykyisen sovelluksen kanssa",
        availability: "Palvelun saatavuus",
        interruptionExpected: "Nykyinen komentorivipäivitys pysäyttää palvelun varmuuskopioinnin ja asennuksen ajaksi.",
        dryRun: "Komentorivin kuivaharjoittelu",
        close: "Sulje päivitystiedot",
        targetDatabase: "Uuden version tietokantayhteensopivuus",
        targetMigrations: "Uuden version migraatioyhteensopivuus",
        notChecked: "ei tarkistettu",
        runningOnly: "Tietokannan yhteensopivuustieto koskee vain käynnissä olevaa versiota.",
        siteOperator: "Sivuston ylläpitäjä tekee päivitykset sivuston päivitysmenettelyllä.",
        dryRunLimits: "Kuivaharjoittelu tarkistaa päivityskohteen; se ei testaa tietokantaa, migraatioita tai palautusta.",
    },
    en: {
        title: "Application update details",
        noInstall: "Nothing is installed or changed from this view.",
        currentVersion: "Current version",
        availableVersion: "Latest stable version",
        database: "Current database",
        databaseCompatible: "Compatible with the running application",
        databaseIncompatible: "Not compatible with the running application",
        availability: "Service availability",
        interruptionExpected: "The current command-line updater stops the service during backup and installation.",
        dryRun: "Command-line dry run",
        close: "Close update details",
        targetDatabase: "New version database compatibility",
        targetMigrations: "New version migration compatibility",
        notChecked: "not checked",
        runningOnly: "The database compatibility mark concerns only the running version.",
        siteOperator: "The site operator performs updates using the site's update procedure.",
        dryRunLimits: "The dry run checks the update target; it does not test the database, migrations or restoration.",
    },
    ch: {
        title: "更新预检",
        noInstall: "此视图不会安装或更改任何内容。",
        currentVersion: "当前版本",
        availableVersion: "可用版本",
        database: "当前数据库",
        databaseCompatible: "与当前运行的应用程序兼容",
        databaseIncompatible: "与当前运行的应用程序不兼容",
        availability: "服务可用性",
        interruptionExpected: "当前命令行更新程序会在备份和安装期间停止服务。",
        dryRun: "命令行试运行",
        close: "关闭预检",
    },
    zhTW: {
        title: "更新預檢",
        noInstall: "此檢視不會安裝或變更任何內容。",
        currentVersion: "目前版本",
        availableVersion: "可用版本",
        database: "目前資料庫",
        databaseCompatible: "與目前執行中的應用程式相容",
        databaseIncompatible: "與目前執行中的應用程式不相容",
        availability: "服務可用性",
        interruptionExpected: "目前的命令列更新程式會在備份及安裝期間停止服務。",
        dryRun: "命令列試行",
        close: "關閉預檢",
    },
    zhHK: {
        title: "更新預檢",
        noInstall: "此檢視不會安裝或更改任何內容。",
        currentVersion: "目前版本",
        availableVersion: "可用版本",
        database: "目前資料庫",
        databaseCompatible: "與目前運行的應用程式相容",
        databaseIncompatible: "與目前運行的應用程式不相容",
        availability: "服務可用性",
        interruptionExpected: "目前的命令列更新程式會在備份及安裝期間停止服務。",
        dryRun: "命令列試行",
        close: "關閉預檢",
    },
    yue: {
        title: "更新預檢",
        noInstall: "呢個畫面唔會安裝或者更改任何內容。",
        currentVersion: "目前版本",
        availableVersion: "可用版本",
        database: "目前資料庫",
        databaseCompatible: "同目前運行緊嘅應用程式相容",
        databaseIncompatible: "同目前運行緊嘅應用程式唔相容",
        availability: "服務可用性",
        interruptionExpected: "目前嘅命令列更新程式會喺備份同安裝期間停止服務。",
        dryRun: "命令列試行",
        close: "關閉預檢",
    },
});

function resolveExistingUpdatePreviewLabels(language = "en") {
    const normalizedLanguage = String(language || "en")
        .trim()
        .toLowerCase()
        .replaceAll("_", "-");
    if (normalizedLanguage === "yue" || normalizedLanguage.startsWith("yue-")) {
        return UPDATE_PREVIEW_LABELS.yue;
    }
    if (normalizedLanguage === "zh-hk" || normalizedLanguage.startsWith("zh-hk-")
        || normalizedLanguage === "zh-mo" || normalizedLanguage.startsWith("zh-mo-")
        || normalizedLanguage.startsWith("zh-hant-hk")
        || normalizedLanguage.startsWith("zh-hant-mo")) {
        return UPDATE_PREVIEW_LABELS.zhHK;
    }
    if (normalizedLanguage === "zh-tw" || normalizedLanguage.startsWith("zh-tw-")
        || normalizedLanguage.startsWith("zh-hant")) {
        return UPDATE_PREVIEW_LABELS.zhTW;
    }
    if (normalizedLanguage === "ch" || normalizedLanguage.startsWith("ch-")
        || normalizedLanguage === "zh" || normalizedLanguage === "zh-cn"
        || normalizedLanguage.startsWith("zh-cn-") || normalizedLanguage === "zh-sg"
        || normalizedLanguage.startsWith("zh-sg-")
        || normalizedLanguage.startsWith("zh-hans")) {
        return UPDATE_PREVIEW_LABELS.ch;
    }
    return UPDATE_PREVIEW_LABELS[normalizedLanguage.split("-")[0]]
        || UPDATE_PREVIEW_LABELS.en;
}

function resolveUpdatePreviewLabels(language) {
    return { ...UPDATE_PREVIEW_LABELS.en, ...resolveExistingUpdatePreviewLabels(language),
        open: resolveVersionInfoLabels(language).applicationUpdate };
}

/** Offers the generic CLI rehearsal only for an evidenced main checkout and known update. */
export function canShowAdminUpdateDryRun(versionInfo) {
    return versionInfo?.update_procedure === "main_checkout"
        && versionInfo?.update_status === "available"
        && versionInfo?.update_available === true
        && !versionInfo?.client_check_failed_at
        && versionInfo?.public_distribution === true
        && versionInfo?.product_name === "Filterest"
        && versionInfo?.release_channel === "stable"
        && versionInfo?.artifact_purpose === "public_release"
        && versionInfo?.artifact_type === "runtime"
        && versionInfo?.release_maturity === "published"
        && versionInfo?.identity_verification === "local_contract_validated"
        && ["docker", "native"].includes(versionInfo?.runtime_mode)
        && /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(
            versionInfo?.latest_stable_version || "",
        );
}

function appendPreviewFact(container, label, value) {
    const fact = document.createElement("div");
    fact.classList.add("filterbar-clock-bar__update-preview-fact");
    const key = document.createElement("strong");
    key.textContent = label;
    const detail = document.createElement("span");
    detail.textContent = value;
    fact.append(key, detail);
    container.appendChild(fact);
}

/**
 * Appends an explicitly non-mutating update disclosure to a version-information table.
 * All content comes from the already fetched administrator metadata; no update endpoint is called.
 *
 * @param {HTMLTableElement} panel
 * @param {object} versionInfo
 * @param {string} language
 * @param {() => void} onLayoutChange
 */
export function appendAdminUpdatePreview(
    panel,
    versionInfo,
    language = "en",
    onLayoutChange = () => {},
) {
    const labels = resolveUpdatePreviewLabels(language);
    const previewId = `${panel.id}-update-preview`;
    const footer = document.createElement("tfoot");
    footer.classList.add("filterbar-clock-bar__update-preview-footer");

    const actionRow = document.createElement("tr");
    const actionCell = document.createElement("td");
    actionCell.colSpan = 2;
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.classList.add("filterbar-clock-bar__update-preview-open");
    openButton.dataset.testid = "filterbar-admin-update-preview-open";
    openButton.setAttribute("aria-controls", previewId);
    openButton.setAttribute("aria-expanded", panel.dataset.updatePreviewOpen || "false");
    openButton.textContent = labels.open;
    openButton.classList.toggle("filterbar-clock-bar__version-info--update-available",
        versionInfo?.update_status === "available" && versionInfo?.update_available === true
            && !versionInfo?.client_check_failed_at);
    actionCell.appendChild(openButton);
    actionRow.appendChild(actionCell);

    const previewRow = document.createElement("tr");
    previewRow.hidden = panel.dataset.updatePreviewOpen !== "true";
    const previewCell = document.createElement("td");
    previewCell.colSpan = 2;
    const preview = document.createElement("section");
    preview.id = previewId;
    preview.classList.add("filterbar-clock-bar__update-preview");
    preview.dataset.testid = "filterbar-admin-update-preview";
    preview.setAttribute("aria-label", labels.title);

    const title = document.createElement("h3");
    title.textContent = labels.title;
    const noInstall = document.createElement("p");
    noInstall.classList.add("filterbar-clock-bar__update-preview-notice");
    noInstall.textContent = labels.noInstall;
    preview.append(title, noInstall);
    const versionLabels = resolveVersionInfoLabels(language);
    appendPreviewFact(preview, labels.currentVersion,
        versionInfo?.app_version ? `v. ${versionInfo.app_version}` : versionLabels.channelUnknown);
    appendPreviewFact(preview, labels.availableVersion,
        versionInfo?.latest_stable_version ? `v. ${versionInfo.latest_stable_version}`
            : versionLabels.updateUnavailable);
    for (const { label, value } of buildAdminUpdateCheckRows(versionInfo, language)) {
        appendPreviewFact(preview, label, value);
    }
    appendPreviewFact(preview, labels.targetDatabase, labels.notChecked);
    appendPreviewFact(preview, labels.targetMigrations, labels.notChecked);

    const databaseCompatibility = typeof versionInfo?.db_compatible !== "boolean"
        ? labels.notChecked : versionInfo.db_compatible
            ? labels.databaseCompatible : labels.databaseIncompatible;
    appendPreviewFact(
        preview,
        labels.database,
        `v. ${versionInfo?.db_version || "?"} / v. ${versionInfo?.required_db_version || "?"} — ${databaseCompatibility}`,
    );
    const runningOnly = document.createElement("p");
    runningOnly.textContent = labels.runningOnly;
    preview.appendChild(runningOnly);
    if (canShowAdminUpdateDryRun(versionInfo)) {
        appendPreviewFact(preview, labels.availability, labels.interruptionExpected);
        const commandLabel = document.createElement("strong");
        commandLabel.textContent = labels.dryRun;
        const command = document.createElement("code");
        command.textContent = `${UPDATE_DRY_RUN_COMMAND} --version ${versionInfo.latest_stable_version}`;
        const limits = document.createElement("p");
        limits.textContent = labels.dryRunLimits;
        preview.append(commandLabel, command, limits);
    } else {
        // The neutral operator guidance stands in for the command; beside it, it would contradict the command.
        const operatorGuidance = document.createElement("p");
        operatorGuidance.textContent = labels.siteOperator;
        preview.appendChild(operatorGuidance);
    }
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.classList.add("filterbar-clock-bar__update-preview-close");
    closeButton.textContent = labels.close;
    closeButton.dataset.testid = "filterbar-admin-update-preview-close";
    preview.appendChild(closeButton);
    previewCell.appendChild(preview);
    previewRow.appendChild(previewCell);
    footer.append(actionRow, previewRow);
    panel.appendChild(footer);

    const setPreviewOpen = (isOpen) => {
        previewRow.hidden = !isOpen;
        panel.dataset.updatePreviewOpen = String(isOpen);
        openButton.setAttribute("aria-expanded", String(isOpen));
        onLayoutChange();
        if (isOpen) {
            closeButton.focus();
        } else {
            openButton.focus();
        }
    };
    openButton.addEventListener("click", () => setPreviewOpen(true));
    closeButton.addEventListener("click", () => setPreviewOpen(false));
}
