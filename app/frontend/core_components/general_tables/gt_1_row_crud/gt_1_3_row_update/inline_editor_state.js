// inline_editor_state.js
// Owns the lifetime of every editCell editor, including setup and pending saves.
// Connects view disposal and editor DOM state to the SSE refresh owner without importing either.
// Keeps removal separate from confirmation and releases held changes on every exit.

const editors = new Map();
const generations = new Map();
const closeListeners = new Set();
const heldChanges = new Set();
let observer = null;

function release(editor) {
    if (editors.get(editor.cell) !== editor) return;
    editors.delete(editor.cell);
    editor.cleanups.forEach(cleanup => cleanup());
    if (!editors.size) { observer?.disconnect(); observer = null; }
    closeListeners.forEach(listener => listener(editor.tableName));
}

function reconcileEditors() {
    for (const editor of [...editors.values()]) {
        // Connectivity is only a lifetime fallback, never evidence of a confirmed blur.
        if (!editor.cell.isConnected) editor.discard();
        else if (!editor.initializing && !editor.cell.classList.contains('editing')
            && editor.cell.dataset.inlineSaveState !== 'saving') release(editor);
    }
}

/** Start before editor setup can yield; observe endings rather than enumerate return paths. */
export function beginInlineEditor(cell, tableName, restoreDisplay) {
    editors.get(cell)?.discard();
    generations.set(tableName, getInlineEditorGeneration(tableName) + 1);
    const editor = {
        cell, tableName, discarded: false, initializing: true, cleanups: new Set(),
        ready() { editor.initializing = false; reconcileEditors(); },
        discard() {
            if (editor.discarded) return;
            // Set the mark before any DOM write can fire blur in a browser.
            editor.discarded = true;
            restoreDisplay();
            release(editor);
        },
    };
    editors.set(cell, editor);
    if (!observer) {
        observer = new MutationObserver(reconcileEditors);
        observer.observe(document.documentElement, {
            subtree: true, childList: true, attributes: true,
            attributeFilter: ['class', 'data-inline-save-state'],
        });
    }
    return editor;
}

/** Mark all owned editors before a view is cleared, replaced, hidden or disposed. */
export function discardInlineEditors(root = document) {
    for (const editor of [...editors.values()]) {
        if (root === editor.cell || root?.contains(editor.cell)) editor.discard();
    }
}

export function hasOpenInlineEditor(tableName) {
    reconcileEditors();
    return [...editors.values()].some(editor => editor.tableName === tableName);
}

export function getInlineEditorGeneration(tableName) { return generations.get(tableName) || 0; }
export function hasHeldInlineChange(tableName) { return heldChanges.has(tableName); }
export function setHeldInlineChange(tableName, held) {
    if (held) heldChanges.add(tableName); else heldChanges.delete(tableName);
}
export function subscribeToInlineEditorClose(listener) {
    closeListeners.add(listener);
    return () => closeListeners.delete(listener);
}
