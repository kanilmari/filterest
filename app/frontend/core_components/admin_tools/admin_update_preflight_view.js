// admin_update_preflight_view.js
// Builds a read-only Filterest update preview inside the administrator site-information panel.
// Bridges verified release metadata with the existing command-line updater's operational contract.
// Exists so an administrator can assess an available update without starting or simulating installation.

const UPDATE_DRY_RUN_COMMAND = "./filterest update --dry-run";

const UPDATE_PREVIEW_LABELS = Object.freeze({
    fi: {
        open: "Päivitä…",
        title: "Päivityksen esitarkistus",
        noInstall: "Tästä näkymästä ei asenneta eikä muuteta mitään.",
        currentVersion: "Nykyinen versio",
        availableVersion: "Saatavilla oleva versio",
        database: "Nykyinen tietokanta",
        databaseCompatible: "Yhteensopiva nykyisen sovelluksen kanssa",
        databaseIncompatible: "Ei yhteensopiva nykyisen sovelluksen kanssa",
        availability: "Palvelun saatavuus",
        interruptionExpected: "Nykyinen komentorivipäivitys pysäyttää palvelun varmuuskopioinnin ja asennuksen ajaksi.",
        dryRun: "Komentorivin kuivaharjoittelu",
        commandLineOnly: "Varsinainen asennus tehdään edelleen vain palvelimen komentoriviltä.",
        close: "Sulje esitarkistus",
    },
    en: {
        open: "Update…",
        title: "Update preview",
        noInstall: "Nothing is installed or changed from this view.",
        currentVersion: "Current version",
        availableVersion: "Available version",
        database: "Current database",
        databaseCompatible: "Compatible with the running application",
        databaseIncompatible: "Not compatible with the running application",
        availability: "Service availability",
        interruptionExpected: "The current command-line updater stops the service during backup and installation.",
        dryRun: "Command-line dry run",
        commandLineOnly: "Installation remains available only from the server command line.",
        close: "Close preview",
    },
    ch: {
        open: "更新…",
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
        commandLineOnly: "实际安装仍只能通过服务器命令行完成。",
        close: "关闭预检",
    },
    zhTW: {
        open: "更新…",
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
        commandLineOnly: "實際安裝仍只能從伺服器命令列執行。",
        close: "關閉預檢",
    },
    zhHK: {
        open: "更新…",
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
        commandLineOnly: "實際安裝仍只能從伺服器命令列執行。",
        close: "關閉預檢",
    },
    yue: {
        open: "更新…",
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
        commandLineOnly: "實際安裝仍然只可以由伺服器命令列執行。",
        close: "關閉預檢",
    },
});

function resolveUpdatePreviewLabels(language = "en") {
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

/**
 * Reports whether verified release metadata supports a passive update preview.
 * This is a presentation guard only: it never authorizes or starts an update.
 *
 * @param {object} versionInfo
 * @returns {boolean}
 */
export function canShowAdminUpdatePreview(versionInfo) {
    const normalizedRuntimeMode = String(versionInfo?.runtime_mode || "").trim().toLowerCase();
    return versionInfo?.update_available === true
        && versionInfo?.public_distribution === true
        && String(versionInfo?.product_name || "").trim().toLowerCase() === "filterest"
        && String(versionInfo?.release_channel || "").trim().toLowerCase() === "stable"
        && String(versionInfo?.artifact_purpose || "").trim().toLowerCase() === "public_release"
        && String(versionInfo?.artifact_type || "").trim().toLowerCase() === "runtime"
        && String(versionInfo?.release_maturity || "").trim().toLowerCase() === "published"
        && String(versionInfo?.identity_verification || "").trim().toLowerCase()
            === "local_contract_validated"
        && ["docker", "native"].includes(normalizedRuntimeMode)
        && Boolean(String(versionInfo?.app_version || "").trim())
        && Boolean(String(versionInfo?.latest_stable_version || "").trim())
        && Boolean(String(versionInfo?.latest_release_url || "").trim());
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
    if (!canShowAdminUpdatePreview(versionInfo)) return;

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
    openButton.setAttribute("aria-expanded", "false");
    openButton.textContent = labels.open;
    actionCell.appendChild(openButton);
    actionRow.appendChild(actionCell);

    const previewRow = document.createElement("tr");
    previewRow.hidden = true;
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
    appendPreviewFact(preview, labels.currentVersion, `v. ${versionInfo.app_version}`);
    appendPreviewFact(preview, labels.availableVersion, `v. ${versionInfo.latest_stable_version}`);

    const databaseCompatibility = versionInfo?.db_compatible === true
        ? labels.databaseCompatible
        : labels.databaseIncompatible;
    appendPreviewFact(
        preview,
        labels.database,
        `v. ${versionInfo.db_version} / v. ${versionInfo.required_db_version} — ${databaseCompatibility}`,
    );
    appendPreviewFact(preview, labels.availability, labels.interruptionExpected);

    const commandLabel = document.createElement("strong");
    commandLabel.textContent = labels.dryRun;
    const command = document.createElement("code");
    command.textContent = UPDATE_DRY_RUN_COMMAND;
    const commandLineOnly = document.createElement("p");
    commandLineOnly.textContent = labels.commandLineOnly;
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.classList.add("filterbar-clock-bar__update-preview-close");
    closeButton.textContent = labels.close;
    preview.append(commandLabel, command, commandLineOnly, closeButton);
    previewCell.appendChild(preview);
    previewRow.appendChild(previewCell);
    footer.append(actionRow, previewRow);
    panel.appendChild(footer);

    const setPreviewOpen = (isOpen) => {
        previewRow.hidden = !isOpen;
        actionRow.hidden = isOpen;
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
