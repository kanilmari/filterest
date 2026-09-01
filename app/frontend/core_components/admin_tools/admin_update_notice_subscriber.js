// admin_update_notice_subscriber.js
// Renders and maintains the persistent administrator production-update toast.
// Bridges the protected bounded SSE stream, browser lifecycle, and localized banner UI.
// Exists so administrators can save work before a deployment drain or restart.
// PIPELINE_EXCEPTION: EventSource is a bounded server-sent stream, not a finite request/response API call.

import { getLanguageWithBrowserFallback } from "../state_stores/lang_preference_reader.js";
import { hasRoutePermission } from "../route_permission_checker.js";
import { showToast } from "../../reusable_components/notifications/toast_notification_printer.js";
import { getButtonState } from "./auth_mode_handler.js";

export const ADMIN_UPDATE_NOTICE_STREAM_ROUTE = "/api/admin/update-notice/stream";

const BANNER_ID = "adminProductionUpdateNotice";
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 15000;
const MAX_UNOPENED_FAILURES = 5;

const UPDATE_NOTICE_LABELS = Object.freeze({
    fi: Object.freeze({
        markerAnnounced: "Päivitys tulossa",
        markerDraining: "Päivitys alkaa",
        titleAnnounced: "Sivustopäivitys alkaa pian",
        titleDraining: "Sivustopäivitys käynnistyy nyt",
        save: "Tallenna keskeneräiset työsi ennen päivitystä.",
        outage: "Palvelu voi olla hetken poissa käytöstä, ja kirjautumista voidaan pyytää uudelleen.",
        details: "Tiedot",
        hideDetails: "Piilota tiedot",
        dismiss: "Sulje",
        plannedTime: "Arvioitu aloitus",
        now: "nyt",
    }),
    en: Object.freeze({
        markerAnnounced: "Update scheduled",
        markerDraining: "Update starting",
        titleAnnounced: "A site update will begin soon",
        titleDraining: "The site update is starting now",
        save: "Save any unfinished work before the update.",
        outage: "The service may be briefly unavailable, and you may be asked to sign in again.",
        details: "Details",
        hideDetails: "Hide details",
        dismiss: "Dismiss",
        plannedTime: "Estimated start",
        now: "now",
    }),
    zh: Object.freeze({
        markerAnnounced: "即将更新",
        markerDraining: "更新即将开始",
        titleAnnounced: "网站更新即将开始",
        titleDraining: "网站更新正在启动",
        save: "请在更新前保存尚未完成的工作。",
        outage: "服务可能会短暂不可用，并且可能需要重新登录。",
        details: "详情",
        hideDetails: "隐藏详情",
        dismiss: "关闭",
        plannedTime: "预计开始时间",
        now: "现在",
    }),
});

let subscriberRunning = false;
let pageUnloadInProgress = false;
let eventSource = null;
let reconnectTimer = null;
let countdownTimer = null;
let reconnectDelayMs = BASE_RECONNECT_DELAY_MS;
let unopenedFailures = 0;
let lifecycleListenersInstalled = false;
let currentSnapshot = null;
let serverClockAnchor = null;
let noticeToastHandle = null;
let dismissedSnapshotKey = null;

function snapshotDismissalKey(snapshot) {
    return `${snapshot.notice_id}:${snapshot.state}:${snapshot.updated_at}`;
}

function resolveLabels() {
    const language = String(getLanguageWithBrowserFallback() || "en").toLowerCase();
    if (language.startsWith("fi")) return UPDATE_NOTICE_LABELS.fi;
    if (language === "ch" || language.startsWith("zh") || language.startsWith("yue")) {
        return UPDATE_NOTICE_LABELS.zh;
    }
    return UPDATE_NOTICE_LABELS.en;
}

function authenticatedAdminRouteIsVerified() {
    try {
        return getButtonState() === "logout" && hasRoutePermission(ADMIN_UPDATE_NOTICE_STREAM_ROUTE);
    } catch {
        return false;
    }
}

function clearReconnectTimer() {
    if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function clearCountdownTimer() {
    if (countdownTimer !== null) {
        clearInterval(countdownTimer);
        countdownTimer = null;
    }
}

function closeEventSource() {
    eventSource?.close();
    eventSource = null;
}

function removeBanner() {
    clearCountdownTimer();
    if (noticeToastHandle) {
        noticeToastHandle.dismiss({ immediate: true });
        noticeToastHandle = null;
        return;
    }
    document.getElementById(BANNER_ID)?.remove();
}

function estimatedServerTimeMs() {
    if (!serverClockAnchor) return Date.now();
    return serverClockAnchor.serverTimeMs + Math.max(0, performance.now() - serverClockAnchor.performanceTimeMs);
}

export function formatUpdateNoticeCountdown(deadlineMs, nowMs, labels = resolveLabels()) {
    const remainingSeconds = Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
    if (remainingSeconds === 0) return labels.now;
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = remainingSeconds % 60;
    if (hours > 0) return `${hours} h ${minutes} min`;
    if (minutes > 0) return `${minutes} min ${seconds} s`;
    return `${seconds} s`;
}

function updateBannerCountdown() {
    if (!currentSnapshot) return;
    const nowMs = estimatedServerTimeMs();
    const expiresAtMs = Date.parse(currentSnapshot.expires_at);
    if (Number.isFinite(expiresAtMs) && nowMs >= expiresAtMs) {
        currentSnapshot = null;
        serverClockAnchor = null;
        removeBanner();
        return;
    }
    const countdown = document.querySelector(`#${BANNER_ID} [data-update-notice-countdown]`);
    if (!countdown) return;
    const startsAtMs = Date.parse(currentSnapshot.starts_at);
    if (!Number.isFinite(startsAtMs)) return;
    countdown.textContent = formatUpdateNoticeCountdown(startsAtMs, nowMs);
}

function ensureBanner(labels) {
    let banner = document.getElementById(BANNER_ID);
    if (banner?.getAttribute("aria-hidden") === "true") {
        banner.remove();
        banner = null;
    }
    if (banner) return banner;

    const content = document.createElement("div");
    content.className = "admin-update-notice__content";
    content.innerHTML = `
        <div class="admin-update-notice__main">
            <span class="admin-update-notice__marker" data-update-notice-marker></span>
            <strong class="admin-update-notice__title" data-update-notice-title></strong>
            <span class="admin-update-notice__countdown" data-update-notice-countdown></span>
            <button class="admin-update-notice__details-toggle" type="button" aria-expanded="false"></button>
        </div>
        <div class="admin-update-notice__details" data-update-notice-details hidden>
            <p data-update-notice-save></p>
            <p data-update-notice-outage></p>
            <p><strong data-update-notice-planned-label></strong> <time data-update-notice-planned-time></time></p>
        </div>`;
    noticeToastHandle = showToast({
        content,
        level: "warning",
        autoClose: false,
        position: "top-center",
        variant: "attention",
        dismissOnClick: false,
        dismissLabel: labels.dismiss,
    });
    banner = noticeToastHandle.element;
    banner.id = BANNER_ID;
    banner.classList.add("admin-update-notice");
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");

    banner.querySelector(".toast-notification-close").addEventListener("click", () => {
        if (currentSnapshot) dismissedSnapshotKey = snapshotDismissalKey(currentSnapshot);
        noticeToastHandle = null;
    });

    const toggle = banner.querySelector(".admin-update-notice__details-toggle");
    toggle.addEventListener("click", () => {
        const details = banner.querySelector("[data-update-notice-details]");
        const expanded = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", String(!expanded));
        details.hidden = expanded;
        const labels = resolveLabels();
        toggle.textContent = expanded ? labels.details : labels.hideDetails;
    });
    return banner;
}

function isValidSnapshot(snapshot) {
    const expectedKeys = [
        "schema_version", "notice_id", "state", "announced_at",
        "starts_at", "expires_at", "updated_at", "server_time",
    ];
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
    if (Object.keys(snapshot).some((key) => !expectedKeys.includes(key))) return false;
    if (snapshot.schema_version !== 1 || !["announced", "draining", "cleared"].includes(snapshot.state)) return false;
    return expectedKeys.every((key) => Object.hasOwn(snapshot, key));
}

export function renderAdminUpdateNoticeSnapshot(snapshot) {
    if (!isValidSnapshot(snapshot)) return false;

    const serverTimeMs = Date.parse(snapshot.server_time);
    const expiresAtMs = Date.parse(snapshot.expires_at);
    if (snapshot.state === "cleared" || !Number.isFinite(serverTimeMs) ||
        (Number.isFinite(expiresAtMs) && serverTimeMs >= expiresAtMs)) {
        currentSnapshot = null;
        serverClockAnchor = null;
        dismissedSnapshotKey = null;
        removeBanner();
        return true;
    }

    const startsAtMs = Date.parse(snapshot.starts_at);
    if (!Number.isFinite(startsAtMs) || !Number.isFinite(expiresAtMs)) return false;
    currentSnapshot = { ...snapshot };
    serverClockAnchor = {
        serverTimeMs,
        performanceTimeMs: performance.now(),
    };
    if (dismissedSnapshotKey === snapshotDismissalKey(snapshot)) {
        return true;
    }

    const labels = resolveLabels();
    const banner = ensureBanner(labels);
    const draining = snapshot.state === "draining";
    banner.dataset.state = snapshot.state;
    banner.querySelector("[data-update-notice-marker]").textContent = draining
        ? labels.markerDraining
        : labels.markerAnnounced;
    banner.querySelector("[data-update-notice-title]").textContent = draining
        ? labels.titleDraining
        : labels.titleAnnounced;
    banner.querySelector("[data-update-notice-save]").textContent = labels.save;
    banner.querySelector("[data-update-notice-outage]").textContent = labels.outage;
    banner.querySelector("[data-update-notice-planned-label]").textContent = `${labels.plannedTime}:`;
    const plannedTime = banner.querySelector("[data-update-notice-planned-time]");
    plannedTime.dateTime = snapshot.starts_at;
    plannedTime.textContent = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(startsAtMs));
    const toggle = banner.querySelector(".admin-update-notice__details-toggle");
    banner.querySelector(".toast-notification-close").setAttribute("aria-label", labels.dismiss);
    toggle.textContent = toggle.getAttribute("aria-expanded") === "true"
        ? labels.hideDetails
        : labels.details;

    clearCountdownTimer();
    const countdown = banner.querySelector("[data-update-notice-countdown]");
    countdown.hidden = draining;
    if (draining) {
        countdown.textContent = "";
    } else {
        updateBannerCountdown();
        countdownTimer = setInterval(updateBannerCountdown, 1000);
    }
    return true;
}

function scheduleReconnect() {
    clearReconnectTimer();
    if (!subscriberRunning || pageUnloadInProgress || document.visibilityState === "hidden") return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectAdminUpdateNoticeStream();
    }, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
}

function connectAdminUpdateNoticeStream() {
    clearReconnectTimer();
    closeEventSource();
    if (!subscriberRunning || pageUnloadInProgress || document.visibilityState === "hidden") return;

    let opened = false;
    eventSource = new EventSource(ADMIN_UPDATE_NOTICE_STREAM_ROUTE);
    eventSource.addEventListener("update_notice", (event) => {
        try {
            renderAdminUpdateNoticeSnapshot(JSON.parse(event.data));
        } catch (error) {
            console.warn("admin update notice snapshot was invalid", error);
        }
    });
    eventSource.addEventListener("access_revoked", () => {
        stopAdminUpdateNoticeSubscriber();
    });
    eventSource.onopen = () => {
        opened = true;
        unopenedFailures = 0;
        reconnectDelayMs = BASE_RECONNECT_DELAY_MS;
    };
    eventSource.onerror = () => {
        closeEventSource();
        if (!opened) unopenedFailures += 1;
        if (unopenedFailures >= MAX_UNOPENED_FAILURES) {
            stopAdminUpdateNoticeSubscriber();
            return;
        }
        scheduleReconnect();
    };
}

function installLifecycleListeners() {
    if (lifecycleListenersInstalled) return;
    lifecycleListenersInstalled = true;
    window.addEventListener("beforeunload", () => {
        pageUnloadInProgress = true;
        clearReconnectTimer();
        closeEventSource();
    });
    window.addEventListener("pagehide", () => {
        clearReconnectTimer();
        closeEventSource();
    });
    window.addEventListener("pageshow", () => {
        pageUnloadInProgress = false;
        if (subscriberRunning) connectAdminUpdateNoticeStream();
    });
    window.addEventListener("online", () => {
        if (subscriberRunning) connectAdminUpdateNoticeStream();
    });
    document.addEventListener("visibilitychange", () => {
        if (!subscriberRunning) return;
        if (document.visibilityState === "hidden") {
            clearReconnectTimer();
            closeEventSource();
        } else {
            connectAdminUpdateNoticeStream();
        }
    });
}

export function startAdminUpdateNoticeSubscriber() {
    installLifecycleListeners();
    if (!authenticatedAdminRouteIsVerified()) {
        stopAdminUpdateNoticeSubscriber();
        return false;
    }
    subscriberRunning = true;
    pageUnloadInProgress = false;
    unopenedFailures = 0;
    reconnectDelayMs = BASE_RECONNECT_DELAY_MS;
    connectAdminUpdateNoticeStream();
    return true;
}

export function syncAdminUpdateNoticeSubscriber() {
    if (!authenticatedAdminRouteIsVerified()) {
        stopAdminUpdateNoticeSubscriber();
        return false;
    }
    if (!subscriberRunning) return startAdminUpdateNoticeSubscriber();
    return true;
}

export function stopAdminUpdateNoticeSubscriber() {
    subscriberRunning = false;
    clearReconnectTimer();
    closeEventSource();
    currentSnapshot = null;
    serverClockAnchor = null;
    dismissedSnapshotKey = null;
    removeBanner();
}
