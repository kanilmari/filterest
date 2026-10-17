// client_error_classifier.js
// Classifies browser runtime failures as own, foreign or opaque.
// Shared boundary for the global toast monitor and WO36's future client error log.
// Uses served script locations, never message wording, to attribute an error.

/**
 * Classify an onerror payload, or an Error rejection with only a stack.
 * A supplied source must be an app script; when a stack exists it must also
 * contain an own frame. Stack-only errors use those frames as their source; an explicitly empty
 * source remains opaque.
 * Document URLs are always foreign (browser-injected code uses them).
 * Router: /frontend/ and /components/<name>/frontend/. Vite builds use
 * /frontend/dist/; its source server strips /frontend/ from module paths.
 * Keep this pure exported contract reusable by WO36 without importing the UI.
 *
 * @param {{message?: string, source?: string, line?: number, column?: number, error?: Error}} details
 * @param {string} documentUrl - Current document URL, including its origin
 * @returns {'own'|'foreign'|'opaque'}
 */
export function classifyClientError({ message, source, line, column, error }, documentUrl) {
    if (message === 'Script error.' && !line && !column && !error) return 'opaque';
    if (source === '' || source === null) return 'opaque';
    const page = new URL(documentUrl);
    const ownScript = (value) => {
        try {
            const url = new URL(value, page);
            if (url.origin !== page.origin || url.pathname === page.pathname) return false;
            if (!/\.(?:m?js)$/i.test(url.pathname)) return false;
            return url.pathname.startsWith('/frontend/')
                || /^\/components\/[^/]+\/frontend\//.test(url.pathname)
                || /^\/(?:core_components|reusable_components|custom_views|shared|icons|generated|styles)\//.test(url.pathname)
                || /^\/@fs\/.+\/components\/[^/]+\/frontend\//.test(url.pathname)
                || ['/main.js', '/ui_config.js'].includes(url.pathname);
        } catch {
            return false;
        }
    };
    if (source && !ownScript(source)) return 'foreign';
    if (typeof error?.stack === 'string' && error.stack) {
        // Only location-bearing frame lines count: a URL in the error's
        // message must not make an injected stack look like application code.
        const frames = stackFrameLines(error).flatMap((frame) => {
            // V8 anonymous async frames read "at async URL:line:col". A script
            // URL may hold parentheses (e.g. in its query), so the location runs
            // to the final line/column.
            const location = frame.match(/(?:^\s*at\s+(?:async\s+)?(?:.*?\()?|^[^@]*@)((?:[a-z][a-z\d+.-]*:\/\/|\/)\S+?):\d+(?::\d+)?\)?\s*$/i);
            return location ? [location[1]] : [];
        });
        if (frames.some(ownScript)) return 'own';
        return source || frames.length ? 'foreign' : 'opaque';
    }
    return source ? 'own' : 'opaque';
}

/** Strip the complete message prefix before parsing either native stack format. */
function stackFrameLines(error) {
    const stack = error.stack;
    const message = String(error.message || '');
    const name = String(error.name || 'Error');
    // V8 includes Name: message, including every newline in the message.
    // Some stack producers prefix just the message; Firefox/Safari normally
    // have no header at all, so never discard their first actual frame.
    for (const header of [`${name}: ${message}`, message, name].filter(Boolean)) {
        if (stack === header) return [];
        if (stack.startsWith(`${header}\n`)) return stack.slice(header.length + 1).split('\n');
    }
    const lines = stack.split('\n');
    // Accommodate a stack captured before the Error's message was changed.
    if (lines[0].startsWith(`${name}:`)) lines.shift();
    return lines;
}
