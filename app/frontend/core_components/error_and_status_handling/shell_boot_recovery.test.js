// shell_boot_recovery.test.js
// Executes the exact Go-embedded guard with a controlled document and fake visible time.
// Bridges lifecycle events, CSS probes, session storage and navigation without a server.
// Protects fail-open startup and prevents retry loops or reloading after interaction.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { requireNodeDependency } from '../../../server_tools/lib/node_dependency_loader.mjs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
const source = readFileSync('backend/core_components/frontend_assets/shell_boot_recovery.js', 'utf8');
const { JSDOM } = requireNodeDependency('jsdom');
const retryKey = '__filterest_shell_boot_retry_v1:https://localhost:8082/?lang=fi#row';
const recordKey = '__filterest_shell_boot_records_v1';
let harnesses;
function storage() {
    const values = new Map();
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function boot(options = {}) {
    const dom = new JSDOM(`<html data-shell-boot-pending ${options.documentFailed ? 'data-shell-boot-document-failed' : ''} data-shell-boot-get="${options.get !== false}" data-shell-boot-dev="${!!options.dev}" data-shell-boot-probe="--filterest-shell-css-applied"><body><main data-shell-boot-content><button>Raw</button></main><div id="shell-boot-notice" hidden><p id="shell-boot-loading" hidden>Loading</p><div id="shell-boot-failed" hidden><button id="shell-boot-reload">Reload</button></div><p id="shell-boot-unsupported" hidden>Unsupported</p></div></body></html>`, { url: options.url || 'https://localhost:8082/?lang=fi#row' });
    const document = dom.window.document;
    const createElement = document.createElement.bind(document);
    document.createElement = (tag) => {
        const node = createElement(tag);
        if (tag === 'script' && !options.unsupported) node.noModule = true;
        return node;
    };
    let hidden = false;
    let css = false;
    Object.defineProperty(document, 'hidden', { get: () => hidden });
    const listeners = new Map();
    const window = {
        location: { href: dom.window.location.href, reload: vi.fn(), replace: vi.fn() },
        history: { state: { fixture: 'preserved' }, length: 2 },
        navigator: { userAgent: options.ie ? 'Trident/7.0' : 'Modern', onLine: options.offline !== true },
        sessionStorage: options.storage || storage(), localStorage: storage(), setTimeout, clearTimeout,
        getComputedStyle: () => ({ getPropertyValue: () => css ? '1' : '' }),
        addEventListener: (name, fn) => listeners.set(name, [...(listeners.get(name) || []), fn]),
        dispatchEvent: (event) => (listeners.get(event.type) || []).forEach((fn) => fn(event)),
    };
    window.history.replaceState = vi.fn((state, _, address) => {
        window.history.state = state;
        window.location.href = new URL(address, window.location.href).href;
    });
    const emit = (name, event = {}) => (listeners.get(name) || []).forEach((fn) => fn({ target: window, ...event }));
    vm.runInNewContext(source, { window, document, Date, JSON, Array, String, Math });
    document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    const result = {
        window, document, emit, dom, css: (value = true) => { css = value; },
        hide: (value) => { hidden = value; document.dispatchEvent(new dom.window.Event('visibilitychange')); },
        lifecycle: (name) => document.dispatchEvent(new dom.window.Event(name)),
        notice: (name) => !document.getElementById('shell-boot-notice').hidden && !document.getElementById('shell-boot-' + name).hidden,
        pending: () => document.documentElement.hasAttribute('data-shell-boot-pending'),
        required: (tag = 'link') => {
            const element = createElement(tag);
            element.setAttribute('data-shell-boot-required', ''); element.setAttribute('data-shell-boot-probe-link', '');
            element.href = '/frontend/dist/imports.hash.min.css?secret=hidden';
            return element;
        },
    };
    harnesses.push(result);
    return result;
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T09:00:00Z')); harnesses = []; });
afterEach(() => { harnesses.forEach((h) => h.dom.window.close()); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('shell gates and visible time', () => {
    test.each(['css', 'evaluation'])('requires both gates when %s arrives first', (first) => {
        const h = boot();
        if (first === 'css') h.css(); else h.window.__filterestShellBoot.evaluated();
        vi.advanceTimersByTime(100); expect(h.pending()).toBe(true);
        if (first === 'css') h.window.__filterestShellBoot.evaluated(); else h.css();
        vi.advanceTimersByTime(100); expect(h.pending()).toBe(false);
        expect(h.document.getElementById('shell-boot-notice').hidden).toBe(true);
        vi.advanceTimersByTime(60000); expect(h.window.location.reload).not.toHaveBeenCalled(); expect(h.notice('failed')).toBe(false);
    });
    test('ready alone never reveals unstyled controls', () => {
        const h = boot(); h.window.__filterestShellBoot.ready(); expect(h.pending()).toBe(true);
        vi.advanceTimersByTime(3000); expect(h.notice('loading')).toBe(true);
    });
    test('loading starts at three visible seconds and disappears on reveal', () => {
        const h = boot(); vi.advanceTimersByTime(2900); expect(h.notice('loading')).toBe(false);
        vi.advanceTimersByTime(100); expect(h.notice('loading')).toBe(true);
        h.css(); h.window.__filterestShellBoot.evaluated(); expect(h.notice('loading')).toBe(false);
    });
    test('hidden and frozen time do not spend the thirty-second watchdog', () => {
        const h = boot(); vi.advanceTimersByTime(1000); h.hide(true); vi.advanceTimersByTime(60000);
        expect(h.window.location.reload).not.toHaveBeenCalled(); h.hide(false); vi.advanceTimersByTime(1000);
        h.lifecycle('freeze'); vi.advanceTimersByTime(60000); h.lifecycle('resume'); vi.advanceTimersByTime(27900);
        expect(h.window.location.reload).not.toHaveBeenCalled(); vi.advanceTimersByTime(100);
        expect(h.window.location.reload).toHaveBeenCalledTimes(1);
    });
    test('pageshow rechecks probes and never rearms a revealed restored page', () => {
        const h = boot(); h.window.__filterestShellBoot.evaluated(); h.emit('pagehide'); vi.advanceTimersByTime(60000);
        h.css(); h.emit('pageshow', { persisted: true }); expect(h.pending()).toBe(false);
        h.css(false); h.emit('pagehide'); vi.advanceTimersByTime(60000); h.emit('pageshow', { persisted: true }); vi.advanceTimersByTime(60000);
        expect(h.window.location.reload).not.toHaveBeenCalled();
    });
    test('late startup ready is diagnostic only after reveal', () => {
        const h = boot({ dev: true }); h.css(); h.window.__filterestShellBoot.evaluated(); vi.advanceTimersByTime(30000);
        expect(JSON.parse(h.window.sessionStorage.getItem(recordKey)).some((entry) => entry.reason === 'ready-timeout')).toBe(true);
        expect(h.notice('failed')).toBe(false); h.window.__filterestShellBoot.ready(); expect(h.window.location.reload).not.toHaveBeenCalled();
    });
});
describe('failure and retry budget', () => {
    test('an actual registration import followed by dependency failure never signals application evaluation', async () => {
        const h = boot(); h.css();
        vi.resetModules();
        vi.doMock('../lang/translation_handler.js', () => ({ translatePage: vi.fn().mockResolvedValue() }));
        vi.doMock('../state_stores/lang_preference_reader.js', () => ({ getPreferredAvailableLanguage: () => 'fi' }));
        vi.stubGlobal('window', h.window); vi.stubGlobal('document', h.document);
        vi.stubGlobal('HTMLFormElement', h.dom.window.HTMLFormElement);
        await import('../auth/register_page_builder.js');
        expect(h.window.__filterestShellBoot.status().evaluated).toBe(false);
        h.emit('error', { error: new TypeError('following dependency failed') });
        vi.advanceTimersByTime(1500);
        expect(h.pending()).toBe(true); expect(h.window.location.reload).toHaveBeenCalledTimes(1);
        vi.doUnmock('../lang/translation_handler.js'); vi.doUnmock('../state_stores/lang_preference_reader.js');
    });
    test.each(['css', 'module', 'exception', 'rejection', 'sentinel', 'timeout', 'document'])('recovers from %s once', (kind) => {
        const h = boot({ documentFailed: kind === 'document' });
        if (kind === 'css' || kind === 'module') h.emit('error', { target: h.required(kind === 'css' ? 'link' : 'script') });
        if (kind === 'exception') h.emit('error', { message: 'missing export' });
        if (kind === 'rejection') h.emit('unhandledrejection', { reason: 'graph failure' });
        if (kind === 'sentinel') h.emit('load', { target: h.required() });
        if (kind === 'timeout') vi.advanceTimersByTime(28500);
        vi.advanceTimersByTime(1400); expect(h.window.location.reload).not.toHaveBeenCalled();
        vi.advanceTimersByTime(100); expect(h.window.location.reload).toHaveBeenCalledTimes(1);
        h.emit('error'); vi.advanceTimersByTime(60000); expect(h.window.location.reload).toHaveBeenCalledTimes(1);
    });
    test('persistent failures offer a real button and manual GET preserves budget', () => {
        const shared = storage(); const h = boot({ storage: shared }); h.emit('error'); vi.advanceTimersByTime(1500);
        const second = boot({ storage: shared }); second.emit('error'); vi.advanceTimersByTime(1500);
        expect(second.notice('failed')).toBe(true); expect(second.pending()).toBe(true);
        second.document.getElementById('shell-boot-reload').click();
        expect(second.window.location.reload).toHaveBeenCalledTimes(1);
        expect(second.window.location.href).toBe('https://localhost:8082/?lang=fi#row');
        expect(JSON.parse(shared.getItem(retryKey)).unresolved).toBe(true);
    });
    test('routing cannot change the initial retry budget or manual GET destination', () => {
        const h = boot({ offline: true });
        h.window.location.href = 'https://localhost:8082/another?lang=en';
        h.emit('error'); vi.advanceTimersByTime(1500);
        h.document.getElementById('shell-boot-reload').click();
        expect(h.window.location.reload).toHaveBeenCalledTimes(1);
        expect(h.window.location.href).toBe('https://localhost:8082/?lang=fi#row');
        h.window.navigator.onLine = true; h.emit('pageshow');
        expect(h.window.location.reload).toHaveBeenCalledTimes(1);
    });
    test('address rewriting reloads the initial URL under its original budget only once', () => {
        const shared = storage(); const h = boot({ storage: shared });
        h.window.location.href = 'https://localhost:8082/';
        h.emit('error'); vi.advanceTimersByTime(1500);
        expect(h.window.location.reload).toHaveBeenCalledTimes(1);
        expect(h.window.location.href).toBe('https://localhost:8082/?lang=fi#row');
        expect(h.window.history.state).toEqual({ fixture: 'preserved' }); expect(h.window.history.length).toBe(2);
        expect(JSON.parse(shared.getItem(retryKey)).unresolved).toBe(true);
        expect(shared.getItem('__filterest_shell_boot_retry_v1:https://localhost:8082/')).toBeNull();
        vi.advanceTimersByTime(600001);
        const second = boot({ storage: shared }); second.window.location.href = 'https://localhost:8082/';
        second.emit('error'); vi.advanceTimersByTime(1500);
        expect(second.window.location.reload).not.toHaveBeenCalled(); expect(second.notice('failed')).toBe(true);
    });
    test.each(['#row', '#'])('manual retry of a POST document preserves exact query bytes and fragment %s', (fragment) => {
        const url = 'https://localhost:8082/?lang=fi&tag=a+b&tag=a%20b&encoded=%2f&empty=&bare&submit=retry' + fragment;
        const h = boot({ get: false, url });
        h.document.body.insertAdjacentHTML('beforeend', '<form><input name="password" value="form-secret"></form>');
        h.emit('error'); vi.advanceTimersByTime(1500); h.document.getElementById('shell-boot-reload').click();
        expect(h.window.location.replace).toHaveBeenCalledWith(url);
        expect(h.window.location.href.split('#')[0]).not.toBe(url.split('#')[0]);
        expect(h.window.history.state).toEqual({ fixture: 'preserved' }); expect(h.window.history.length).toBe(2);
        expect(h.document.querySelectorAll('form')).toHaveLength(1);
        expect(h.window.location.reload).not.toHaveBeenCalled();
    });
    test.each([true, false])('manual GET preserves the captured query and empty fragment after rewriting (GET document=%s)', (get) => {
        const url = 'https://localhost:8082/failed?tag=a+b&tag=a%20b&encoded=%2f&bare#';
        const h = boot({ get, url, offline: true });
        h.window.location.href = 'https://localhost:8082/normalized?lang=en#other';
        const state = h.window.history.state;
        h.emit('error'); vi.advanceTimersByTime(1500); h.document.getElementById('shell-boot-reload').click();
        if (get) {
            expect(h.window.location.href).toBe(url); expect(h.window.location.reload).toHaveBeenCalledTimes(1);
        } else {
            expect(h.window.location.replace).toHaveBeenCalledWith(url);
            expect(h.window.history.replaceState).not.toHaveBeenCalled();
        }
        expect(h.window.history.state).toBe(state); expect(h.window.history.length).toBe(2);
    });
    test.each(['throw', 'noop'])('automatic address restoration %s offers the button with its budget reserved', (kind) => {
        const h = boot(); const rewritten = 'https://localhost:8082/normalized';
        h.window.location.href = rewritten;
        h.window.history.replaceState.mockImplementation(() => { if (kind === 'throw') throw Error('history denied'); });
        h.emit('error'); vi.advanceTimersByTime(1500);
        expect(h.window.location.reload).not.toHaveBeenCalled(); expect(h.notice('failed')).toBe(true);
        expect(h.window.location.href).toBe(rewritten);
        expect(JSON.parse(h.window.sessionStorage.getItem(retryKey)).unresolved).toBe(true);
        vi.advanceTimersByTime(600001); h.emit('pageshow'); expect(h.window.location.reload).not.toHaveBeenCalled();
    });
    test.each(['throw', 'noop'])('manual POST temporary address %s cannot fall through to fragment navigation', (kind) => {
        const h = boot({ get: false });
        h.window.history.replaceState.mockImplementation(() => { if (kind === 'throw') throw Error('history denied'); });
        h.emit('error'); vi.advanceTimersByTime(1500); h.document.getElementById('shell-boot-reload').click();
        expect(h.window.location.replace).not.toHaveBeenCalled(); expect(h.notice('failed')).toBe(true);
        expect(h.window.location.href).toBe('https://localhost:8082/?lang=fi#row');
    });
    test.each([true, false])('cancelled asynchronous manual navigation restores address and state (GET document=%s)', (get) => {
        const h = boot({ get, offline: true }); const original = h.window.location.href;
        if (get) h.window.location.href = 'https://localhost:8082/rewritten';
        const previous = h.window.location.href; const state = h.window.history.state;
        const budget = JSON.stringify({ lastAttempt: Date.now(), unresolved: true });
        h.window.sessionStorage.setItem(retryKey, budget);
        h.emit('error'); vi.advanceTimersByTime(1500); h.document.getElementById('shell-boot-reload').click();
        expect(h.window.location.href).not.toBe(previous);
        h.emit('beforeunload'); vi.advanceTimersByTime(0);
        expect(h.window.location.href).toBe(previous); expect(h.window.history.state).toBe(state);
        expect(h.window.history.length).toBe(2); expect(h.window.sessionStorage.getItem(retryKey)).toBe(budget);
        h.document.getElementById('shell-boot-reload').click();
        expect(get ? h.window.location.reload : h.window.location.replace).toHaveBeenCalledTimes(2);
        if (!get) expect(h.window.location.replace).toHaveBeenLastCalledWith(original);
    });
    test('cancelled automatic reload rolls back without regaining its allowance', () => {
        const h = boot(); const rewritten = 'https://localhost:8082/normalized'; h.window.location.href = rewritten;
        h.emit('error'); vi.advanceTimersByTime(1500);
        expect(h.window.location.href).toBe('https://localhost:8082/?lang=fi#row');
        vi.advanceTimersByTime(1000);
        expect(h.window.location.href).toBe(rewritten); expect(h.notice('failed')).toBe(true);
        expect(JSON.parse(h.window.sessionStorage.getItem(retryKey)).unresolved).toBe(true);
        vi.advanceTimersByTime(600001); expect(h.window.location.reload).toHaveBeenCalledTimes(1);
    });
    test('thrown navigation rolls back the temporary POST marker immediately', () => {
        const h = boot({ get: false }); const previous = h.window.location.href;
        h.window.location.replace.mockImplementation(() => { throw Error('cancelled'); });
        h.emit('error'); vi.advanceTimersByTime(1500); h.document.getElementById('shell-boot-reload').click();
        expect(h.window.location.href).toBe(previous); expect(h.notice('failed')).toBe(true);
    });
    test('pagehide disarms rollback after committed navigation', () => {
        const h = boot({ get: false }); h.emit('error'); vi.advanceTimersByTime(1500);
        h.document.getElementById('shell-boot-reload').click();
        const temporary = h.window.location.href; h.emit('pagehide'); vi.advanceTimersByTime(1000);
        expect(h.window.location.href).toBe(temporary);
    });
    test('late CSS success reveals an evaluated module after a notice', () => {
        const h = boot({ offline: true }); h.window.__filterestShellBoot.evaluated();
        h.emit('load', { target: h.required() }); vi.advanceTimersByTime(1500);
        expect(h.notice('failed')).toBe(true); h.css(); h.emit('load', { target: h.required() });
        expect(h.pending()).toBe(false); expect(h.notice('failed')).toBe(false);
    });
    test('unresolved episodes cannot gain another retry after cooldown', () => {
        const shared = storage(); const h = boot({ storage: shared }); h.emit('error'); vi.advanceTimersByTime(1500);
        vi.advanceTimersByTime(600001); const second = boot({ storage: shared }); second.emit('error'); vi.advanceTimersByTime(1500);
        expect(second.window.location.reload).not.toHaveBeenCalled(); expect(second.notice('failed')).toBe(true);
    });
    test('success ends an episode, preserves cooldown, and later permits a new episode', () => {
        const shared = storage(); const h = boot({ storage: shared }); h.emit('error'); vi.advanceTimersByTime(1500);
        const second = boot({ storage: shared }); second.css(); second.window.__filterestShellBoot.evaluated();
        expect(JSON.parse(shared.getItem(retryKey)).unresolved).toBe(false);
        const third = boot({ storage: shared }); third.emit('error'); vi.advanceTimersByTime(1500); expect(third.window.location.reload).not.toHaveBeenCalled();
        vi.advanceTimersByTime(600001); const fourth = boot({ storage: shared }); fourth.emit('error'); vi.advanceTimersByTime(1500);
        expect(fourth.window.location.reload).toHaveBeenCalledTimes(1);
    });
    test.each(['read', 'write', 'verify', 'offline', 'post', 'interaction'])('%s prevents automatic reload', (reason) => {
        const shared = storage();
        if (reason === 'read') shared.getItem = () => { throw Error('denied'); };
        if (reason === 'write') shared.setItem = () => { throw Error('full'); };
        if (reason === 'verify') shared.setItem = () => {};
        const h = boot({ storage: shared, offline: reason === 'offline', get: reason !== 'post' });
        if (reason === 'interaction') h.document.dispatchEvent(new h.dom.window.Event('keydown'));
        h.emit('error'); vi.advanceTimersByTime(1500); expect(h.window.location.reload).not.toHaveBeenCalled(); expect(h.notice('failed')).toBe(true);
    });
    test('late success clears a failure notice without navigating', () => {
        const h = boot({ offline: true }); h.emit('error'); vi.advanceTimersByTime(1500); expect(h.notice('failed')).toBe(true);
        h.css(); h.window.__filterestShellBoot.evaluated(); expect(h.pending()).toBe(false); expect(h.notice('failed')).toBe(false);
    });
    test('post-evaluation exceptions and optional asset errors are ignored', () => {
        const h = boot(); h.window.__filterestShellBoot.evaluated(); h.emit('error', { message: 'app exception' }); h.emit('unhandledrejection', { reason: 'later request' });
        h.emit('error', { target: h.document.createElement('img') }); vi.advanceTimersByTime(1500); expect(h.window.location.reload).not.toHaveBeenCalled();
    });
    test.each([{ unsupported: true }, { ie: true }])('unsupported browser skips retries (%j)', (options) => {
        const h = boot(options); expect(h.notice('unsupported')).toBe(true); vi.advanceTimersByTime(60000); expect(h.window.location.reload).not.toHaveBeenCalled();
    });
    test('diagnostics are bounded, path-only and dev-only', () => {
        const h = boot({ dev: true, offline: true }); h.emit('error', { target: h.required() }); vi.advanceTimersByTime(1500);
        for (let i = 0; i < 15; i++) h.emit('pageshow', { persisted: true });
        const records = h.window.sessionStorage.getItem(recordKey); expect(JSON.parse(records)).toHaveLength(10); expect(records).not.toContain('secret');
        const prod = boot(); prod.emit('error'); expect(prod.window.sessionStorage.getItem(recordKey)).toBeNull();
    });
    test.each(['error', 'unhandledrejection'])('%s diagnostics never retain exception or rejection secrets', (kind) => {
        const h = boot({ dev: true, offline: true, url: 'https://localhost:8082/?token=query-secret#fragment-secret' });
        h.document.body.insertAdjacentHTML('beforeend', '<input name="password" value="form-secret">');
        const error = new TypeError('password-message-secret cookie=secret response-body-secret');
        h.emit(kind, { message: error.message, error, reason: error, filename: '/module.js?token=source-secret#source-fragment' });
        const records = h.window.sessionStorage.getItem(recordKey);
        expect(records).not.toMatch(/secret|password|cookie|response-body|message/);
        expect(JSON.parse(records)[0]).toMatchObject({ errorName: 'TypeError', source: '/module.js' });
        error.name = 'custom-secret';
        expect(h.window.__filterestShellBoot.safeRecord({ errorName: error.name }).errorName).toBeNull();
    });
});
