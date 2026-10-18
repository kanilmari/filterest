// filterbar_visibility_memory.js
// Carries the actual panel state between datasets and selects visibility memory.
// Connects existing dataset keys and account settings to mounted runtime panels.
// Retains legacy keys and starts shared memory from the bar currently in use.
import { getStoredVisibility, setStoredVisibility } from './filterbar_engine/filterbar_visibility_handler.js';
import { getFilterbarPreferences, subscribeFilterbarPreferences } from './filterbar_preferences_controller.js';
import { VIEW_DEACTIVATE_EVENT } from '../../reusable_components/view_lifecycle_events.js';
import { subscribeToSessionGeneration } from '../auth/session_generation_store.js';

let active = null;
let departure = null;
const SHARED_KEY = 'filterbar_shared_visible';
const sharedKey = () => `${SHARED_KEY}:${localStorage.getItem('button_state') === 'logout'
    ? getFilterbarPreferences().personal.user_id || 'pending' : 'guest'}`;
const GUEST_MODE_KEY = 'filterbar_visibility_memory';
export const visibilityMemoryMode = () => localStorage.getItem('button_state') === 'logout'
    ? getFilterbarPreferences().personal.visibility_memory || 'shared'
    : localStorage.getItem(GUEST_MODE_KEY) || 'shared';

function sharedVisibility() {
    const value = localStorage.getItem(sharedKey());
    return value === 'true' ? true : value === 'false' ? false : null;
}

/** Initial DOM starts at the departing bar; activation performs at most one transition. */
export function getInitialFilterbarMemory(tableName) {
    if (active) return active.visible();
    if (departure !== null) return departure;
    return visibilityMemoryMode() === 'shared'
        ? sharedVisibility() ?? getStoredVisibility(tableName) : getStoredVisibility(tableName);
}

/** Explicit choice of shared memory copies the actual active bar, never another dataset key. */
export function setFilterbarVisibilityMemoryMode(mode) {
    if (!['shared', 'dataset'].includes(mode)) return;
    if (mode === 'shared') {
        const current = active?.visible() ?? departure;
        if (current !== null) localStorage.setItem(sharedKey(), String(current));
    }
    localStorage.setItem(GUEST_MODE_KEY, mode);
    document.dispatchEvent(new Event('filterbar-visibility-memory-changed'));
}

export function rememberFilterbarVisibility(tableName, visible) {
    if (visibilityMemoryMode() === 'shared') localStorage.setItem(sharedKey(), String(visible));
    // Keep the old keys throughout rollout and continue to record explicit choices.
    setStoredVisibility(tableName, visible);
}

export function filterbarVisibilityTransition(from, to, mode, reducedMotion) {
    return mode === 'dataset' && from !== to && !reducedMotion;
}

/** Bind one panel to navigation, with a cancelable transition and bounded listeners. */
export function bindFilterbarVisibilityMemory({ tableName, panel, host, container, visible, apply, isActive, signal }) {
    const owner = { visible };
    let wasActive = false;
    let frame = 0;
    let instantFrame = 0;
    let lastMode = visibilityMemoryMode();
    function setVisibility(next, animate) {
        if (!animate) container.classList.add('filterbar-visibility-instant');
        apply(next);
        if (instantFrame) cancelAnimationFrame(instantFrame);
        instantFrame = requestAnimationFrame(() => {
            // Commit the new geometry before restoring transitions.
            void panel.offsetWidth;
            container.classList.remove('filterbar-visibility-instant');
            instantFrame = 0;
        });
    }
    function sync() {
        if (!getFilterbarPreferences().loaded) return;
        const nowActive = isActive();
        if (!nowActive) { wasActive = false; return; }
        if (wasActive) return;
        wasActive = true;
        const mode = visibilityMemoryMode();
        const initialMemory = mode === 'shared' ? sharedVisibility() ?? getStoredVisibility(tableName) : getStoredVisibility(tableName);
        const from = active?.visible() ?? departure ?? initialMemory ?? visible();
        const to = mode === 'shared' ? from : getStoredVisibility(tableName) ?? from;
        active = owner;
        departure = from;
        setVisibility(from, false);
        if (frame) cancelAnimationFrame(frame);
        if (from !== to) {
            frame = requestAnimationFrame(() => {
                frame = 0;
                if (signal.aborted || !isActive()) return;
                const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
                setVisibility(to, filterbarVisibilityTransition(from, to, mode, reduced));
                if (mode === 'shared') localStorage.setItem(sharedKey(), String(to));
            });
        } else if (mode === 'shared') localStorage.setItem(sharedKey(), String(to));
    }
    host?.addEventListener(VIEW_DEACTIVATE_EVENT, () => {
        if (active === owner) { departure = visible(); active = null; }
        wasActive = false;
        if (frame) cancelAnimationFrame(frame);
    }, { signal });
    const observer = new MutationObserver(sync);
    if (host) observer.observe(host, { attributes: true, attributeFilter: ['class'] });
    function syncMemoryMode() {
        if (!getFilterbarPreferences().loaded) return;
        const mode = visibilityMemoryMode();
        if (mode !== lastMode && isActive()) {
            lastMode = mode;
            if (mode === 'shared') setFilterbarVisibilityMemoryMode(mode);
            // Loading a different memory mode is an explicit single transition.
            wasActive = false;
            sync();
        }
        lastMode = mode;
        if (!wasActive && isActive()) sync();
    }
    const unsubscribe = subscribeFilterbarPreferences(syncMemoryMode);
    document.addEventListener('filterbar-visibility-memory-changed', syncMemoryMode, { signal });
    const unsubscribeSession = subscribeToSessionGeneration(() => { wasActive = false; });
    signal.addEventListener('abort', () => {
        observer.disconnect(); unsubscribe(); unsubscribeSession();
        cancelAnimationFrame(frame); cancelAnimationFrame(instantFrame);
        if (active === owner) { departure = visible(); active = null; }
    }, { once: true });
    sync();
    return sync;
}

subscribeToSessionGeneration(() => { active = null; departure = null; });
