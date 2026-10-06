// dev_error_forwarder_to_backend.js
// Forwards JS exceptions, promise rejections, and console.error calls to POST /api/log-client-error for dev logging.
// Bridges browser error events and backend log storage; dev-only, imported conditionally in main.js.
// Exists to surface frontend-only failures in backend logs without coupling the logger to the normal API pipeline.
// PIPELINE_EXCEPTION: Uses direct fetch() to avoid circular deps and infinite error-logging loops.

// Prevent infinite loops if the logging itself causes errors
let isLogging = false;
let csrfToken = null;
let isBuffering = false;

const DEV_ERROR_BUFFER_KEY = "__dev_error_buffer_v1";
const DEV_ERROR_BUFFER_MAX_ENTRIES = 50;
const DEV_ERROR_BUFFER_MAX_AGE_MS = 30 * 60 * 1000;
const DEV_ERROR_BUFFER_FALLBACK_ENTRIES = 10;
const DEV_ERROR_BUFFER_MAX_TEXT_LENGTH = 4000;
const IS_DEV_MODE = document.querySelector('meta[name="app-env"]')?.content === 'dev';

function truncateText(value) {
    if (typeof value !== "string") {
        return value;
    }
    if (value.length <= DEV_ERROR_BUFFER_MAX_TEXT_LENGTH) {
        return value;
    }
    return value.slice(0, DEV_ERROR_BUFFER_MAX_TEXT_LENGTH) + "...";
}

function serializeConsoleArg(arg) {
    if (arg instanceof Error) {
        return arg.stack || arg.message || String(arg);
    }
    if (typeof arg === "string") {
        return arg;
    }
    try {
        return JSON.stringify(arg);
    } catch {
        return String(arg);
    }
}

function loadBufferedErrors() {
    try {
        const raw = window.localStorage.getItem(DEV_ERROR_BUFFER_KEY);
        if (!raw) {
            return [];
        }
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveBufferedErrors(entries) {
    try {
        window.localStorage.setItem(DEV_ERROR_BUFFER_KEY, JSON.stringify(entries));
    } catch (error) {
        if (error?.name !== "QuotaExceededError") {
            return;
        }
        try {
            const reducedEntries = entries.slice(-DEV_ERROR_BUFFER_FALLBACK_ENTRIES);
            window.localStorage.setItem(DEV_ERROR_BUFFER_KEY, JSON.stringify(reducedEntries));
        } catch {
            // Silent by design: error logging must never create a second crash path.
        }
    }
}

function pruneBufferedErrors(entries) {
    const cutoff = Date.now() - DEV_ERROR_BUFFER_MAX_AGE_MS;
    return entries
        .filter((entry) => {
            const timestamp = Date.parse(entry?.timestamp || "");
            return Number.isFinite(timestamp) && timestamp >= cutoff;
        })
        .slice(-DEV_ERROR_BUFFER_MAX_ENTRIES);
}

function createBufferedEntry(type, message, stack, source, line, col) {
    return {
        timestamp: new Date().toISOString(),
        type: truncateText(type || "error"),
        message: truncateText(message || ""),
        stack: truncateText(stack || ""),
        source: truncateText(source || ""),
        line: Number.isFinite(line) ? line : null,
        col: Number.isFinite(col) ? col : null,
        href: type === 'shell-boot' ? window.location.pathname : truncateText(window.location.href),
        userAgent: type === 'shell-boot' ? '' : truncateText(navigator.userAgent),
    };
}

function isSameBufferedError(previousEntry, nextEntry) {
    return Boolean(previousEntry)
        && previousEntry.type === nextEntry.type
        && previousEntry.message === nextEntry.message
        && previousEntry.source === nextEntry.source
        && previousEntry.line === nextEntry.line
        && previousEntry.col === nextEntry.col;
}

function recordBufferedError(type, message, stack, source, line, col) {
    if (isBuffering) {
        return;
    }

    isBuffering = true;

    try {
        const nextEntry = createBufferedEntry(type, message, stack, source, line, col);
        const entries = pruneBufferedErrors(loadBufferedErrors());
        const previousEntry = entries[entries.length - 1];

        if (isSameBufferedError(previousEntry, nextEntry)) {
            previousEntry.repeatCount = Number(previousEntry.repeatCount || 1) + 1;
            previousEntry.lastTimestamp = nextEntry.timestamp;
        } else {
            entries.push(nextEntry);
        }

        saveBufferedErrors(pruneBufferedErrors(entries));
    } catch {
        // Silent by design: the buffer is diagnostic only.
    } finally {
        isBuffering = false;
    }
}

window.__DEV_ERROR_BUFFER = {
    key: DEV_ERROR_BUFFER_KEY,
    dump() {
        return loadBufferedErrors();
    },
    clear() {
        try {
            window.localStorage.removeItem(DEV_ERROR_BUFFER_KEY);
        } catch {
            // Ignore localStorage access failures.
        }
    },
    printLast(count = 5) {
        const rows = loadBufferedErrors().slice(-count).map((entry) => ({
            time: entry.lastTimestamp || entry.timestamp,
            type: entry.type,
            message: entry.message,
            source: entry.source,
            line: entry.line,
            col: entry.col,
            repeatCount: entry.repeatCount || 1,
        }));
        console.table(rows);
        return rows;
    },
};

// Fetch CSRF token from the minimal bootstrap endpoint.
async function ensureCsrfToken() {
    if (csrfToken) return csrfToken;
    try {
        const res = await fetch('/api/csrf-token', { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            csrfToken = data.csrf_token || null;
        }
    } catch (_err) {
        // Silently fail - we'll try again next time
    }
    return csrfToken;
}

async function sendLog(type, message, stack, source, line, col) {
    if (!IS_DEV_MODE || isLogging) return false;
    // An auth dependency can load this transport before the entry module has
    // evaluated. Pending-shell errors belong to the guard's safe representation.
    if (type !== 'shell-boot' && window.__filterestShellBoot && !window.__filterestShellBoot.status().revealed) return false;
    isLogging = true;

    recordBufferedError(type, message, stack, source, line, col);

    const payload = {
        type: type,
        message: message,
        stack: stack,
        source: source,
        line: line,
        col: col
    };

    try {
        const token = await ensureCsrfToken();
        const headers = {
            'Content-Type': 'application/json'
        };
        if (token) {
            headers['X-CSRF-Token'] = token;
        }

        const response = await fetch('/api/log-client-error', {
            method: 'POST',
            headers: headers,
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        return response.ok;
    } catch (_err) {
        // The caller retains recovery records when transport is unavailable.
        return false;
    } finally {
        isLogging = false;
    }
}

// Capture unhandled exceptions
window.addEventListener('error', function(event) {
    const { message, filename, lineno, colno, error } = event;
    sendLog('error', message, error ? error.stack : null, filename, lineno, colno);
    // Don't prevent default handling (printing to console)
});

// Capture unhandled promise rejections
window.addEventListener('unhandledrejection', function(event) {
    sendLog('error', 'Unhandled Rejection: ' + event.reason, event.reason ? event.reason.stack : null);
});

// Optional: Capture console.error calls
const originalConsoleError = console.error;
console.error = function(...args) {
    // Convert args to string for the message
    const message = args.map(arg => 
        serializeConsoleArg(arg)
    ).join(' ');
    
    // Create a dummy error to get the stack trace
    const stack = new Error().stack;
    
    sendLog('error', message, stack);
    
    originalConsoleError.apply(console, args);
};

if (IS_DEV_MODE) console.log("[DevTools] Log forwarding enabled.");
if (IS_DEV_MODE) console.log(`[DevTools] Error buffer enabled: ${DEV_ERROR_BUFFER_KEY}`);


const SHELL_BOOT_RECORDS_KEY = "__filterest_shell_boot_records_v1";
let isForwardingShellBoot = false;

// Forward only after the protected shell recovered, and acknowledge each record
// individually. Failed/non-2xx sends retain the bounded tab-local evidence.
export async function forwardShellBootRecords() {
    const guard = window.__filterestShellBoot;
    if (!IS_DEV_MODE || isForwardingShellBoot || !guard?.status().revealed || !guard.safeRecord) return;
    isForwardingShellBoot = true;
    try {
        let records = JSON.parse(sessionStorage.getItem(SHELL_BOOT_RECORDS_KEY) || "[]");
        if (!Array.isArray(records)) return;
        records = records.map(guard.safeRecord).filter((entry) => entry.time > Date.now() - DEV_ERROR_BUFFER_MAX_AGE_MS).slice(-10);
        sessionStorage.setItem(SHELL_BOOT_RECORDS_KEY, JSON.stringify(records));
        for (const entry of records) {
            const acknowledged = await sendLog('shell-boot', JSON.stringify(entry), null, entry.resource || entry.source, entry.line, entry.column);
            if (!acknowledged) break;
            // Read again: another event may have added a record while fetch awaited.
            const current = JSON.parse(sessionStorage.getItem(SHELL_BOOT_RECORDS_KEY) || "[]").map(guard.safeRecord);
            const matchingIndex = current.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(entry));
            if (matchingIndex >= 0) current.splice(matchingIndex, 1);
            sessionStorage.setItem(SHELL_BOOT_RECORDS_KEY, JSON.stringify(current));
        }
    } catch {
        // Storage/log transport failures are diagnostic only.
    } finally {
        isForwardingShellBoot = false;
    }
}

if (IS_DEV_MODE) {
    window.addEventListener('filterest-shell-boot-recovered', forwardShellBootRecords);
    void forwardShellBootRecords();
}
