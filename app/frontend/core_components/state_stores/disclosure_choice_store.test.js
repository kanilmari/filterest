// disclosure_choice_store.test.js
// Verifies account, tab, dataset and presentation boundaries of disclosure memory.
// Exercises the real shared storage fallback without any server or browser workload.
// Protects explicit closed choices and prevents account switching from resurrecting them.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetTabSessionFallback } from './tab_session_storage.js';
import { readDisclosureChoice, rememberDisclosureChoice, clearDisclosureChoices } from './disclosure_choice_store.js';

const context = { viewerID: 11, datasetUID: 42, surface: 'article_view', block: 'details' };

beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    forgetTabSessionFallback();
});

describe('disclosure choices in this tab', () => {
    it('preserves explicit false through page-memory reset and separates UID, surface and block', () => {
        expect(rememberDisclosureChoice(context, false)).toBe(true);
        forgetTabSessionFallback();
        expect(readDisclosureChoice(context)).toBe(false);
        expect(readDisclosureChoice({ ...context, datasetUID: 43 })).toBeNull();
        expect(readDisclosureChoice({ ...context, surface: 'image_first_view' })).toBeNull();
        expect(readDisclosureChoice({ ...context, block: 'images' })).toBeNull();
        expect(localStorage.length).toBe(0);
    });

    it('forgets the preceding account when another verified viewer arrives', () => {
        rememberDisclosureChoice(context, true);
        expect(readDisclosureChoice({ ...context, viewerID: 12 })).toBeNull();
        expect(readDisclosureChoice(context)).toBeNull();
    });

    it('forgets choices on explicit sign-out', () => {
        rememberDisclosureChoice(context, true);
        clearDisclosureChoices();
        expect(readDisclosureChoice(context)).toBeNull();
    });

    it('uses only the current tab storage, including after a separate tab has made a choice', () => {
        rememberDisclosureChoice(context, false);
        const firstTab = sessionStorage.getItem('filterest.disclosure-choices.v1');
        sessionStorage.clear();
        expect(readDisclosureChoice(context)).toBeNull();
        rememberDisclosureChoice(context, true);
        sessionStorage.setItem('filterest.disclosure-choices.v1', firstTab);
        expect(readDisclosureChoice(context)).toBe(false);
    });

    it('rejects unverified/invalid identity, missing immutable UID and malformed values', () => {
        for (const changed of [{ viewerID: null }, { viewerID: 0 }, { datasetUID: '' }, { datasetUID: 'name' }, { surface: '../x' }]) {
            expect(rememberDisclosureChoice({ ...context, ...changed }, true)).toBe(false);
        }
        expect(rememberDisclosureChoice(context, 'false')).toBe(false);
        expect(sessionStorage.length).toBe(0);
    });

    it('recovers from malformed storage without accepting truthy non-booleans', () => {
        sessionStorage.setItem('filterest.disclosure-choices.v1', '{');
        expect(readDisclosureChoice(context)).toBeNull();
        sessionStorage.setItem('filterest.disclosure-choices.v1', JSON.stringify({ viewerID: 11, choices: { '11:42:article_view:details': 'true' } }));
        expect(readDisclosureChoice(context)).toBeNull();
    });

    it('remembers and clears a choice when the browser refuses all session storage', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
        rememberDisclosureChoice(context, false);
        expect(readDisclosureChoice(context)).toBe(false);
        clearDisclosureChoices();
        expect(readDisclosureChoice(context)).toBeNull();
    });
});
