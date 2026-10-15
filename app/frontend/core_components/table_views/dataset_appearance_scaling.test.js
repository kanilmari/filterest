// dataset_appearance_scaling.test.js
// Counts real renderer and CSS writes while binding 50, 100 and 200 surfaces.
// Connects the UID state owner to its actual renderer without wall-clock thresholds.
// Guards linear assembly, coalesced changes, signature skips and weak lifecycle cleanup.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
vi.mock('./dataset_appearance_renderer.js', async original => {
    const renderer = await original();
    return { ...renderer, renderDatasetAppearance: vi.fn(renderer.renderDatasetAppearance),
        refreshDatasetAppearanceAdapters: vi.fn(renderer.refreshDatasetAppearanceAdapters) };
});
import { createDatasetAppearanceState } from './dataset_appearance_state.js';
import { renderDatasetAppearance, refreshDatasetAppearanceAdapters } from './dataset_appearance_renderer.js';
import { DEFAULT_DATASET_APPEARANCE } from '../../shared/dataset_appearance/validator.js';
import { appearanceValuesForPlace } from '../../shared/dataset_appearance/snapshot.js';
import { setAllSpecs } from '../state_stores/table_specs_reader.js';

function snapshot(width = 300, version = '1') {
    const effective = structuredClone(DEFAULT_DATASET_APPEARANCE); effective.shared.card_image_width = width;
    return { schema_version: 2, dataset_uid: 11, version, shared_version: 'site-1', effective,
        tab_values: appearanceValuesForPlace(effective, 'tab_only'),
        defaults: appearanceValuesForPlace(DEFAULT_DATASET_APPEARANCE, 'site_default'),
        site_values: appearanceValuesForPlace(DEFAULT_DATASET_APPEARANCE, 'site_only'),
        overrides: { 'shared.card_image_width': width } };
}
function bind(owner) {
    const node = document.createElement('section'); document.body.append(node);
    return { node, release: owner.bind(node, 'demo') };
}
beforeEach(() => { document.body.replaceChildren(); setAllSpecs({}); vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test.each([50, 100, 200])('%s binds render and write CSS linearly without touching applied siblings', async count => {
    const owner = createDatasetAppearanceState(); owner.accept('demo', snapshot());
    const writes = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty');
    const nodes = [];
    let writesPerSurface;
    try {
        for (let index = 0; index < count; index += 1) {
            const beforeRenders = renderDatasetAppearance.mock.calls.length, beforeWrites = writes.mock.calls.length;
            const { node } = bind(owner); nodes.push(node);
            // These assertions observe every bind, including before any microtask can run.
            expect(renderDatasetAppearance.mock.calls.slice(beforeRenders).map(([surface]) => surface)).toEqual([node]);
            expect(writes.mock.contexts.slice(beforeWrites).every(style => style === node.style)).toBe(true);
            writesPerSurface ??= writes.mock.calls.length;
            expect(writes.mock.calls.length - beforeWrites).toBe(writesPerSurface);
            expect(node.style.getPropertyValue('--card_image_large_width')).toBe('300px');
            owner.bind(node, 'demo'); // the production second card bind never reapplies surface CSS
            expect(renderDatasetAppearance).toHaveBeenCalledTimes(index + 1);
        }
        await Promise.resolve();
        expect(writesPerSurface).toBeGreaterThanOrEqual(30);
        expect(renderDatasetAppearance).toHaveBeenCalledTimes(count);
        expect(writes).toHaveBeenCalledTimes(count * writesPerSurface);
        expect(new Set(renderDatasetAppearance.mock.calls.map(([, config]) => config)).size).toBe(1);
        // Once assembly has settled, adding a surface does not even refresh sibling adapters.
        refreshDatasetAppearanceAdapters.mockClear();
        const added = bind(owner); await Promise.resolve();
        expect(refreshDatasetAppearanceAdapters.mock.calls.map(([surface]) => surface)).toEqual([added.node]);
        expect(renderDatasetAppearance.mock.calls.slice(count).map(([surface]) => surface)).toEqual([added.node]);
    } finally { owner.clear(); }
});

test('configuration changes coalesce per checkpoint/UID and unchanged signatures skip rendering', async () => {
    const owner = createDatasetAppearanceState(); owner.accept('demo', snapshot());
    const nodes = [bind(owner).node, bind(owner).node];
    await Promise.resolve(); renderDatasetAppearance.mockClear();
    try {
        owner.accept('demo', snapshot(410, '2'));
        owner.setPreview('palette', 'demo', snapshot(450, '2'));
        owner.releasePreview('palette', 'demo');
        owner.accept('demo', snapshot(470, '3'));
        owner.paint('demo'); owner.paint('demo');
        expect(renderDatasetAppearance).not.toHaveBeenCalled();
        await Promise.resolve();
        expect(renderDatasetAppearance.mock.calls.map(([node]) => node)).toEqual(nodes);
        expect(new Set(renderDatasetAppearance.mock.calls.map(([, config]) => config)).size).toBe(1);
        expect(nodes.every(node => node.style.getPropertyValue('--card_image_large_width') === '470px')).toBe(true);
        renderDatasetAppearance.mockClear();
        owner.accept('demo', snapshot(470, '4')); await Promise.resolve();
        expect(renderDatasetAppearance).not.toHaveBeenCalled();
        // A new bind after a change uses current state synchronously, then skips the queued repaint.
        owner.accept('demo', snapshot(480, '5'));
        const added = bind(owner).node;
        expect(added.style.getPropertyValue('--card_image_large_width')).toBe('480px');
        await Promise.resolve();
        expect(renderDatasetAppearance.mock.calls.map(([node]) => node)).toEqual([added, ...nodes]);
    } finally { owner.clear(); }
});

test.each(['release', 'forget', 'clear'])('%s cancels pending work and an obsolete disposer cannot clear a rebind', async action => {
    const owner = createDatasetAppearanceState(); owner.accept('demo', snapshot());
    const { node, release } = bind(owner);
    owner.accept('demo', snapshot(480, '2'));
    if (action === 'release') release(); else owner[action]('demo');
    renderDatasetAppearance.mockClear(); refreshDatasetAppearanceAdapters.mockClear();
    await Promise.resolve();
    expect(renderDatasetAppearance).not.toHaveBeenCalled();
    expect(refreshDatasetAppearanceAdapters).not.toHaveBeenCalled();
    expect(node.style.length).toBe(0);
    owner.accept('demo', snapshot()); owner.bind(node, 'demo'); release();
    await Promise.resolve();
    expect(node.dataset.datasetAppearanceUid).toBe('11');
    owner.clear();
});

test('collected weak surfaces are pruned without rendering or scheduling recurring work', async () => {
    const NativeWeakRef = WeakRef, refs = [];
    vi.stubGlobal('WeakRef', class {
        constructor(node) { this.ref = new NativeWeakRef(node); refs.push(this); }
        deref() { return this.collected ? undefined : this.ref.deref(); }
    });
    const owner = createDatasetAppearanceState(); owner.accept('demo', snapshot());
    const { node } = bind(owner); node.remove(); refs[0].collected = true;
    renderDatasetAppearance.mockClear(); refreshDatasetAppearanceAdapters.mockClear();
    await Promise.resolve();
    owner.accept('demo', snapshot(480, '2')); await Promise.resolve();
    expect(renderDatasetAppearance).not.toHaveBeenCalled();
    expect(refreshDatasetAppearanceAdapters).not.toHaveBeenCalled();
    owner.clear();
});
