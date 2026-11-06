// @vitest-environment jsdom
// Regression proofs for tab privacy, inheritance and deliberate-user-only storage.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const session = vi.hoisted(() => ({ viewer: 7, generation: 0, subscribers: new Set(), validate: vi.fn() }));
vi.mock('../auth/session_generation_store.js', () => ({
    getVerifiedSessionIdentity: () => session.viewer,
    getSessionGeneration: () => session.generation,
    subscribeToSessionGeneration: callback => { session.subscribers.add(callback); return () => session.subscribers.delete(callback); },
    revalidateSessionIdentity: (...args) => session.validate(...args),
}));
import { bindDisclosureSurface, disposeDisclosureSurface } from './disclosure_state_controller.js';
import { readDisclosureChoice, clearDisclosureChoices } from '../state_stores/disclosure_choice_store.js';
import { createDatasetAppearanceState } from '../table_views/dataset_appearance_state.js';
import { DEFAULT_DATASET_APPEARANCE } from '../../shared/dataset_appearance/validator.js';

const roots = [];
function make({ uid = 31, surface = 'filterbar', block = 'tools', fallback = false } = {}) {
    const root = document.createElement('div');
    root.dataset.datasetAppearanceScope = 'dataset'; root.dataset.datasetAppearanceUid = String(uid);
    const section = document.createElement('section');
    if (surface === 'filterbar') section.dataset.filterbarSectionKey = block;
    else section.dataset.articleDisclosureKey = block;
    section.expand = vi.fn(() => { section.dataset.open = 'true'; return Promise.resolve(); });
    section.collapse = vi.fn(() => { section.dataset.open = 'false'; return Promise.resolve(); });
    root.append(section); document.body.append(root); roots.push(root);
    bindDisclosureSurface(root, surface);
    const config = { shared: { [`${surface}_${block}_initial_open`]: fallback } };
    root.__syncDisclosureState(config);
    return { root, section, config, choice: () => readDisclosureChoice({ viewerID: session.viewer, datasetUID: uid, surface, block }) };
}
function click(section, expanded) {
    section.dataset.open = String(expanded);
    section.dispatchEvent(new CustomEvent('animated-disclosure-user-toggle', { bubbles: true, detail: { section, expanded } }));
}
async function tick() { await new Promise(resolve => setTimeout(resolve, 0)); }
beforeEach(() => {
    clearDisclosureChoices(); session.viewer = 7; session.generation = 0;
    session.validate.mockReset().mockResolvedValue(0);
});
afterEach(() => { roots.splice(0).forEach(root => { disposeDisclosureSurface(root); root.remove(); }); });

describe('private disclosure choices', () => {
    it('keeps a reauthorized surface live while clearing denied projections and disposing released roots', async () => {
        const owner = createDatasetAppearanceState();
        const snapshot = { dataset_uid: 31, schema_version: 1, version: '1', shared_version: 'site-1',
            effective: structuredClone(DEFAULT_DATASET_APPEARANCE), overrides: {} };
        expect(owner.accept('dataset', snapshot)).toBe(true);
        const mounted = make();
        owner.bind(mounted.root, 'dataset', 31);
        click(mounted.section, true);
        owner.revoke('dataset'); await tick();
        expect(mounted.section.dataset.open).toBe('false');
        expect(mounted.root.dataset.datasetAppearanceUid).toBeUndefined();
        expect(mounted.root.__syncDisclosureState).toBeTypeOf('function');
        expect(mounted.choice()).toBe(true);
        expect(owner.accept('dataset', { ...snapshot, version: '2' })).toBe(true);
        const release = owner.bind(mounted.root, 'dataset', 31, { snapshotAllowed: true });
        await tick();
        expect(mounted.section.dataset.open).toBe('true');
        click(mounted.section, false);
        expect(make({ fallback: true }).section.dataset.open).toBe('false');
        release();
        expect(mounted.root.__syncDisclosureState).toBeUndefined();
        click(mounted.section, true);
        expect(mounted.choice()).toBe(false);
        owner.clear();
    });
    it('records the header choice without restarting its already-running animation', () => {
        const mounted = make();
        mounted.section.expand.mockClear(); mounted.section.collapse.mockClear();
        // The primitive updates this state synchronously before publishing activation.
        mounted.section.dataset.disclosureState = 'expanded';
        click(mounted.section, true);
        expect(mounted.choice()).toBe(true);
        expect(mounted.section.expand).not.toHaveBeenCalled();
        expect(mounted.section.collapse).not.toHaveBeenCalled();
        mounted.section.dataset.disclosureState = 'collapsed';
        click(mounted.section, false);
        expect(mounted.choice()).toBe(false);
        expect(mounted.section.collapse).not.toHaveBeenCalled();
    });
    it('preserves an explicit closed choice above an open inherited default after remount', () => {
        const first = make({ fallback: true });
        expect(first.section.dataset.open).toBe('true'); click(first.section, false);
        expect(first.choice()).toBe(false);
        const replacement = make({ fallback: true });
        expect(replacement.section.dataset.open).toBe('false');
        expect(make({ uid: 32, fallback: true }).section.dataset.open).toBe('true');
    });
    it('keeps article, IFAV and CIFAV choices separate on the same immutable dataset UID', () => {
        const article = make({ surface: 'article_view', block: 'details', fallback: true });
        click(article.section, false);
        for (const surface of ['image_first_view', 'image_first_page_view']) {
            expect(make({ surface, block: 'details', fallback: true }).section.dataset.open).toBe('true');
        }
    });
    it('does not persist programmatic expansion or overwrite it on an unchanged refresh', async () => {
        const mounted = make();
        await mounted.section.expand();
        mounted.section.dispatchEvent(new CustomEvent('animated-disclosure-toggle', { bubbles: true, detail: { expanded: true } }));
        mounted.root.__syncDisclosureState(mounted.config);
        expect(mounted.section.dataset.open).toBe('true'); expect(mounted.choice()).toBeNull();
        expect(make().section.dataset.open).toBe('false');
    });
    it('rejects temporary shortcut events and nested dataset events', () => {
        const outer = make(), inner = make({ uid: 32 });
        outer.section.append(inner.root);
        inner.section.dataset.filterbarTemporaryDisclosureOperation = 'true'; click(inner.section, true);
        expect(inner.choice()).toBeNull(); expect(outer.choice()).toBeNull();
        delete inner.section.dataset.filterbarTemporaryDisclosureOperation; click(inner.section, true);
        expect(inner.choice()).toBe(true); expect(outer.choice()).toBeNull();
    });
    it('restores a late hydrated block without storing a new choice', async () => {
        const mounted = make(); click(mounted.section, true);
        const late = document.createElement('section'); late.dataset.filterbarSectionKey = 'tools';
        late.expand = vi.fn(async () => { late.dataset.open = 'true'; }); late.collapse = vi.fn();
        mounted.section.replaceWith(late); await tick();
        expect(late.dataset.open).toBe('true'); expect(mounted.choice()).toBe(true);
    });
    it.each([
        ['filterbar', 'tools'], ['article_view', 'details'],
        ['image_first_view', 'details'], ['image_first_page_view', 'details'],
    ])('restores open and explicitly closed %s choices after bootstrap verifies the same account', async (surface, block) => {
        for (const expanded of [true, false]) {
            const original = make({ surface, block, fallback: !expanded });
            click(original.section, expanded);
            // Reload discards the old DOM and verified identity, but keeps tab storage.
            disposeDisclosureSurface(original.root); original.root.remove();
            session.generation++; session.viewer = null;
            session.subscribers.forEach(callback => callback('bootstrap'));
            let verify;
            session.validate.mockImplementation(() => new Promise(resolve => { verify = resolve; }));
            const reloaded = make({ surface, block, fallback: !expanded });
            expect(reloaded.section.dataset.open).toBeUndefined();
            expect(session.validate).toHaveBeenCalledWith({ requireIdentity: true });
            session.viewer = 7; verify(session.generation);
            await reloaded.root.__disclosureStateReady;
            expect(reloaded.section.dataset.open).toBe(String(expanded));
            expect(reloaded.choice()).toBe(expanded);
            disposeDisclosureSurface(reloaded.root); reloaded.root.remove();
        }
    });
    it('discards the preceding account choices when bootstrap verifies a different viewer', async () => {
        const original = make(); click(original.section, true);
        disposeDisclosureSurface(original.root); original.root.remove();
        session.generation++; session.viewer = null;
        session.subscribers.forEach(callback => callback('bootstrap'));
        let verify;
        session.validate.mockImplementation(() => new Promise(resolve => { verify = resolve; }));
        const reloaded = make();
        expect(reloaded.section.dataset.open).toBeUndefined();
        session.viewer = 8; verify(session.generation);
        await reloaded.root.__disclosureStateReady;
        expect(reloaded.section.dataset.open).toBe('false');
        expect(reloaded.choice()).toBeNull();
        session.viewer = 7;
        expect(make().choice()).toBeNull();
    });
    it('retains same-account choices on focus but forgets them on logout and another account', async () => {
        const mounted = make(); click(mounted.section, true);
        session.subscribers.forEach(callback => callback('focus')); await tick();
        expect(mounted.choice()).toBe(true);
        session.generation++; session.viewer = 8;
        session.subscribers.forEach(callback => callback('logout')); await tick();
        expect(mounted.section.dataset.open).toBe('false'); expect(mounted.choice()).toBeNull();
        session.viewer = 7; expect(mounted.choice()).toBeNull();
    });
    it('does not attribute a pending old-account click to a newly verified account', async () => {
        const mounted = make(); let resolve;
        session.viewer = null; session.validate.mockImplementation(() => new Promise(done => { resolve = done; }));
        click(mounted.section, true);
        session.viewer = 8; resolve(); await tick();
        expect(mounted.choice()).toBeNull();
    });
    it('ignores disposed roots and stale identity generations', async () => {
        const mounted = make(); let resolve;
        session.viewer = null; session.validate.mockImplementation(() => new Promise(done => { resolve = done; }));
        click(mounted.section, true); session.generation++; session.viewer = 7;
        disposeDisclosureSurface(mounted.root); resolve(); await tick();
        expect(mounted.choice()).toBeNull();
    });
});
