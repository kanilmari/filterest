// filterbar_clock_builder.js
// Builds the sidebar clock and calendar footer.
// Connects the shared dataset filterbar to its existing component builders.
// Keeps one implementation and a bounded lifetime for each mounted surface.

import { getLanguageWithBrowserFallback } from "../state_stores/lang_preference_reader.js";
import { buildCalendarPopup } from "./filterbar_calendar.js";
import { buildAdminVersionInfoIndicator } from "../admin_tools/admin_version_info_indicator.js";

// Kielen koodi → Intl-lokaali kellotaululle
const LANG_TO_LOCALE = { fi: "fi-FI", en: "en-GB", ch: "zh-CN", yue: "yue-Hant-HK" };

// Kielen koodi → lokalisoitu "viikko"-sana kellotauluun
const WEEK_LABELS = { fi: "viikko", en: "week", ch: "周", yue: "星期" };

// Tooltip for the clock time element — shows timezone and how to change it
const TZ_TIPS = {
    fi: (tz) => `Aikavyöhyke: ${tz}\nAikaa voi muuttaa käyttöjärjestelmän tai selaimen asetuksista.`,
    en: (tz) => `Time zone: ${tz}\nTo change the time, update your operating system or browser settings.`,
    ch: (tz) => `时区：${tz}\n如需修改时间，请更改操作系统或浏览器的设置。`,
    yue: (tz) => `時區：${tz}\n如果要更改時間，請更新作業系統或者瀏覽器設定。`,
};

function formatIsoCalendarDate(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone,
    }).formatToParts(date);

    const year = parts.find((part) => part.type === "year")?.value ?? "0000";
    const month = parts.find((part) => part.type === "month")?.value ?? "00";
    const day = parts.find((part) => part.type === "day")?.value ?? "00";

    return `${year}-${month}-${day}`;
}

/**
 * Returns which occurrence (1–5) of the weekday the given date is within its month.
 * E.g. the 2nd Sunday → 2.
 */
function getWeekdayOccurrenceInMonth(date) {
    return Math.floor((date.getDate() - 1) / 7) + 1;
}

/**
 * Returns a localized tooltip string describing the weekday occurrence in the month.
 * E.g. fi: "Kuukauden 2. tiistai", en: "2nd Tuesday of the month"
 */
function buildOccurrenceTip(date, locale, lang) {
    const n = getWeekdayOccurrenceInMonth(date);
    const weekdayName = date.toLocaleDateString(locale, { weekday: "long" });
    if (lang === "fi") {
        return `Kuukauden ${n}. ${weekdayName}`;
    }
    if (lang === "ch") {
        return `本月第${n}个${weekdayName}`;
    }
    const ordinals = ["1st", "2nd", "3rd", "4th", "5th"];
    return `${ordinals[n - 1] || `${n}th`} ${weekdayName} of the month`;
}

/**
 * Returns the ISO 8601 week number for the given date.
 * Week 1 is the week containing the first Thursday of the year.
 */
function getISOWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayOfWeek = d.getUTCDay() || 7; // Mon=1 … Sun=7
    d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek); // nearest Thursday
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Builds the clock strip shown at the very bottom of the filterbar sidebar.
 * Displays locale-aware weekday, ISO week number, date and timezone-corrected time (with seconds).
 * Returns a destroyable DOM element so filterbar teardown can clean its listeners and interval.
 */
export function buildClockBar() {
    const lifetimeController = new AbortController();
    const { signal } = lifetimeController;
    const bar = document.createElement("div");
    bar.classList.add("filterbar-clock-bar", "filterbar-clock-bar--hidden");

    const contentEl = document.createElement("div");
    contentEl.classList.add("filterbar-clock-bar__content");

    const dayGroupEl = document.createElement("span");
    dayGroupEl.classList.add("filterbar-clock-bar__day-group");

    const weekdayEl = document.createElement("span");
    weekdayEl.classList.add("filterbar-clock-bar__weekday");

    const weekEl = document.createElement("span");
    weekEl.classList.add("filterbar-clock-bar__week");

    dayGroupEl.appendChild(weekdayEl);
    dayGroupEl.appendChild(weekEl);

    const dateEl = document.createElement("span");
    dateEl.classList.add("filterbar-clock-bar__date");

    const timeEl = document.createElement("span");
    timeEl.classList.add("filterbar-clock-bar__time");

    contentEl.appendChild(dayGroupEl);
    contentEl.appendChild(dateEl);
    contentEl.appendChild(timeEl);
    bar.appendChild(contentEl);
    const versionInfoIndicator = buildAdminVersionInfoIndicator();
    if (versionInfoIndicator) {
        bar.appendChild(versionInfoIndicator);
    }

    // ── Calendar popup ───────────────────────────────────────────────
    // Appended to body so it is never clipped by filterbar overflow.
    const calendar = buildCalendarPopup(() => getLanguageWithBrowserFallback());
    calendar.el.style.display = "none";
    document.body.appendChild(calendar.el);

    let calendarOpen = false;
    let deferredWidthSyncTimeout = null;
    let stableContentWidthPx = null;

    function clearDeferredWidthSync() {
        if (deferredWidthSyncTimeout) {
            clearTimeout(deferredWidthSyncTimeout);
            deferredWidthSyncTimeout = null;
        }
    }

    function setClockContentWidth(widthPx, animate = false) {
        if (!Number.isFinite(widthPx) || widthPx <= 0) {
            return;
        }

        contentEl.style.transition = animate ? "width 3s ease" : "none";
        contentEl.style.width = `${Math.ceil(widthPx)}px`;
    }

    function measureNaturalClockContentWidth() {
        if (!contentEl.isConnected || contentEl.getClientRects().length === 0) {
            return 0;
        }

        const previousWidth = contentEl.style.width;
        const previousTransition = contentEl.style.transition;
        contentEl.style.transition = "none";
        contentEl.style.width = "auto";
        const measuredWidth = Math.ceil(contentEl.getBoundingClientRect().width || contentEl.scrollWidth || 0);
        contentEl.style.width = previousWidth;
        contentEl.style.transition = previousTransition;
        return measuredWidth;
    }

    function syncClockContentWidth({ immediate = false } = {}) {
        const naturalWidthPx = measureNaturalClockContentWidth();
        if (!Number.isFinite(naturalWidthPx) || naturalWidthPx <= 0) {
            return;
        }

        if (stableContentWidthPx === null || immediate) {
            clearDeferredWidthSync();
            stableContentWidthPx = naturalWidthPx;
            setClockContentWidth(naturalWidthPx, false);
            return;
        }

        if (naturalWidthPx === stableContentWidthPx) {
            return;
        }

        const currentWidthPx = Math.ceil(contentEl.getBoundingClientRect().width) || stableContentWidthPx;
        clearDeferredWidthSync();
        setClockContentWidth(currentWidthPx, false);

        deferredWidthSyncTimeout = setTimeout(() => {
            stableContentWidthPx = naturalWidthPx;
            setClockContentWidth(naturalWidthPx, true);
            deferredWidthSyncTimeout = null;
        }, 1100);
    }

    function openCalendar() {
        calendar.showForToday();
        const rect = dateEl.getBoundingClientRect();
        const popupWidth = 260; // min-width fallback for initial placement
        let left = rect.left + rect.width / 2 - popupWidth / 2;
        // Clamp to viewport
        left = Math.max(8, Math.min(left, window.innerWidth - popupWidth - 8));
        calendar.el.style.left = `${left}px`;
        calendar.el.style.top = `${rect.top - 8}px`;
        calendar.el.style.transform = "translateY(-100%)";
        calendar.el.style.display = "";
        calendarOpen = true;
    }

    function closeCalendar() {
        calendar.el.style.display = "none";
        calendarOpen = false;
    }

    dateEl.style.cursor = "pointer";
    dateEl.addEventListener("click", (e) => {
        e.stopPropagation();
        calendarOpen ? closeCalendar() : openCalendar();
    }, { signal });

    document.addEventListener("click", (e) => {
        if (calendarOpen && !calendar.el.contains(e.target)) {
            closeCalendar();
        }
    }, { signal });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && calendarOpen) closeCalendar();
    }, { signal });

    // ── Clock tick ───────────────────────────────────────────────────
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    function tick() {
        const now = new Date();
        const lang = getLanguageWithBrowserFallback();
        const locale = LANG_TO_LOCALE[lang] || "en-GB";
        const tip = buildOccurrenceTip(now, locale, lang);
        weekdayEl.textContent = now.toLocaleDateString(locale, { weekday: "long", timeZone: tz });
        weekEl.textContent = `${WEEK_LABELS[lang] || "week"} ${getISOWeekNumber(now)}`;
        dayGroupEl.title = tip;
        dateEl.textContent = formatIsoCalendarDate(now, tz);
        timeEl.textContent = now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: tz });
        timeEl.title = (TZ_TIPS[lang] || TZ_TIPS.en)(tz);
        syncClockContentWidth();
    }

    tick();
    const intervalId = setInterval(tick, 1000);
    bar.destroy = () => {
        lifetimeController.abort();
        clearInterval(intervalId);
        clearDeferredWidthSync();
        closeCalendar();
        versionInfoIndicator?.destroy?.();
        calendar.el.remove();
    };

    return bar;
}

