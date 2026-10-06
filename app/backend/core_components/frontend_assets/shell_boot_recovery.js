// shell_boot_recovery.js
// Protects the unfinished document when essential CSS or its module graph fails.
// Bridges nonce-authorized HTML, entry-module signals and a tab-local retry budget.
// Kept ES5 so unsupported browsers can still display the server's translated notice.
(function (window, document) {
    'use strict';
    var root = document.documentElement;
    if (!root.hasAttribute('data-shell-boot-pending')) return;
    var initialURL = window.location.href;
    var budgetKey = '__filterest_shell_boot_retry_v1:' + initialURL;
    var diagnosticKey = '__filterest_shell_boot_records_v1';
    var cooldown = 10 * 60 * 1000;
    var watchdog = 30000;
    var loadingDelay = 3000;
    var minimumReloadDelay = 1500;
    var isDev = root.getAttribute('data-shell-boot-dev') === 'true';
    var getDocument = root.getAttribute('data-shell-boot-get') === 'true';
    var probe = root.getAttribute('data-shell-boot-probe');
    var evaluated = false;
    var ready = false;
    var revealed = false;
    var failed = false;
    var failureReason = '';
    var interacted = false;
    var navigating = false;
    var recoveryOffered = false;
    var pendingNavigation = null;
    var navigationTimer = null;
    var navigationRollbackDelay = 1000;
    var frozen = false;
    var elapsed = 0;
    var lastTime = Date.now();
    var active = !document.hidden;
    var timer = null;
    var readyTimeoutRecorded = false;
    var unsupported = /MSIE |Trident\//.test(window.navigator.userAgent) ||
        !('noModule' in document.createElement('script')) || !window.getComputedStyle;

    try {
        var theme = window.localStorage.getItem('theme');
        root.setAttribute('data-shell-boot-theme', theme === 'light' || theme === 'dark' ? theme : 'system');
    } catch (_error) { root.setAttribute('data-shell-boot-theme', 'system'); }

    function cssApplied() {
        try {
            return window.getComputedStyle(root).getPropertyValue(probe).replace(/\s/g, '') === '1';
        } catch (_error) { return false; }
    }

    function safePath(value) {
        if (typeof value !== 'string' || !value) return '';
        var link = document.createElement('a');
        link.href = value;
        return link.pathname.slice(0, 300);
    }

    // Whitelist the complete representation, including records left by an older
    // document. Arbitrary messages, stacks and custom error names are private text.
    function safeRecord(entry) {
        entry = entry || {};
        function number(value) { return typeof value === 'number' && isFinite(value) ? value : null; }
        function choice(value, allowed, fallback) { return allowed.indexOf(value) >= 0 ? value : fallback; }
        return {
            time: number(entry.time),
            reason: choice(entry.reason, ['resource-error', 'evaluation-error', 'evaluation-rejection',
                'css-sentinel-missing', 'asset-timeout', 'document-template-error', 'automatic-reload',
                'recovered', 'ready', 'ready-timeout', 'pageshow'], 'unknown'),
            stage: choice(entry.stage, ['startup', 'assets'], 'assets'),
            errorName: choice(entry.errorName, ['Error', 'TypeError', 'SyntaxError', 'ReferenceError',
                'RangeError', 'URIError', 'EvalError', 'AggregateError'], null),
            visibleMilliseconds: number(entry.visibleMilliseconds),
            cssApplied: entry.cssApplied === true, evaluated: entry.evaluated === true, ready: entry.ready === true,
            hidden: entry.hidden === true, persisted: entry.persisted === true, offline: entry.offline === true,
            resource: safePath(entry.resource), source: safePath(entry.source),
            line: number(entry.line), column: number(entry.column)
        };
    }

    function record(reason, event) {
        if (!isDev) return;
        try {
            var records = JSON.parse(window.sessionStorage.getItem(diagnosticKey) || '[]');
            if (!Array.isArray(records)) records = [];
            records = records.map(safeRecord).filter(function (entry) { return entry.time > Date.now() - 30 * 60 * 1000; });
            records.push(safeRecord({
                time: Date.now(), reason: reason, stage: revealed ? 'startup' : 'assets',
                visibleMilliseconds: elapsed, cssApplied: cssApplied(), evaluated: evaluated, ready: ready,
                hidden: !!document.hidden, persisted: !!(event && event.persisted),
                offline: window.navigator.onLine === false,
                resource: safePath(event && event.target && (event.target.src || event.target.href)),
                source: safePath(event && event.filename), line: event && event.lineno || null,
                column: event && event.colno || null,
                errorName: event && (event.error || event.reason) && (event.error || event.reason).name
            }));
            window.sessionStorage.setItem(diagnosticKey, JSON.stringify(records.slice(-10)));
        } catch (_error) { /* Diagnostics must not affect recovery. */ }
    }

    function notifyRecovered() {
        var event = document.createEvent('Event');
        event.initEvent('filterest-shell-boot-recovered', false, false);
        window.dispatchEvent(event);
    }

    function finishEpisode() {
        try {
            var budget = JSON.parse(window.sessionStorage.getItem(budgetKey) || 'null');
            if (budget) {
                budget.unresolved = false;
                window.sessionStorage.setItem(budgetKey, JSON.stringify(budget));
            }
        } catch (_error) { /* Success does not depend on storage. */ }
    }

    function updateVisibleTime() {
        var now = Date.now();
        if (active) elapsed += Math.max(0, now - lastTime);
        lastTime = now;
        active = !document.hidden && !frozen;
    }

    function displayNotice(state) {
        var notice = document.getElementById('shell-boot-notice');
        if (!notice) return;
        notice.hidden = !state;
        ['loading', 'failed', 'unsupported'].forEach(function (name) {
            var panel = document.getElementById('shell-boot-' + name);
            if (panel) panel.hidden = state !== name;
        });
    }

    // Persist and read back the attempt before navigation. An unresolved retry
    // never receives another allowance, even when the cooldown has expired.
    function reserveAutomaticReload() {
        if (!getDocument || revealed || interacted || window.navigator.onLine === false) return false;
        try {
            var storage = window.sessionStorage;
            var budget = JSON.parse(storage.getItem(budgetKey) || 'null');
            if (budget && (budget.unresolved || Date.now() - budget.lastAttempt < cooldown)) return false;
            var attempt = JSON.stringify({ lastAttempt: Date.now(), unresolved: true });
            storage.setItem(budgetKey, attempt);
            return storage.getItem(budgetKey) === attempt;
        } catch (_error) { return false; }
    }

    function recheck() {
        window.clearTimeout(timer);
        updateVisibleTime();
        if (unsupported) {
            displayNotice('unsupported');
            return;
        }
        if (!revealed && evaluated && cssApplied() && !navigating) {
            revealed = true;
            root.removeAttribute('data-shell-boot-pending');
            displayNotice(null);
            finishEpisode();
            if (failed) record('recovered');
            notifyRecovered();
        }
        if (revealed) {
            // Fail open: ready is diagnostic only. A slow data request must never
            // hide or reload a usable shell or announce a page-load failure.
            if (!ready && elapsed >= watchdog && !readyTimeoutRecorded) {
                readyTimeoutRecorded = true;
                record('ready-timeout');
                notifyRecovered();
            }
            if (ready || readyTimeoutRecorded) return;
        } else {
            if (!failed && elapsed >= watchdog) fail('asset-timeout');
            if (failed && active && elapsed >= minimumReloadDelay && !navigating) {
                if (!recoveryOffered && reserveAutomaticReload()) {
                    navigateDocument(true);
                    return;
                }
                recoveryOffered = true;
                displayNotice('failed');
                return;
            } else if (!failed && elapsed >= loadingDelay) {
                displayNotice('loading');
            }
        }
        if (active && !navigating) timer = window.setTimeout(recheck, 100);
    }

    function fail(reason, event) {
        if (revealed || failed || unsupported) return;
        failed = true;
        failureReason = reason;
        record(reason, event);
    }

    // A cancelled navigation leaves this document alive. Restore its address and
    // state without undoing the frozen retry reservation or adding history entries.
    function rollbackNavigation() {
        window.clearTimeout(navigationTimer);
        var previous = pendingNavigation;
        pendingNavigation = null;
        try { if (previous) window.history.replaceState(previous.state, '', previous.address); }
        catch (_error) { /* A History API failure must still leave the button usable. */ }
        navigating = false;
        recoveryOffered = true;
        recheck();
    }

    // GET documents can reload after restoring the captured address. POST
    // documents need replace(), with a different query first when a fragment
    // would otherwise make this a same-document navigation. Never decode the URL.
    function navigateDocument(automatic) {
        if (navigating) return;
        navigating = true;
        try {
            pendingNavigation = { address: window.location.href, state: window.history.state };
            if (getDocument) {
                window.history.replaceState(window.history.state, '', initialURL);
                if (window.location.href !== initialURL) throw new Error('address restoration failed');
                if (automatic) record('automatic-reload');
                window.location.reload();
            } else {
                var initialBase = initialURL.split('#')[0];
                if (initialURL.indexOf('#') >= 0 && window.location.href.split('#')[0] === initialBase) {
                    var temporaryURL = initialBase + (initialBase.indexOf('?') >= 0 ? '&' : '?') +
                        '__filterest_shell_boot_get_retry=' + Date.now();
                    window.history.replaceState(window.history.state, '', temporaryURL);
                    if (window.location.href.split('#')[0] === initialBase) throw new Error('temporary address failed');
                }
                window.location.replace(initialURL);
            }
            // Successful navigation destroys this timer. It also covers a stop
            // or cancellation that emits no unload event while this page survives.
            navigationTimer = window.setTimeout(rollbackNavigation, navigationRollbackDelay);
        } catch (_error) {
            rollbackNavigation();
        }
    }

    function reloadDocumentAsGET() {
        navigateDocument(false);
    }

    window.__filterestShellBoot = {
        evaluated: function () { evaluated = true; recheck(); },
        ready: function () { ready = true; updateVisibleTime(); record('ready'); recheck(); notifyRecovered(); },
        safeRecord: safeRecord,
        status: function () { return { revealed: revealed, evaluated: evaluated, ready: ready, failure: failureReason }; }
    };
    window.addEventListener('error', function (event) {
        var target = event.target;
        if (target && target !== window) {
            if (target.hasAttribute && target.hasAttribute('data-shell-boot-required')) fail('resource-error', event);
        } else if (!evaluated) fail('evaluation-error', event);
        recheck();
    }, true);
    window.addEventListener('unhandledrejection', function (event) {
        if (!evaluated) fail('evaluation-rejection', event);
        recheck();
    });
    window.addEventListener('load', function (event) {
        var target = event.target;
        if (target && target.tagName === 'LINK' && target.hasAttribute('data-shell-boot-probe-link') && !cssApplied()) {
            fail('css-sentinel-missing', event);
        }
        recheck();
    }, true);
    ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'input', 'submit'].forEach(function (name) {
        document.addEventListener(name, function () { interacted = true; }, true);
    });
    document.addEventListener('visibilitychange', recheck);
    document.addEventListener('freeze', function () { updateVisibleTime(); frozen = true; recheck(); });
    document.addEventListener('resume', function () { frozen = false; recheck(); });
    window.addEventListener('beforeunload', function () {
        if (pendingNavigation) {
            window.clearTimeout(navigationTimer);
            navigationTimer = window.setTimeout(rollbackNavigation, 0);
        }
    });
    window.addEventListener('pagehide', function () {
        window.clearTimeout(navigationTimer);
        pendingNavigation = null;
        updateVisibleTime(); frozen = true; recheck();
    });
    window.addEventListener('pageshow', function (event) { frozen = false; record('pageshow', event); recheck(); });
    document.addEventListener('DOMContentLoaded', function () {
        var button = document.getElementById('shell-boot-reload');
        if (button) button.addEventListener('click', reloadDocumentAsGET);
        recheck();
    });
    if (root.hasAttribute('data-shell-boot-document-failed')) fail('document-template-error');
    recheck();
})(window, document);
