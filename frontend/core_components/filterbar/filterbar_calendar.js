// filterbar_calendar.js
// Lightweight calendar popup for the filterbar clock bar date element.
// Shows the current month grid with ISO week numbers in a left column.
// No external dependencies — reuses the same ISO week algorithm as filter_bar_builder.js.

const MONTH_LABELS = {
    fi: ["tammikuu","helmikuu","maaliskuu","huhtikuu","toukokuu","kesäkuu",
         "heinäkuu","elokuu","syyskuu","lokakuu","marraskuu","joulukuu"],
    en: ["January","February","March","April","May","June",
         "July","August","September","October","November","December"],
    ch: ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"],
    yue: ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"],
};

const DAY_HEADERS = {
    fi: ["Ma","Ti","Ke","To","Pe","La","Su"],
    en: ["Mo","Tu","We","Th","Fr","Sa","Su"],
    ch: ["一","二","三","四","五","六","日"],
    yue: ["一","二","三","四","五","六","日"],
};

const WEEK_COL_LABEL = { fi: "vk", en: "wk", ch: "周", yue: "週" };

function isoWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dow = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dow);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Builds a self-contained calendar popup element.
 * @param {function(): string} getLang — returns current language code (fi/en/ch/yue)
 * @returns {{ el: HTMLElement, showForToday: function }}
 */
export function buildCalendarPopup(getLang) {
    const popup = document.createElement("div");
    popup.classList.add("filterbar-calendar");

    let viewYear, viewMonth;

    function render(year, month) {
        viewYear = year;
        viewMonth = month;
        popup.innerHTML = "";

        const lang = getLang();
        const monthNames = MONTH_LABELS[lang] || MONTH_LABELS.en;
        const dayHeaders = DAY_HEADERS[lang] || DAY_HEADERS.en;
        const wkLabel = WEEK_COL_LABEL[lang] || "wk";

        // ── Header ──────────────────────────────────────────────────
        const header = document.createElement("div");
        header.classList.add("filterbar-calendar__header");

        function makeNavBtn(text, deltaMonths, deltaYears) {
            const btn = document.createElement("button");
            btn.textContent = text;
            btn.classList.add("filterbar-calendar__nav");
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const d = new Date(viewYear + deltaYears, viewMonth + deltaMonths, 1);
                render(d.getFullYear(), d.getMonth());
            });
            return btn;
        }

        const title = document.createElement("span");
        title.classList.add("filterbar-calendar__title");
        title.textContent = `${monthNames[month]} ${year}`;

        header.appendChild(makeNavBtn("«", 0, -1));
        header.appendChild(makeNavBtn("‹", -1, 0));
        header.appendChild(title);
        header.appendChild(makeNavBtn("›", 1, 0));
        header.appendChild(makeNavBtn("»", 0, 1));
        popup.appendChild(header);

        // ── Day grid ─────────────────────────────────────────────────
        const grid = document.createElement("div");
        grid.classList.add("filterbar-calendar__grid");

        // Week-number column header
        const wkHead = document.createElement("div");
        wkHead.classList.add("filterbar-calendar__cell", "filterbar-calendar__cell--wk-header");
        wkHead.textContent = wkLabel;
        grid.appendChild(wkHead);

        // Weekday headers (Mon–Sun)
        dayHeaders.forEach(d => {
            const cell = document.createElement("div");
            cell.classList.add("filterbar-calendar__cell", "filterbar-calendar__cell--day-header");
            cell.textContent = d;
            grid.appendChild(cell);
        });

        // Day cells — always 6 rows so the calendar height never changes.
        // Cells outside the current month show neighbour-month day numbers dimmed.
        const today = new Date();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDayDow = new Date(year, month, 1).getDay(); // 0=Sun
        const startOffset = (firstDayDow + 6) % 7; // shift to Mon=0

        let dayNum = 1 - startOffset; // may start negative (days from prev month)

        const currentWeekNum = isoWeek(today);

        for (let row = 0; row < 6; row++) {
            // ISO week number based on the actual date of this row's Monday
            const rowDate = new Date(year, month, dayNum);
            const wkNum = isoWeek(rowDate);
            const isCurrentWeek = wkNum === currentWeekNum
                && rowDate.getFullYear() === today.getFullYear();

            const wkCell = document.createElement("div");
            wkCell.classList.add("filterbar-calendar__cell", "filterbar-calendar__cell--wk");
            if (isCurrentWeek) wkCell.classList.add("filterbar-calendar__cell--current-week");
            wkCell.textContent = wkNum;
            grid.appendChild(wkCell);

            for (let col = 0; col < 7; col++, dayNum++) {
                const cell = document.createElement("div");
                cell.classList.add("filterbar-calendar__cell");
                if (isCurrentWeek) cell.classList.add("filterbar-calendar__cell--current-week");

                const cellDate = new Date(year, month, dayNum);
                cell.textContent = cellDate.getDate();

                if (dayNum >= 1 && dayNum <= daysInMonth) {
                    if (
                        dayNum === today.getDate() &&
                        month === today.getMonth() &&
                        year === today.getFullYear()
                    ) {
                        cell.classList.add("filterbar-calendar__cell--today");
                    }
                } else {
                    cell.classList.add("filterbar-calendar__cell--neighbour");
                }

                grid.appendChild(cell);
            }
        }

        popup.appendChild(grid);
    }

    const now = new Date();
    render(now.getFullYear(), now.getMonth());

    return {
        el: popup,
        /** Re-render to current month (call when re-opening). */
        showForToday() {
            const n = new Date();
            render(n.getFullYear(), n.getMonth());
        },
    };
}
