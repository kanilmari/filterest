// admin_version_info_formatter.js
// Formats localized administrator version facts and release-check evidence.
// Bridges endpoint snapshots with the indicator and its single information table.
// Exists so cache age, failed attempts and last success share one presentation contract.

import { formatSiteNameForDisplay } from "../state_stores/site_identity_reader.js";
import { getTranslationForKey } from "../lang/translation_handler.js";
import {
    ADMIN_VERSION_INFO_COPY_KEYS,
    ADMIN_VERSION_INFO_TRANSLATION_FALLBACKS,
} from "./admin_version_info_translation_fallbacks.js";

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
        lastSuccess: "Viimeisin onnistunut tarkistus",
        checkResult: "Tarkistuksen tulos",
        checkState: "Tiedon tuoreus",
        freshCheck: "Tuore tarkistus onnistui",
        cachedCheck: "Välimuistin tulos",
        failedCheck: "Tarkistus epäonnistui; aiempi tulos on vanhentunut",
        unknownCheck: "Ei onnistunutta tarkistusta",
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
        lastSuccess: "Last successful check",
        checkResult: "Check result",
        checkState: "Information freshness",
        freshCheck: "Fresh check succeeded",
        cachedCheck: "Cached result",
        failedCheck: "Check failed; previous result is stale",
        unknownCheck: "No successful check",
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
        checkingAgain: "檢查緊…",
        checkFailed: "檢查失敗",
        loading: "載入緊…",
        compatible: "相容",
        incompatible: "不相容",
    },
});

function resolveExistingVersionInfoLabels(language = "en") {
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

/** Reads changed copy through the shared catalog, preserving existing identity translations. */
export function resolveVersionInfoLabels(language = "en") {
    const existing = resolveExistingVersionInfoLabels(language);
    const fallbackLanguage = Object.keys(VERSION_LABELS)
        .find((key) => VERSION_LABELS[key] === existing) || "en";
    const labels = { ...VERSION_LABELS.en, ...existing };
    for (const [label, key] of Object.entries(ADMIN_VERSION_INFO_COPY_KEYS)) {
        const copy = ADMIN_VERSION_INFO_TRANSLATION_FALLBACKS[key];
        labels[label] = getTranslationForKey(key, { fallback: copy[fallbackLanguage] || copy.en });
    }
    return labels;
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

function formatUpdateStatus(versionInfo, labels) {
    const statuses = {
        available: labels.updateAvailable,
        current: labels.updateCurrent,
        ahead_of_stable: labels.updateAhead,
        unavailable: labels.updateUnavailable,
    };
    return statuses[String(versionInfo?.update_status || "unavailable").trim().toLowerCase()]
        || labels.updateUnavailable;
}

function formatLatestStableStatus(versionInfo, labels) {
    const latestVersion = String(versionInfo?.latest_stable_version || "").trim();
    return latestVersion ? `v. ${latestVersion}` : labels.channelUnknown;
}

function resolveVersionInfoDateLocale(language = "en") {
    const normalizedLanguage = String(language || "en").trim().toLowerCase().replaceAll("_", "-");
    if (normalizedLanguage === "ch" || normalizedLanguage.startsWith("ch-")) return "zh-CN";
    if (normalizedLanguage === "yue" || normalizedLanguage.startsWith("yue-")) return "yue-HK";
    return normalizedLanguage || "en";
}

export function formatUpdateCheckedAt(value, language = "en") {
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

/** Combines release/readiness facts with distinct attempt and success evidence for the table. */
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
    const latestStableIndex = rows.findIndex(({ id }) => id === "latest-stable");
    rows.splice(latestStableIndex + 1, 0, ...buildAdminUpdateCheckRows(versionInfo, language));
    const normalizedSiteName = formatSiteNameForDisplay(siteName);
    if (normalizedSiteName) {
        rows.unshift({ id: "site", label: labels.site, value: normalizedSiteName });
    }
    return Object.freeze(rows);
}

/** Uses the same translated evidence for the closed tooltip and accessible indicator name. */
export function formatAdminVersionInfoLabel(versionInfo, language = "en") {
    return buildAdminVersionInfoRows(versionInfo, language)
        .map(({ label, value }) => `${label} ${value}`)
        .join("\n");
}

/** Shows check evidence once, combining attempt and success only for the same instant. */
export function buildAdminUpdateCheckRows(versionInfo, language = "en") {
    const labels = resolveVersionInfoLabels(language);
    const successTime = versionInfo?.last_successful_check_at
        || (versionInfo?.update_status !== "unavailable" ? versionInfo?.update_checked_at : "");
    const successful = Boolean(formatUpdateCheckedAt(successTime, language));
    const failed = versionInfo?.update_status === "unavailable"
        || Boolean(versionInfo?.client_check_failed_at);
    const attemptTime = versionInfo?.client_check_failed_at || versionInfo?.update_checked_at;
    let state = labels.unknownCheck;
    if (failed && formatUpdateCheckedAt(attemptTime, language)) {
        state = successful ? labels.failedCheck : labels.checkFailed;
        if (!versionInfo?.client_check_failed_at && versionInfo?.upstream_check_performed === false) {
            state = `${labels.cachedCheck} — ${formatCheckAge(attemptTime, language)}; ${state}`;
        }
    } else if (successful) {
        state = versionInfo?.upstream_check_performed === true ? labels.freshCheck
            : `${labels.cachedCheck} — ${formatCheckAge(successTime, language)}`;
    }
    const rows = [
        { id: "check-result", label: labels.checkResult,
            value: formatUpdateStatus(versionInfo, labels) },
        { id: "check-state", label: labels.checkState, value: state },
    ];
    const checkedAt = formatUpdateCheckedAt(attemptTime, language);
    if (successful && checkedAt && Date.parse(attemptTime) === Date.parse(successTime)) {
        rows.push({ id: "checked-successfully", label: labels.checkedSuccessfully, value: checkedAt });
    } else {
        if (checkedAt) rows.push({ id: "last-checked", label: labels.lastChecked, value: checkedAt });
        rows.push({ id: "last-success", label: labels.lastSuccess,
            value: formatUpdateCheckedAt(successTime, language) || labels.unknownCheck });
    }
    return rows;
}

function formatCheckAge(value, language) {
    const ageSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
    const unit = ageSeconds >= 3600 ? "hour" : ageSeconds >= 60 ? "minute" : "second";
    const amount = Math.floor(ageSeconds / (unit === "hour" ? 3600 : unit === "minute" ? 60 : 1));
    return new Intl.RelativeTimeFormat(resolveVersionInfoDateLocale(language)).format(-amount, unit);
}
