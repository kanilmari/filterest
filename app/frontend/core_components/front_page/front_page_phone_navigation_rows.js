// front_page_phone_navigation_rows.js
// Balance Home's visible dataset buttons and article links on phones.
// The available row width and each rendered label determine the flex bases.
// Keeping the controls in their original DOM parents preserves events, focus and tab order.
const CONTROLS = ':scope > :is(.hero-dataset-tabs, .front-page-article-buttons) > :is(button, a)';
const BASIS = '--home-phone-button-basis';

/** Choose the fewest ordered rows, then minimise the sum of squared unused widths. */
export function planHomeNavigationRows(widths, available, gap) {
    const count = widths.length;
    const best = Array(count + 1);
    best[count] = { rows: 0, cost: 0 };
    for (let start = count - 1; start >= 0; start--) {
        // When the last two fit together, an isolated last button is unnecessary.
        if (start === count - 1 && start > 0 && widths[start - 1] + gap + widths[start] <= available) continue;
        let used = 0;
        for (let end = start + 1; end <= count; end++) {
            used += (end === start + 1 ? 0 : gap) + widths[end - 1];
            if (used > available) break;
            if (!best[end]) continue;
            const spare = available - used;
            const rows = 1 + best[end].rows;
            const cost = spare * spare + best[end].cost;
            const current = best[start];
            if (!current || rows < current.rows || (rows === current.rows && cost < current.cost)) {
                best[start] = { end, rows, cost, extra: Math.floor(spare / (end - start)) };
            }
        }
    }
    const result = [];
    for (let start = 0; start < count;) {
        const { end, extra } = best[start];
        result.push({ start, end, extra });
        start = end;
    }
    return result;
}

/** Measure intrinsic widths without painting intermediate sizes or moving links. */
export function mountHomeNavigationRows(row) {
    const doc = row.ownerDocument;
    const view = doc.defaultView;
    let frame = 0;
    let stopped = false;
    function update() {
        frame = 0;
        const style = view.getComputedStyle(row);
        const insets = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']
            .reduce((sum, edge) => sum + (parseFloat(style[edge]) || 0), 0);
        const available = row.getBoundingClientRect().width - insets;
        if (!(available > 0)) return;
        row.setAttribute('data-measuring-navigation', '');
        const controls = [];
        const widths = [];
        for (const control of row.querySelectorAll(CONTROLS)) {
            const width = control.getBoundingClientRect().width;
            if (width > 0) { controls.push(control); widths.push(Math.min(width, available)); }
        }
        row.removeAttribute('data-measuring-navigation');
        for (const { start, end, extra } of planHomeNavigationRows(widths, available, parseFloat(style.columnGap) || 0)) {
            for (let i = start; i < end; i++) {
                // Native flex growth shares fractional pixels equally after choosing the line.
                const basis = `${widths[i] + extra}px`;
                if (controls[i].style.getPropertyValue(BASIS) !== basis) controls[i].style.setProperty(BASIS, basis);
            }
        }
        changes.takeRecords(); // The measured bases are our own style writes.
    }
    function schedule() {
        if (!stopped && !frame) frame = view.requestAnimationFrame(update);
    }
    const size = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(schedule) : null;
    function observeSizes() {
        if (!size) return;
        size.disconnect();
        size.observe(row);
        // A theme can change text metrics without changing the width of the row.
        for (const label of row.querySelectorAll('.hero-dataset-tabs__label, .front-page-article-button__label')) {
            size.observe(label);
        }
    }
    const changes = new view.MutationObserver(records => {
        if (records.some(record => record.type === 'childList')) observeSizes();
        schedule();
    });
    changes.observe(row, { childList: true, characterData: true, subtree: true,
        attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    observeSizes();
    view.addEventListener('resize', schedule);
    doc.fonts?.addEventListener('loadingdone', schedule);
    update();
    return () => {
        stopped = true;
        changes.disconnect();
        size?.disconnect();
        if (frame) view.cancelAnimationFrame(frame);
        view.removeEventListener('resize', schedule);
        doc.fonts?.removeEventListener('loadingdone', schedule);
        for (const control of row.querySelectorAll(CONTROLS)) {
            if (!control.style.getPropertyValue(BASIS)) continue;
            control.style.removeProperty(BASIS);
            if (!control.style.length) control.removeAttribute('style');
        }
    };
}
