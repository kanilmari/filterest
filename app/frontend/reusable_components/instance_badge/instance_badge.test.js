// instance_badge.test.js
// Proves the instance badge's owner-worded line, Helsinki times, states and failure silence (K523).
// Connects a mocked /api/instance-info answer to the real DOM the badge draws.
// Protects production-like silence: any failed or foreign answer draws nothing.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
    ENDPOINT, STATE_KEY, badgeLanguage, describeInstance, formatHelsinkiTime, loadBadgeStyle, readBadgeState,
    startInstanceBadge,
} from './instance_badge.js';

const MAIN = {
    kind: 'mirror',
    source: { type: 'main', commit: '3b95d8c7', committed_at: '2026-10-24T14:36:00Z' },
    data: { source: 'nightly', backup_at: '2026-10-24T01:20:00Z' },
    refreshed_at: '2026-10-24T15:05:00Z',
};
const STACK = {
    kind: 'preview',
    source: { type: 'stack', items: [
        { batch: '564', commit: 'c1f0a2b4', committed_at: '2026-10-23T12:02:00Z' },
        { batch: '565', commit: '7d3e9a10', committed_at: '2026-10-23T12:40:00Z' },
    ] },
    data: { source: 'nightly', backup_at: '2026-10-23T01:20:00Z' },
    refreshed_at: '2026-10-23T13:10:00Z',
};

function answer(body, status = 200) {
    return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
}

function fakeWindow(fetch, storage = window.localStorage) {
    return { document, fetch, localStorage: storage, MutationObserver: window.MutationObserver };
}

// jsdom loads no stylesheets, so the badge's own stylesheet is stubbed as loaded unless a test says otherwise.
const start = (win, loadStyle = async () => true) => startInstanceBadge(win, loadStyle);

beforeEach(() => {
    document.documentElement.lang = 'fi';
    window.localStorage.clear();
});

afterEach(() => {
    document.getElementById('instance-badge')?.remove();
    document.querySelectorAll('link[data-instance-badge-style]').forEach((link) => link.remove());
});

describe('times', () => {
    test('Europe/Helsinki in summer and winter time, with the language separator', () => {
        expect(formatHelsinkiTime('2026-10-24T01:20:00Z', 'fi')).toBe('24.10. 04.20');
        expect(formatHelsinkiTime('2026-10-24T01:20:00Z', 'en')).toBe('24.10. 04:20');
        expect(formatHelsinkiTime('2026-12-03T22:05:00Z', 'fi')).toBe('4.12. 00.05');
        expect(formatHelsinkiTime('2026-12-03T22:05:00Z', 'fi', false)).toBe('00.05');
    });

    test('a missing or invalid time gives nothing', () => {
        expect(formatHelsinkiTime('', 'fi')).toBe('');
        expect(formatHelsinkiTime(undefined, 'fi')).toBe('');
        expect(formatHelsinkiTime('not a time', 'fi')).toBe('');
    });
});

describe('the collapsed line and expanded rows', () => {
    test('18154 on main, in the owner\'s words', () => {
        const { line, rows } = describeInstance(MAIN, 'fi');
        expect(line).toBe('ESIKATSELU · päähaara 3b95d8c7 · data peilattu 24.10. 04.20');
        expect(rows).toEqual([
            ['Lähde', 'päähaara 3b95d8c7 (24.10. 17.36)'], ['Data', 'yön varmuuskopio 24.10. 04.20'],
            ['Päivitetty', '24.10. 18.05'], ['Aikavyöhyke', 'Europe/Helsinki'],
        ]);
    });

    test('a stack lists its batches, and English is the UI equivalent', () => {
        expect(describeInstance(STACK, 'fi').line).toBe('ESIKATSELU · erät 564 + 565 · data peilattu 23.10. 04.20');
        expect(describeInstance(STACK, 'fi').rows.slice(0, 2)).toEqual([
            ['Erä 564', 'c1f0a2b4 (23.10. 15.02)'], ['Erä 565', '7d3e9a10 (23.10. 15.40)'],
        ]);
        expect(describeInstance(STACK, 'en').line).toBe('PREVIEW · batches 564 + 565 · data mirrored 23.10. 04:20');
        const one = { ...STACK, source: { type: 'stack', items: [STACK.source.items[0]] } };
        expect(describeInstance(one, 'fi').line).toBe('ESIKATSELU · erä 564 · data peilattu 23.10. 04.20');
    });

    test('one worktree or branch, and data copied from 18154', () => {
        const copy = { source: 'copy', backup_at: '2026-10-24T01:20:00Z', copied_at: '2026-10-24T15:10:00Z' };
        const worktree = { kind: 'preview', source: { type: 'worktree', name: 'filterest-m531', commit: 'abcdef12' }, data: copy };
        expect(describeInstance(worktree, 'fi').line)
            .toBe('ESIKATSELU · työpuu filterest-m531 · data peilattu 24.10. 04.20, kopioitu 18154:stä 18.10');
        expect(describeInstance(worktree, 'fi').rows).toContainEqual(['Data', 'kopio 18154:stä 24.10. 18.10 (varmuuskopio 24.10. 04.20)']);
        expect(describeInstance(worktree, 'fi').rows).toContainEqual(['Työpuu', 'filterest-m531 abcdef12']);
        const branch = { kind: 'preview', source: { type: 'branch', name: 'm531-instance-badge' } };
        expect(describeInstance(branch, 'en').line).toBe('PREVIEW · branch m531-instance-badge');
    });

    test('an unknown record still says it is not production', () => {
        expect(describeInstance({ kind: 'unknown' }, 'fi')).toEqual({
            line: 'ESIKATSELU · tiedot puuttuvat', rows: [['Lähde', 'tiedot puuttuvat'], ['Aikavyöhyke', 'Europe/Helsinki']],
        });
    });

    test('the language follows <html lang>', () => {
        for (const [lang, expected] of [['fi', 'fi'], ['fi-FI', 'fi'], ['en', 'en'], ['sv', 'en'], ['', 'en']]) {
            document.documentElement.lang = lang;
            expect(badgeLanguage(document)).toBe(expected);
        }
    });
});

describe('mounting', () => {
    test('a failed, refused or foreign answer draws nothing', async () => {
        for (const fetch of [answer({}, 404), answer({ kind: 'mirror' }, 500), answer(null), answer('text'), answer({ kind: 7 }),
            answer({ kind: 'production' }), answer({ kind: '' }),
            vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('not JSON'); } })),
            vi.fn(async () => { throw new Error('offline'); })]) {
            expect(await start(fakeWindow(fetch))).toBeNull();
            expect(document.getElementById('instance-badge')).toBeNull();
        }
    });

    test('the badge mounts only after its own stylesheet has loaded', async () => {
        expect(await start(fakeWindow(answer(MAIN)), async () => false)).toBeNull();
        expect(document.getElementById('instance-badge')).toBeNull();
        let release;
        const pending = start(fakeWindow(answer(MAIN)), () => new Promise((resolve) => { release = resolve; }));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(document.getElementById('instance-badge')).toBeNull();
        release(true);
        expect(await pending).toBe(document.getElementById('instance-badge'));
    });

    test('the stylesheet is added by the module and reports load or failure', async () => {
        const loaded = loadBadgeStyle(document, '/frontend/reusable_components/instance_badge/instance_badge.css');
        const link = document.querySelector('link[data-instance-badge-style]');
        expect(link.getAttribute('rel')).toBe('stylesheet');
        expect(link.getAttribute('href')).toBe('/frontend/reusable_components/instance_badge/instance_badge.css');
        link.dispatchEvent(new Event('load'));
        expect(await loaded).toBe(true);
        const failed = loadBadgeStyle(document, '/missing.css');
        const second = document.querySelector('link[href="/missing.css"]');
        second.dispatchEvent(new Event('error'));
        expect(await failed).toBe(false);
        expect(document.querySelector('link[href="/missing.css"]')).toBeNull();
    });

    test('asks the endpoint without caching', async () => {
        const fetch = answer(MAIN);
        await start(fakeWindow(fetch));
        expect(fetch).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }));
    });

    test('collapsed, expanded and dot states with real buttons, remembered and keyboard-focused', async () => {
        const host = await start(fakeWindow(answer(MAIN)));
        expect(host.className).toBe('ib');
        expect(host.querySelector('.ib__text').textContent).toBe('ESIKATSELU · päähaara 3b95d8c7 · data peilattu 24.10. 04.20');
        const [toggle, minimise] = host.querySelectorAll('button.ib__btn');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(toggle.getAttribute('aria-label')).toBe('Näytä esikatselun tiedot');
        expect(minimise.getAttribute('aria-label')).toBe('Pienennä pisteeksi');

        toggle.focus();
        toggle.click();
        const expandedToggle = host.querySelector('button.ib__btn');
        expect(host.querySelector('.ib__card dl.ib__rows').textContent).toContain('Europe/Helsinki');
        expect(expandedToggle.getAttribute('aria-expanded')).toBe('true');
        expect(expandedToggle.getAttribute('aria-controls')).toBe(host.querySelector('dl').id);
        expect(document.activeElement).toBe(expandedToggle);
        expect(window.localStorage.getItem(STATE_KEY)).toBe('expanded');

        host.querySelectorAll('button.ib__btn')[1].click();
        expect(host.className).toBe('ib ib--dot');
        const dot = host.querySelector('button.ib__dot-btn');
        expect(dot.getAttribute('aria-label')).toBe('Näytä esikatselun tiedot');
        expect(document.activeElement).toBe(dot);
        expect(window.localStorage.getItem(STATE_KEY)).toBe('dot');

        dot.click();
        expect(host.className).toBe('ib');
        expect(host.querySelector('.ib__text')).not.toBeNull();
        expect(window.localStorage.getItem(STATE_KEY)).toBe('collapsed');

        host.querySelector('.ib__text').click();
        expect(host.querySelector('.ib__card')).not.toBeNull();
    });

    test('a remembered dot comes back as a dot, and a second start adds no second badge', async () => {
        window.localStorage.setItem(STATE_KEY, 'dot');
        const host = await start(fakeWindow(answer(MAIN)));
        expect(host.className).toBe('ib ib--dot');
        expect(await start(fakeWindow(answer(MAIN)))).toBeNull();
        expect(document.querySelectorAll('#instance-badge')).toHaveLength(1);
    });

    test('blocked storage still draws the collapsed line', async () => {
        const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
        expect(readBadgeState(blocked)).toBe('collapsed');
        expect(readBadgeState({ getItem: () => 'open' })).toBe('collapsed');
        const host = await start(fakeWindow(answer(MAIN), blocked));
        host.querySelector('button.ib__btn').click();
        expect(host.querySelector('.ib__card')).not.toBeNull();
    });

    test('values are text, never markup', async () => {
        const hostile = { kind: 'preview', source: { type: 'branch', name: '<img src=x onerror=alert(1)>' } };
        const host = await start(fakeWindow(answer(hostile)));
        expect(host.querySelector('img')).toBeNull();
        expect(host.querySelector('.ib__text').textContent).toBe('ESIKATSELU · haara <img src=x onerror=alert(1)>');
    });

    test('a language change on <html lang> redraws the badge', async () => {
        const host = await start(fakeWindow(answer(MAIN)));
        document.documentElement.lang = 'en';
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(host.querySelector('.ib__text').textContent).toBe('PREVIEW · main 3b95d8c7 · data mirrored 24.10. 04:20');
        expect(host.getAttribute('aria-label')).toBe('Preview details');
    });
});
