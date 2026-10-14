// custom_root_navigation.test.js
// Proves document navigation, single-flight departure and login-shell preservation.
// Connects the real readiness owner with a narrow browser location double.
// Keeps missing/older bootstrap responses from forcing an endless reload.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { isCustomRootEnabled, loadCustomRoot, loadCustomRootFromHistory,
    setCustomRootEnabled } from './custom_root_navigation.js';

let location;
const browserWindow = window;
beforeEach(() => {
    vi.useFakeTimers();
    setCustomRootEnabled(false);
    location = { pathname: '/events', search: '', assign: vi.fn(), replace: vi.fn() };
    vi.stubGlobal('window', { location });
});
afterEach(() => { vi.unstubAllGlobals(); setCustomRootEnabled(false); vi.useRealTimers(); });

// Model the browser-owned result independently of beforeunload and document lifetime.
// A pending response remains pending until the browser reports failure or replacement.
function observeNavigation() {
    const attempts = [];
    window.navigation = new browserWindow.EventTarget();
    window.navigation.navigate = vi.fn(() => {
        const attempt = {};
        attempt.controller = new browserWindow.AbortController();
        const event = new browserWindow.Event('navigate');
        event.signal = attempt.controller.signal;
        window.navigation.dispatchEvent(event);
        const committed = new Promise((resolve, reject) => { attempt.commit = resolve; attempt.rejectCommit = reject; });
        const finished = new Promise((resolve, reject) => { attempt.finish = resolve; attempt.rejectFinish = reject; });
        attempt.fail = () => {
            const error = new browserWindow.DOMException('Departure cancelled', 'AbortError');
            attempt.rejectCommit(error); attempt.rejectFinish(error);
        };
        attempts.push(attempt);
        return { committed, finished };
    });
    return attempts;
}

test('a Home click loads the complete root document exactly once', async () => {
    setCustomRootEnabled(true);
    expect(await loadCustomRoot()).toBe(true);
    expect(await loadCustomRoot()).toBe(true);
    expect(location.assign).toHaveBeenCalledExactlyOnceWith('/');
    expect(location.replace).not.toHaveBeenCalled();
});

test('a SPA document restored by browser Back can leave for Home again', async () => {
    setCustomRootEnabled(true);
    await loadCustomRoot();
    browserWindow.dispatchEvent(new browserWindow.PageTransitionEvent('pageshow', { persisted: true }));
    expect(await loadCustomRoot()).toBe(true);
    expect(location.assign).toHaveBeenCalledTimes(2);
});

test.each(['back', 'forward'])('%s to root replaces the landed entry with a document load', async () => {
    setCustomRootEnabled(true);
    location.pathname = '/';
    expect(await loadCustomRootFromHistory()).toBe(true);
    expect(location.replace).toHaveBeenCalledExactlyOnceWith('/');
    expect(location.assign).not.toHaveBeenCalled();
});

test.each([false, undefined, null, 'true'])('missing, disabled or invalid bootstrap flag %s retains SPA behaviour', async value => {
    setCustomRootEnabled(value);
    location.pathname = '/';
    expect(isCustomRootEnabled()).toBe(false);
    expect(await loadCustomRoot()).toBe(false);
    expect(await loadCustomRootFromHistory()).toBe(false);
    expect(location.assign).not.toHaveBeenCalled();
    expect(location.replace).not.toHaveBeenCalled();
});

test.each(['?login-entry=1', '?register-entry=1'])('history retains the explicit authentication shell %s', async search => {
    setCustomRootEnabled(true);
    location.pathname = '/'; location.search = search;
    expect(await loadCustomRootFromHistory()).toBe(false);
    expect(location.replace).not.toHaveBeenCalled();
    expect(await loadCustomRoot()).toBe(true);
    expect(location.assign).toHaveBeenCalledExactlyOnceWith('/');
});

test('dataset history and fallback bootstrap never reload root', async () => {
    setCustomRootEnabled(true);
    expect(await loadCustomRootFromHistory()).toBe(false);
    vi.useFakeTimers();
    setCustomRootEnabled(false);
    location.pathname = '/';
    expect(await loadCustomRootFromHistory()).toBe(false);
    setCustomRootEnabled(true);
    expect(await loadCustomRootFromHistory()).toBe(true);
    expect(location.replace).toHaveBeenCalledTimes(1);
});


test('browser Cancel then save leaves the next Home click usable', async () => {
    setCustomRootEnabled(true);
    const attempts = observeNavigation();
    let dirty = true;
    window.check_manage_permissions_dirty = vi.fn(async () => true); // Discard allowed; native prompt remains.
    const beforeUnload = event => { if (dirty) event.preventDefault(); };
    browserWindow.addEventListener('beforeunload', beforeUnload);
    try {
        await loadCustomRoot();
        const event = new browserWindow.Event('beforeunload', { cancelable: true });
        browserWindow.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true); // A handler actually requested the native prompt.
        attempts[0].fail(); // Cancel: the browser rejects this navigation, without pagehide.
        await Promise.resolve();
        dirty = false; // Save completed.
        await loadCustomRoot();
        expect(window.check_manage_permissions_dirty).toHaveBeenCalledTimes(2);
        expect(window.navigation.navigate).toHaveBeenCalledTimes(2);
    } finally { browserWindow.removeEventListener('beforeunload', beforeUnload); }
});

test('dirty guard refusal does not navigate or latch, and a saved retry succeeds', async () => {
    setCustomRootEnabled(true);
    observeNavigation();
    window.check_manage_permissions_dirty = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    expect(await loadCustomRoot()).toBe(true); // Handled: never fall through to SPA Home.
    expect(window.navigation.navigate).not.toHaveBeenCalled();
    await loadCustomRoot();
    expect(window.navigation.navigate).toHaveBeenCalledExactlyOnceWith('/', { history: 'push' });
});

test('double click while the dirty guard is pending confirms and navigates once', async () => {
    setCustomRootEnabled(true);
    let allow;
    window.check_manage_permissions_dirty = vi.fn(() => new Promise(resolve => { allow = resolve; }));
    const first = loadCustomRoot();
    const second = loadCustomRoot();
    await Promise.resolve();
    expect(window.check_manage_permissions_dirty).toHaveBeenCalledOnce();
    expect(location.assign).not.toHaveBeenCalled();
    allow(true);
    await Promise.all([first, second]);
    expect(location.assign).toHaveBeenCalledExactlyOnceWith('/');
});

test.each([false, true])('a slow accepted departure suppresses Home at 25 ms, 1.1 s and 9.9 s (replace=%s)', async replace => {
    setCustomRootEnabled(true);
    observeNavigation();
    await loadCustomRoot({ replace });
    browserWindow.dispatchEvent(new browserWindow.Event('beforeunload'));
    // Absolute activation times from the accepted departure, below the retry threshold.
    for (const elapsed of [25, 1100, 9900]) {
        await vi.advanceTimersByTimeAsync(elapsed - performance.now());
        await loadCustomRoot({ replace, userActivation: true });
    }
    expect(window.navigation.navigate).toHaveBeenCalledExactlyOnceWith('/', { history: replace ? 'replace' : 'push' });
    expect(location.assign).not.toHaveBeenCalled();
    expect(location.replace).not.toHaveBeenCalled();
});

test.each([false, true])('a new Home activation retries a no-signal end only at 10 seconds (Navigation API=%s)', async navigationAPI => {
    setCustomRootEnabled(true);
    if (navigationAPI) observeNavigation(); // No abort, settlement or page transition follows.
    const navigate = navigationAPI ? window.navigation.navigate : location.assign;
    await loadCustomRoot();
    await vi.advanceTimersByTimeAsync(9999);
    await loadCustomRoot({ userActivation: true });
    expect(navigate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([loadCustomRoot({ userActivation: true }), loadCustomRoot({ userActivation: true })]);
    expect(navigate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9900);
    await loadCustomRoot({ userActivation: true }); // The new attempt owns a fresh 10-second window.
    expect(navigate).toHaveBeenCalledTimes(2);
});

test('elapsed time and automatic/history calls cannot retry a no-signal departure', async () => {
    setCustomRootEnabled(true);
    observeNavigation();
    await loadCustomRoot();
    await vi.advanceTimersByTimeAsync(60000);
    expect(window.navigation.navigate).toHaveBeenCalledOnce(); // No self-releasing timer.
    location.pathname = '/';
    await loadCustomRootFromHistory();
    await loadCustomRoot({ replace: true });
    await loadCustomRoot();
    expect(window.navigation.navigate).toHaveBeenCalledOnce();
    await loadCustomRoot({ userActivation: true });
    expect(window.navigation.navigate).toHaveBeenCalledTimes(2);
});

test('an expired retry reruns the dirty guard, and an old result cannot unlock its replacement', async () => {
    setCustomRootEnabled(true);
    const attempts = observeNavigation();
    window.check_manage_permissions_dirty = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValue(true);
    await loadCustomRoot();
    await vi.advanceTimersByTimeAsync(10000);
    await loadCustomRoot({ userActivation: true }); // Refuse; saving can immediately retry.
    expect(window.navigation.navigate).toHaveBeenCalledOnce();
    await loadCustomRoot({ userActivation: true });
    attempts[0].fail();
    attempts[0].controller.abort();
    await Promise.resolve();
    await loadCustomRoot({ userActivation: true });
    expect(window.check_manage_permissions_dirty).toHaveBeenCalledTimes(3);
    expect(window.navigation.navigate).toHaveBeenCalledTimes(2);
});

test('accepting a requested leave prompt also retains the latch during a slow response', async () => {
    setCustomRootEnabled(true);
    observeNavigation();
    const beforeUnload = event => event.preventDefault();
    browserWindow.addEventListener('beforeunload', beforeUnload);
    try {
        await loadCustomRoot();
        const event = new browserWindow.Event('beforeunload', { cancelable: true });
        browserWindow.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        await vi.advanceTimersByTimeAsync(60000); // Accept, with the navigation result still pending.
        await loadCustomRoot();
        expect(window.navigation.navigate).toHaveBeenCalledOnce();
    } finally { browserWindow.removeEventListener('beforeunload', beforeUnload); }
});

test.each(['both', 'finished'])('browser-reported failure/Stop recovers without unload (%s rejected)', async rejected => {
    setCustomRootEnabled(true);
    const attempts = observeNavigation();
    await loadCustomRoot();
    if (rejected === 'both') attempts[0].fail();
    else { attempts[0].commit({}); attempts[0].rejectFinish(new Error('request failed')); }
    await Promise.resolve();
    await loadCustomRoot();
    expect(window.navigation.navigate).toHaveBeenCalledTimes(2);
});

test('an aborted navigate event releases its attempt even if both result promises remain pending', async () => {
    setCustomRootEnabled(true);
    const attempts = observeNavigation();
    await loadCustomRoot();
    attempts[0].controller.abort();
    await loadCustomRoot();
    expect(window.navigation.navigate).toHaveBeenCalledTimes(2);
});

test('a finished navigation that retains the document releases its attempt, while commitment alone does not', async () => {
    setCustomRootEnabled(true);
    const attempts = observeNavigation();
    await loadCustomRoot();
    attempts[0].commit({});
    await Promise.resolve();
    await loadCustomRoot();
    expect(window.navigation.navigate).toHaveBeenCalledOnce();
    attempts[0].finish({});
    await Promise.resolve();
    await loadCustomRoot();
    expect(window.navigation.navigate).toHaveBeenCalledTimes(2);
});

test('a cached document can leave again and an old rejection cannot unlock its new departure', async () => {
    setCustomRootEnabled(true);
    const attempts = observeNavigation();
    await loadCustomRoot();
    browserWindow.dispatchEvent(new browserWindow.PageTransitionEvent('pagehide', { persisted: true }));
    browserWindow.dispatchEvent(new browserWindow.PageTransitionEvent('pageshow', { persisted: true }));
    await loadCustomRoot();
    attempts[0].fail();
    attempts[0].controller.abort();
    await Promise.resolve();
    await loadCustomRoot();
    expect(window.navigation.navigate).toHaveBeenCalledTimes(2);
});

test('ordinary pageshow and focus do not unlock a slow accepted departure', async () => {
    setCustomRootEnabled(true);
    observeNavigation();
    await loadCustomRoot();
    browserWindow.dispatchEvent(new browserWindow.PageTransitionEvent('pageshow', { persisted: false }));
    browserWindow.dispatchEvent(new browserWindow.Event('focus'));
    await loadCustomRoot();
    expect(window.navigation.navigate).toHaveBeenCalledOnce();
});

test('Location fallback keeps a slow departure single-flight without an elapsed-time reset', async () => {
    setCustomRootEnabled(true);
    await loadCustomRoot();
    browserWindow.dispatchEvent(new browserWindow.Event('beforeunload'));
    await vi.advanceTimersByTimeAsync(60000);
    await loadCustomRoot();
    expect(location.assign).toHaveBeenCalledOnce();
});

test('pagehide keeps an actual departure single-flight until the cached document returns', async () => {
    setCustomRootEnabled(true);
    await loadCustomRoot();
    browserWindow.dispatchEvent(new browserWindow.Event('beforeunload'));
    browserWindow.dispatchEvent(new browserWindow.PageTransitionEvent('pagehide'));
    await vi.advanceTimersByTimeAsync(1000);
    await loadCustomRoot();
    expect(location.assign).toHaveBeenCalledOnce();
    browserWindow.dispatchEvent(new browserWindow.PageTransitionEvent('pageshow', { persisted: true }));
    await loadCustomRoot();
    expect(location.assign).toHaveBeenCalledTimes(2);
});

test('a thrown navigation releases its latch immediately', async () => {
    setCustomRootEnabled(true);
    location.assign.mockImplementationOnce(() => { throw new Error('navigation refused'); });
    await expect(loadCustomRoot()).rejects.toThrow('navigation refused');
    await loadCustomRoot();
    expect(location.assign).toHaveBeenCalledTimes(2);
});

test('a guard error and a superseded guard do not leave a departure behind', async () => {
    setCustomRootEnabled(true);
    window.check_manage_permissions_dirty = vi.fn().mockRejectedValueOnce(new Error('guard failed')).mockResolvedValue(true);
    await expect(loadCustomRoot()).rejects.toThrow('guard failed');
    await loadCustomRoot({ isCurrentNavigation: () => false });
    expect(location.assign).not.toHaveBeenCalled();
    await loadCustomRoot();
    expect(location.assign).toHaveBeenCalledOnce();
});
