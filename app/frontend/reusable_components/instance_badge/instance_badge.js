// instance_badge.js
// Draws the bottom-left instance badge of a mirror or preview instance (PREVIEW_LANE_V2_PLAN §2.2, K523).
// Bridges the read-only /api/instance-info answer with one line, an expanded card and a minimised dot.
// Exists only where the runtime flag is on: production never loads this module, and a failed answer draws nothing.

export const ENDPOINT = '/api/instance-info';
export const STATE_KEY = 'filterest_instance_badge_state';
export const TIME_ZONE = 'Europe/Helsinki';
const STATES = ['collapsed', 'expanded', 'dot'];
const KINDS = ['mirror', 'preview', 'unknown'];
const BADGE_ID = 'instance-badge';
// The stylesheet is added by this module, never by the page: a parser-inserted <link> in the head would block the
// page's own modules while it loads (gate 531a).
const STYLE_URL = new URL('./instance_badge.css', import.meta.url).href;

// The owner's label (§2.2), with its English UI equivalent.
const TEXTS = {
    fi: {
        label: 'ESIKATSELU', main: 'päähaara', batch: 'erä', batches: 'erät', worktree: 'työpuu', branch: 'haara',
        dataMirrored: 'data peilattu', copiedFrom: 'kopioitu 18154:stä', unknown: 'tiedot puuttuvat',
        sourceRow: 'Lähde', batchRow: 'Erä', worktreeRow: 'Työpuu', branchRow: 'Haara', dataRow: 'Data',
        nightly: 'yön varmuuskopio', copy: 'kopio 18154:stä', backup: 'varmuuskopio', refreshedRow: 'Päivitetty',
        zoneRow: 'Aikavyöhyke', region: 'Esikatselun tiedot', expand: 'Näytä esikatselun tiedot',
        collapse: 'Piilota esikatselun tiedot', minimise: 'Pienennä pisteeksi',
    },
    en: {
        label: 'PREVIEW', main: 'main', batch: 'batch', batches: 'batches', worktree: 'worktree', branch: 'branch',
        dataMirrored: 'data mirrored', copiedFrom: 'copied from 18154', unknown: 'details unavailable',
        sourceRow: 'Source', batchRow: 'Batch', worktreeRow: 'Worktree', branchRow: 'Branch', dataRow: 'Data',
        nightly: 'nightly backup', copy: 'copy of 18154', backup: 'backup', refreshedRow: 'Refreshed',
        zoneRow: 'Time zone', region: 'Preview details', expand: 'Show preview details',
        collapse: 'Hide preview details', minimise: 'Minimise to a dot',
    },
};

/** The page language the badge follows: Finnish for `fi`, English otherwise. */
export function badgeLanguage(doc = document) {
    return String(doc.documentElement.lang || '').toLowerCase().split('-')[0] === 'fi' ? 'fi' : 'en';
}

/** Formats an RFC 3339 time in Europe/Helsinki: `24.10. 04.20` (fi) or `24.10. 04:20` (en); "" when invalid. */
export function formatHelsinkiTime(value, language, withDate = true) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '';
    const parts = {};
    const format = new Intl.DateTimeFormat('en-GB', {
        timeZone: TIME_ZONE, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    for (const part of format.formatToParts(date)) parts[part.type] = part.value;
    const time = `${parts.hour}${language === 'fi' ? '.' : ':'}${parts.minute}`;
    // en-GB pads "numeric" day and month; the Finnish date has no leading zeros (4.12.).
    return withDate ? `${Number(parts.day)}.${Number(parts.month)}. ${time}` : time;
}

function withTime(text, value, language) {
    const time = formatHelsinkiTime(value, language);
    return time ? `${text} (${time})` : text;
}

/** Turns the endpoint's answer into the collapsed line and the expanded rows; every value is plain text. */
export function describeInstance(info, language) {
    const t = TEXTS[language] || TEXTS.en;
    const segments = [t.label];
    const rows = [];
    const source = info && typeof info.source === 'object' ? info.source : null;
    const items = Array.isArray(source?.items) ? source.items.filter((item) => item && item.batch && item.commit) : [];
    if (source?.type === 'main' && source.commit) {
        segments.push(`${t.main} ${source.commit}`);
        rows.push([t.sourceRow, withTime(`${t.main} ${source.commit}`, source.committed_at, language)]);
    } else if (source?.type === 'stack' && items.length) {
        segments.push(`${items.length === 1 ? t.batch : t.batches} ${items.map((item) => item.batch).join(' + ')}`);
        for (const item of items) rows.push([`${t.batchRow} ${item.batch}`, withTime(item.commit, item.committed_at, language)]);
    } else if ((source?.type === 'worktree' || source?.type === 'branch') && source.name) {
        segments.push(`${t[source.type]} ${source.name}`);
        const commit = source.commit ? `${source.name} ${source.commit}` : source.name;
        rows.push([t[`${source.type}Row`], withTime(commit, source.committed_at, language)]);
    }
    const data = info && typeof info.data === 'object' ? info.data : null;
    if (data) {
        const backup = formatHelsinkiTime(data.backup_at, language);
        const copied = data.source === 'copy' ? formatHelsinkiTime(data.copied_at, language) : '';
        const copiedTime = data.source === 'copy' ? formatHelsinkiTime(data.copied_at, language, false) : '';
        const line = [backup && `${t.dataMirrored} ${backup}`, copiedTime && `${t.copiedFrom} ${copiedTime}`].filter(Boolean);
        if (line.length) segments.push(line.join(', '));
        if (data.source === 'copy') {
            rows.push([t.dataRow, [copied && `${t.copy} ${copied}`, backup && `(${t.backup} ${backup})`].filter(Boolean).join(' ') || t.copy]);
        } else {
            rows.push([t.dataRow, backup ? `${t.nightly} ${backup}` : t.nightly]);
        }
    }
    if (segments.length === 1) {
        segments.push(t.unknown);
        rows.push([t.sourceRow, t.unknown]);
    }
    const refreshed = formatHelsinkiTime(info?.refreshed_at, language);
    if (refreshed) rows.push([t.refreshedRow, refreshed]);
    rows.push([t.zoneRow, TIME_ZONE]);
    return { line: segments.join(' · '), rows };
}

/** The remembered badge state; blocked or foreign storage gives the collapsed line. */
export function readBadgeState(storage) {
    try {
        const value = storage?.getItem(STATE_KEY);
        return STATES.includes(value) ? value : 'collapsed';
    } catch {
        return 'collapsed';
    }
}

function writeBadgeState(storage, state) {
    try {
        storage?.setItem(STATE_KEY, state);
    } catch { /* Blocked storage: the state lasts for this page only. */ }
}

function element(doc, tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(doc, className, text, label, focusKey) {
    const node = element(doc, 'button', className, text);
    node.type = 'button';
    node.setAttribute('aria-label', label);
    node.dataset.ibFocus = focusKey;
    return node;
}

/**
 * Draws the badge into `host` (the fixed .ib element) for one state. `setState` receives the next state and the
 * control that should keep keyboard focus after the redraw.
 */
export function renderBadge(host, description, language, state, setState) {
    const doc = host.ownerDocument;
    const t = TEXTS[language] || TEXTS.en;
    host.replaceChildren();
    host.className = state === 'dot' ? 'ib ib--dot' : 'ib';
    host.setAttribute('aria-label', t.region);
    if (state === 'dot') {
        const restore = button(doc, 'ib__dot-btn', undefined, t.expand, 'toggle');
        restore.title = description.line;
        restore.append(element(doc, 'span', 'ib__dot'));
        restore.addEventListener('click', () => setState('collapsed', 'toggle'));
        host.append(restore);
        return;
    }
    const expanded = state === 'expanded';
    const line = element(doc, 'div', 'ib__line');
    const text = element(doc, 'span', 'ib__text', description.line);
    text.title = description.line;
    text.addEventListener('click', () => setState(expanded ? 'collapsed' : 'expanded', 'toggle'));
    const toggle = button(doc, 'ib__btn', expanded ? '▾' : '▸', expanded ? t.collapse : t.expand, 'toggle');
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.addEventListener('click', () => setState(expanded ? 'collapsed' : 'expanded', 'toggle'));
    const minimise = button(doc, 'ib__btn', '–', t.minimise, 'minimise');
    minimise.title = t.minimise;
    minimise.addEventListener('click', () => setState('dot', 'toggle'));
    line.append(text, toggle, minimise);
    if (!expanded) {
        host.append(line);
        return;
    }
    const rows = element(doc, 'dl', 'ib__rows');
    rows.id = `${BADGE_ID}-rows`;
    toggle.setAttribute('aria-controls', rows.id);
    for (const [term, value] of description.rows) rows.append(element(doc, 'dt', '', term), element(doc, 'dd', '', value));
    const card = element(doc, 'div', 'ib__card');
    card.append(line, rows);
    host.append(card);
}

/** Adds the badge's stylesheet; resolves true once it has loaded and false if it fails (the link is then removed). */
export function loadBadgeStyle(doc, href = STYLE_URL) {
    return new Promise((resolve) => {
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.instanceBadgeStyle = '';
        link.addEventListener('load', () => resolve(true), { once: true });
        link.addEventListener('error', () => { link.remove(); resolve(false); }, { once: true });
        doc.head.append(link);
    });
}

function storageOf(win) {
    try {
        return win.localStorage;
    } catch {
        return null;
    }
}

/**
 * Fetches the instance info and mounts the badge once its stylesheet has loaded; resolves to the badge element, or null
 * when nothing is drawn. A pending stylesheet leaves the badge unmounted, never the page.
 */
export async function startInstanceBadge(win = window, loadStyle = loadBadgeStyle) {
    const doc = win.document;
    if (doc.getElementById(BADGE_ID)) return null;
    const styled = loadStyle(doc);
    let info;
    try {
        const response = await win.fetch(ENDPOINT, {
            cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' },
        });
        if (!response.ok) return null;
        info = await response.json();
    } catch {
        return null;
    }
    if (!info || typeof info !== 'object' || !KINDS.includes(info.kind)) return null;
    if (!(await styled) || doc.getElementById(BADGE_ID)) return null;
    const storage = storageOf(win);
    const host = doc.createElement('aside');
    host.id = BADGE_ID;
    host.dataset.testid = 'instance-badge';
    let state = readBadgeState(storage);
    const draw = (focusKey) => {
        const language = badgeLanguage(doc);
        renderBadge(host, describeInstance(info, language), language, state, (next, nextFocus) => {
            state = next;
            writeBadgeState(storage, next);
            draw(nextFocus);
        });
        if (focusKey) host.querySelector(`[data-ib-focus="${focusKey}"]`)?.focus();
    };
    draw(null);
    doc.body.append(host);
    if (typeof win.MutationObserver === 'function') {
        // The language selector changes <html lang> without a reload; the badge follows it.
        new win.MutationObserver(() => draw(host.contains(doc.activeElement) ? 'toggle' : null))
            .observe(doc.documentElement, { attributes: true, attributeFilter: ['lang'] });
    }
    return host;
}

// The templates import this module from a nonce'd loader script carrying data-instance-badge, only when the runtime
// flag is on, through a caught dynamic import: its load and evaluation errors reject that import instead of reaching
// the shell's start-up error handling (gate 531b). The badge is optional, so no rejection may escape here either.
if (typeof document !== 'undefined' && document.querySelector('script[data-instance-badge]')) {
    startInstanceBadge().catch(() => {});
}
