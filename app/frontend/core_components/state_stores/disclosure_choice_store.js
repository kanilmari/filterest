// disclosure_choice_store.js
// Remembers deliberate disclosure choices for one verified user in one browser tab.
// Bridges the shared disclosure controller and the existing session-storage fallback.
// Never writes to the server, localStorage or another tab's broadcast channel.
import { readTabSessionValue, writeTabSessionValue, removeTabSessionValue } from './tab_session_storage.js';

const STORAGE_KEY = 'filterest.disclosure-choices.v1';
const MAX_CHOICES = 2000;

function validID(value) {
    return (typeof value === 'number' || (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)))
        && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function choiceKey({ viewerID, datasetUID, surface, block } = {}) {
    if (!validID(viewerID) || !validID(datasetUID)
        || !/^[a-z][a-z0-9_]{0,63}$/.test(surface || '')
        || !/^[a-z][a-z0-9_]{0,63}$/.test(block || '')) return null;
    return `${Number(viewerID)}:${Number(datasetUID)}:${surface}:${block}`;
}

function readState(viewerID) {
    let state;
    try { state = JSON.parse(readTabSessionValue(STORAGE_KEY)); } catch { /* Refuse malformed saved state. */ }
    if (state?.viewerID !== Number(viewerID) || !state?.choices
        || typeof state.choices !== 'object' || Array.isArray(state.choices)) {
        // Account changes also discard the preceding account's private choices.
        removeTabSessionValue(STORAGE_KEY);
        return { viewerID: Number(viewerID), choices: {} };
    }
    return state;
}

/** Callers supply the identity verified by the session service, never a shell hint. */
export function readDisclosureChoice(context) {
    const key = choiceKey(context);
    if (!key) return null;
    const choices = readState(context.viewerID).choices;
    return Object.hasOwn(choices, key) && typeof choices[key] === 'boolean' ? choices[key] : null;
}

export function rememberDisclosureChoice(context, expanded) {
    const key = choiceKey(context);
    if (!key || typeof expanded !== 'boolean') return false;
    const state = readState(context.viewerID);
    // Bound session state; refresh a choice's position before evicting the oldest.
    delete state.choices[key];
    state.choices[key] = expanded;
    const keys = Object.keys(state.choices);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_CHOICES))) delete state.choices[old];
    writeTabSessionValue(STORAGE_KEY, JSON.stringify(state));
    return true;
}

export function clearDisclosureChoices() { removeTabSessionValue(STORAGE_KEY); }
