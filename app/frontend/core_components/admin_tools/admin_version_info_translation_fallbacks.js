// admin_version_info_translation_fallbacks.js
// Supplies reviewed fallback copy for the administrator's release-check view.
// Connects language-key readers with installations awaiting the matching seed migration.
// Keeps site translations authoritative while Finnish and English remain usable offline.

export const ADMIN_VERSION_INFO_COPY_KEYS = Object.freeze({
    checkAgain: "admin_version_info_check_releases",
    requiredDatabase: "admin_version_info_required_by_running_app",
    lastChecked: "admin_version_info_last_attempt",
    checkedSuccessfully: "admin_version_info_checked_successfully",
    refreshAllowed: "admin_version_info_check_allowed_at",
    siteOperator: "admin_version_info_site_operator_updates",
});

export const ADMIN_VERSION_INFO_TRANSLATION_FALLBACKS = Object.freeze({
    admin_version_info_check_releases: {
        fi: "Tarkista julkaisut", en: "Check releases",
    },
    admin_version_info_required_by_running_app: {
        fi: "Käynnissä olevan sovelluksen vaatima", en: "Required by the running application",
        ch: "当前运行的应用程序所需版本", zhTW: "目前執行中的應用程式所需版本",
        zhHK: "目前運行的應用程式所需版本", yue: "目前運行緊嘅應用程式所需版本",
    },
    admin_version_info_last_attempt: {
        fi: "Viimeisin tarkistusyritys", en: "Last check attempt",
        ch: "上次检查尝试", zhTW: "上次檢查嘗試", zhHK: "上次檢查嘗試", yue: "上次嘗試檢查",
    },
    admin_version_info_checked_successfully: {
        fi: "Tarkistettu onnistuneesti", en: "Checked successfully",
    },
    admin_version_info_check_allowed_at: {
        fi: "Julkaisujen tarkistus sallittu", en: "Release check available at",
    },
    admin_version_info_site_operator_updates: {
        fi: "Päivitykset tekee toistaiseksi sivuston ylläpitäjä palvelimella.",
        en: "Updates are currently performed by the site operator.",
    },
});
