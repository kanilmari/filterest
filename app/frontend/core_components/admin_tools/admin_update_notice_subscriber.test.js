// admin_update_notice_subscriber.test.js
// Verifies the bounded administrator update-notice subscriber and fixed banner UI.
// Bridges protected route state, cross-instance snapshots, browser lifecycle, and countdowns.
// Exists to keep deployment warnings durable without trusting operator-provided display text.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const hasRoutePermissionMock = vi.fn();
const getButtonStateMock = vi.fn();
const getLanguageMock = vi.fn();

let eventSources;
let moduleUnderTest;
let visibilityState;

class FakeEventSource {
    constructor(url) {
        this.url = url;
        this.listeners = new Map();
        this.close = vi.fn();
        this.onopen = null;
        this.onerror = null;
        eventSources.push(this);
    }

    addEventListener(eventName, listener) {
        this.listeners.set(eventName, listener);
    }

    emit(eventName, data = null) {
        this.listeners.get(eventName)?.({
            data: data === null ? "" : JSON.stringify(data),
        });
    }
}

function snapshot(overrides = {}) {
    return {
        schema_version: 1,
        notice_id: "release-2026-08-24",
        state: "announced",
        announced_at: "2026-08-24T10:00:00Z",
        starts_at: "2026-08-24T10:10:00Z",
        expires_at: "2026-08-24T10:30:00Z",
        updated_at: "2026-08-24T10:00:00Z",
        server_time: "2026-08-24T10:00:00Z",
        ...overrides,
    };
}

async function loadModule() {
    vi.resetModules();
    vi.doMock("../state_stores/lang_preference_reader.js", () => ({
        getLanguageWithBrowserFallback: getLanguageMock,
    }));
    vi.doMock("../route_permission_checker.js", () => ({
        hasRoutePermission: hasRoutePermissionMock,
    }));
    vi.doMock("./auth_mode_handler.js", () => ({
        getButtonState: getButtonStateMock,
    }));
    globalThis.EventSource = FakeEventSource;
    moduleUnderTest = await import("./admin_update_notice_subscriber.js");
    return moduleUnderTest;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    eventSources = [];
    moduleUnderTest = null;
    visibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => visibilityState,
    });
    document.body.innerHTML = "<main id=\"app\"></main>";
    localStorage.clear();
    localStorage.setItem("button_state", "logout");
    hasRoutePermissionMock.mockReturnValue(true);
    getButtonStateMock.mockReturnValue("logout");
    getLanguageMock.mockReturnValue("en");
});

afterEach(() => {
    moduleUnderTest?.stopAdminUpdateNoticeSubscriber();
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete globalThis.EventSource;
});

describe("administrator update-notice subscriber", () => {
    test("starts only after verified administrator bootstrap", async () => {
        const mod = await loadModule();
        hasRoutePermissionMock.mockReturnValue(false);

        expect(mod.syncAdminUpdateNoticeSubscriber()).toBe(false);
        expect(eventSources).toHaveLength(0);

        hasRoutePermissionMock.mockReturnValue(true);
        expect(mod.syncAdminUpdateNoticeSubscriber()).toBe(true);
        expect(eventSources).toHaveLength(1);
        expect(eventSources[0].url).toBe(mod.ADMIN_UPDATE_NOTICE_STREAM_ROUTE);
    });

    test("renders persistent fixed copy and accepts a newer cross-instance state", async () => {
        const mod = await loadModule();
        mod.startAdminUpdateNoticeSubscriber();

        eventSources[0].emit("update_notice", snapshot());
        const banner = document.getElementById("adminProductionUpdateNotice");
        expect(banner?.dataset.state).toBe("announced");
        expect(banner?.dataset.toastVariant).toBe("attention");
        expect(banner?.parentElement?.dataset.toastPosition).toBe("top-center");
        expect(banner?.textContent).toContain("A site update will begin soon");
        expect(banner?.textContent).not.toContain("release-2026-08-24");

        eventSources[0].emit("update_notice", snapshot({
            state: "draining",
            updated_at: "2026-08-24T10:09:00Z",
            server_time: "2026-08-24T10:09:00Z",
        }));
        expect(banner?.dataset.state).toBe("draining");
        expect(banner?.textContent).toContain("The site update is starting now");
        expect(banner?.textContent.match(/\bnow\b/g)).toHaveLength(1);
        expect(banner?.querySelector("[data-update-notice-countdown]")?.hidden).toBe(true);

        eventSources[0].emit("update_notice", snapshot({
            state: "cleared",
            updated_at: "2026-08-24T10:11:00Z",
            server_time: "2026-08-24T10:11:00Z",
        }));
        expect(document.getElementById("adminProductionUpdateNotice")).toBeNull();
    });

    test("stays until user dismissal and returns for a newer update state", async () => {
        const mod = await loadModule();
        mod.renderAdminUpdateNoticeSnapshot(snapshot());
        const announced = document.getElementById("adminProductionUpdateNotice");

        vi.advanceTimersByTime(60000);
        expect(document.getElementById("adminProductionUpdateNotice")).toBe(announced);
        announced?.querySelector(".admin-update-notice__details-toggle")?.click();
        expect(document.getElementById("adminProductionUpdateNotice")).toBe(announced);

        announced?.querySelector(".toast-notification-close")?.click();
        expect(mod.renderAdminUpdateNoticeSnapshot(snapshot())).toBe(true);
        expect(document.getElementById("adminProductionUpdateNotice")?.getAttribute("aria-hidden")).toBe("true");

        expect(mod.renderAdminUpdateNoticeSnapshot(snapshot({
            state: "draining",
            updated_at: "2026-08-24T10:09:00Z",
            server_time: "2026-08-24T10:09:00Z",
        }))).toBe(true);
        expect(document.getElementById("adminProductionUpdateNotice")?.dataset.state).toBe("draining");
        expect(document.getElementById("adminProductionUpdateNotice")?.getAttribute("aria-hidden")).toBeNull();
        vi.advanceTimersByTime(300);
        expect(document.getElementById("adminProductionUpdateNotice")?.dataset.state).toBe("draining");
    });

    test.each([
        ["fi-FI", "Sivustopäivitys alkaa pian", "Tallenna keskeneräiset työsi", "Sulje"],
        ["zh-CN", "网站更新即将开始", "请在更新前保存", "关闭"],
        ["sv-SE", "A site update will begin soon", "Save any unfinished work", "Dismiss"],
    ])("uses fixed localized copy for %s", async (language, title, savePrompt, dismissLabel) => {
        getLanguageMock.mockReturnValue(language);
        const mod = await loadModule();

        expect(mod.renderAdminUpdateNoticeSnapshot(snapshot())).toBe(true);
        const text = document.getElementById("adminProductionUpdateNotice")?.textContent;
        expect(text).toContain(title);
        expect(text).toContain(savePrompt);
        expect(document.querySelector(".toast-notification-close")?.getAttribute("aria-label")).toBe(dismissLabel);
    });

    test("advances the countdown from the monotonic server-time anchor", async () => {
        const performanceNow = vi.spyOn(performance, "now").mockReturnValue(100);
        const mod = await loadModule();
        const nearSnapshot = snapshot({ starts_at: "2026-08-24T10:00:10Z" });

        mod.renderAdminUpdateNoticeSnapshot(nearSnapshot);
        expect(document.querySelector("[data-update-notice-countdown]")?.textContent).toBe("10 s");

        performanceNow.mockReturnValue(3100);
        vi.advanceTimersByTime(1000);
        expect(document.querySelector("[data-update-notice-countdown]")?.textContent).toBe("7 s");
    });

    test("removes an expired notice from monotonic server time without a new event", async () => {
        const performanceNow = vi.spyOn(performance, "now").mockReturnValue(100);
        const mod = await loadModule();

        mod.renderAdminUpdateNoticeSnapshot(snapshot({
            starts_at: "2026-08-24T10:00:02Z",
            expires_at: "2026-08-24T10:00:05Z",
        }));
        expect(document.getElementById("adminProductionUpdateNotice")).not.toBeNull();

        performanceNow.mockReturnValue(5100);
        vi.advanceTimersByTime(1000);
        expect(document.getElementById("adminProductionUpdateNotice")).toBeNull();
    });

    test("closes while hidden and reconnects on visibility, pageshow, and online", async () => {
        const mod = await loadModule();
        mod.startAdminUpdateNoticeSubscriber();
        expect(eventSources).toHaveLength(1);

        visibilityState = "hidden";
        document.dispatchEvent(new Event("visibilitychange"));
        expect(eventSources[0].close).toHaveBeenCalledTimes(1);

        visibilityState = "visible";
        document.dispatchEvent(new Event("visibilitychange"));
        expect(eventSources).toHaveLength(2);

        window.dispatchEvent(new Event("pagehide"));
        expect(eventSources[1].close).toHaveBeenCalledTimes(1);
        window.dispatchEvent(new Event("pageshow"));
        expect(eventSources).toHaveLength(3);

        window.dispatchEvent(new Event("online"));
        expect(eventSources[2].close).toHaveBeenCalledTimes(1);
        expect(eventSources).toHaveLength(4);
    });

    test("reconnects after the bounded server stream closes", async () => {
        const mod = await loadModule();
        mod.startAdminUpdateNoticeSubscriber();
        eventSources[0].onopen();

        eventSources[0].onerror();
        expect(eventSources[0].close).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(999);
        expect(eventSources).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(eventSources).toHaveLength(2);
    });

    test("stops immediately when the stream reports revoked access", async () => {
        const mod = await loadModule();
        mod.startAdminUpdateNoticeSubscriber();
        eventSources[0].emit("update_notice", snapshot());

        eventSources[0].emit("access_revoked");

        expect(eventSources[0].close).toHaveBeenCalled();
        expect(document.getElementById("adminProductionUpdateNotice")).toBeNull();
        window.dispatchEvent(new Event("online"));
        expect(eventSources).toHaveLength(1);
    });
});
