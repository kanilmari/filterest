// dataset_appearance_state.test.js
// Proves UID ownership, nested/detached rendering and lifecycle races.
// Uses real presentation adapters with authorized response-shaped snapshots.
// Protects inheritance and version-one previews without a database or browser server.
import { beforeEach, describe, expect, test } from 'vitest';
import { createDatasetAppearanceState, datasetAppearanceState } from './dataset_appearance_state.js';
import { DEFAULT_DATASET_APPEARANCE, DATASET_APPEARANCE_PATHS } from '../../shared/dataset_appearance/validator.js';
import { appearanceValuesForPlace } from '../../shared/dataset_appearance/snapshot.js';
import { setAllSpecs } from '../state_stores/table_specs_reader.js';
import { createSitePresentationState, normalizePresentationSettings } from '../admin_tools/site_presentation_state.js';
import { invalidateSessionGeneration } from '../auth/session_generation_store.js';
import { mountCardFieldGroup } from './card_view/card_field_presentation.js';
import { prepareCardImagePresentation } from './card_view/card_image_presentation.js';
import { applyLabelValueLayout } from '../../reusable_components/key_value_container/label_value_layout.js';

const clone = value => JSON.parse(JSON.stringify(value));
function snapshot(uid, overrides = {}, { version = '1', sharedVersion = 'site-1', schema = 1 } = {}) {
    const shared = clone(DEFAULT_DATASET_APPEARANCE), effective = clone(shared);
    for (const [path, value] of Object.entries(overrides)) {
        const [group, key] = path.split('.'); effective[group][key] = value;
    }
    const maps = schema === 2 ? { tab_values: appearanceValuesForPlace(effective, 'tab_only'),
        site_values: appearanceValuesForPlace(shared, 'site_only'), defaults: appearanceValuesForPlace(shared, 'site_default') } : {};
    return { ...maps, dataset_uid: uid, schema_version: schema, shared, effective, overrides,
        shared_version: sharedVersion, version };
}
function surface(owner, name, parent = document.body, uid = null) {
    const node = document.createElement('section');
    parent.append(node); owner.bind(node, name, uid); return node;
}
function card(owner, name, parent) {
    const node = document.createElement('div'); node.className = 'card'; node.dataset.datasetName = name;
    parent.append(node); owner.bind(node, name);
    mountCardFieldGroup(node, node, 'card', (host, showAll, style, columns) => {
        const field = document.createElement('span'); field.className = 'fields';
        field.textContent = `${showAll}:${style}:${columns}`; host.append(field);
    });
    const pair = document.createElement('div'); pair.innerHTML = '<span>Osoite</span><span>Arvo</span>';
    node.append(pair); applyLabelValueLayout(pair, pair.firstChild, pair.lastChild);
    const photo = document.createElement('div');
    photo.dataset.cardImageRenderSlot = 'card_media'; photo.dataset.imagePresentationKind = 'raster';
    const image = document.createElement('img'); image.src = '/storage/example.jpg';
    photo.append(image); node.append(photo); prepareCardImagePresentation(photo, image);
    image.dispatchEvent(new Event('load'));
    owner.paint(name); return node;
}

beforeEach(() => {
    datasetAppearanceState.clear(); setAllSpecs({}); localStorage.clear();
    document.body.replaceChildren(); document.documentElement.removeAttribute('style');
    for (const key of ['cardShowAllFields', 'cardStyleVariant', 'cardDetailColumns', 'cardImagePresentation',
        'labelValueLayout', 'articleImageCaptionPosition']) delete document.documentElement.dataset[key];
});

describe('dataset appearance ownership', () => {
    test('public-only bindings cannot recover snapshots by name or UID on later paints', () => {
        const owner = createDatasetAppearanceState();
        owner.accept('private', snapshot(11, { 'shared.card_image_width': 480,
            'shared.label_value_layout': 'inline', 'shared.card_image_presentation': 'contain_blur' }));
        const parent = surface(owner, 'private'), related = document.createElement('section');
        parent.append(related);
        owner.bind(related, 'private', 11, { snapshotAllowed: false });
        owner.paint('private');
        expect(related.dataset.datasetAppearanceResolved).toBe('false');
        expect(related.dataset.datasetAppearanceUid).toBeUndefined();
        expect(related.style.getPropertyValue('--card_image_large_width')).toBe('300px');
        expect(related.dataset.labelValueLayout).toBe('stacked');
        expect(related.dataset.cardImagePresentation).toBe('contain');
        const site = clone(DEFAULT_DATASET_APPEARANCE); site.shared.card_image_width = 360;
        owner.updateSite(site, { version: 'site-2' });
        owner.accept('private', snapshot(11, { 'shared.card_image_width': 500 }, { version: '2' }));
        expect(related.style.getPropertyValue('--card_image_large_width')).toBe('360px');
        expect(related.dataset.datasetAppearanceResolved).toBe('false');
        expect(parent.style.getPropertyValue('--card_image_large_width')).toBe('500px');
    });

    test('revocation forgets the UID and draft across aliases without cancelling readable row guards', () => {
        const owner = createDatasetAppearanceState();
        owner.accept('private', snapshot(11, { 'shared.card_image_width': 480 }, { schema: 2 }));
        setAllSpecs({ private: { table_uid: 11 }, renamed: { table_uid: 11 } });
        const first = surface(owner, 'private'), alias = surface(owner, 'renamed');
        owner.setPreview({}, 'private', snapshot(11, { 'shared.card_image_width': 500 }, { schema: 2 }));
        const earlier = owner.captureRegistry(), denial = owner.captureRegistry();
        expect(owner.revoke('private', { token: denial })).toBe(true);
        expect(owner.isCurrent(denial)).toBe(true);
        expect(owner.savedSnapshot('private')).toBeNull();
        expect(owner.savedSnapshot('renamed')).toBeNull();
        expect(owner.setPreview({}, 'private', snapshot(11, {}, { schema: 2 }))).toBe(false);
        expect(first.dataset.datasetAppearanceUid).toBeUndefined();
        expect(alias.style.getPropertyValue('--card_image_large_width')).toBe('300px');
        expect(owner.accept('renamed', snapshot(11), { token: earlier })).toBe(false);
        expect(owner.accept('private', snapshot(11), { token: denial })).toBe(false);
        expect(owner.accept('renamed', snapshot(11), { token: owner.captureRegistry() })).toBe(true);
        expect(owner.savedSnapshot('private')).not.toBeNull();
        // A cleared surface needs its own successful revalidation to use the new snapshot.
        expect(first.dataset.datasetAppearanceResolved).toBe('false');
        owner.bind(first, 'private', 11);
        expect(first.dataset.datasetAppearanceResolved).toBe('true');
    });

    test('a surface cannot change its UID by binding under a different name', () => {
        const owner = createDatasetAppearanceState();
        owner.accept('first', snapshot(11, { 'shared.card_style_variant': 'standard' }));
        owner.accept('second', snapshot(22));
        const original = surface(owner, 'first');
        owner.bind(original, 'second', 22);
        owner.paint('second');
        expect(original.dataset.datasetAppearanceUid).toBe('11');
        expect(original.dataset.cardStyleVariant).toBe('standard');
    });
    test('former-name reuse keeps simultaneous renamed and replacement surfaces on their immutable UIDs', () => {
        const owner = createDatasetAppearanceState();
        setAllSpecs({ former: { table_uid: 11 } });
        owner.accept('former', snapshot(11, { 'shared.card_style_variant': 'standard' }));
        const original = surface(owner, 'former');
        const draftOwner = {};
        owner.setPreview(draftOwner, 'former', snapshot(11, { 'shared.card_style_variant': 'modern' }, { schema: 2 }));
        const pending = owner.capture('former');
        setAllSpecs({ renamed: { table_uid: 11 }, former: { table_uid: 22 } });
        expect(owner.isCurrent(pending)).toBe(false);
        expect(owner.accept('former', snapshot(22))).toBe(true);
        expect(owner.releasePreview(draftOwner, 'former')).toBe(true);
        const replacement = surface(owner, 'former', document.body, 22);
        const renamed = surface(owner, 'renamed', document.body, 11);
        owner.accept('renamed', snapshot(11, { 'shared.card_image_width': 444,
            'shared.card_style_variant': 'standard' }, { version: '2' }));
        owner.paint('former');
        expect(original.dataset.datasetAppearanceUid).toBe('11');
        expect(original.dataset.cardStyleVariant).toBe('standard');
        expect(original.style.getPropertyValue('--card_image_large_width')).toBe('444px');
        expect(renamed.dataset.datasetAppearanceUid).toBe('11');
        expect(replacement.dataset.datasetAppearanceUid).toBe('22');
        expect(replacement.dataset.cardStyleVariant).toBe('modern');
        owner.forget('former');
        expect(replacement.dataset.datasetAppearanceUid).toBeUndefined();
        expect(original.dataset.datasetAppearanceUid).toBe('11');
        expect(renamed.dataset.datasetAppearanceUid).toBe('11');
    });

    test('a supplied UID rebinds a reused name without changing an already bound surface', () => {
        const owner = createDatasetAppearanceState();
        owner.accept('former', snapshot(11, { 'shared.card_style_variant': 'standard' }));
        const original = surface(owner, 'former');
        const pending = owner.capture('former');
        const replacement = surface(owner, 'former', document.body, 22);
        expect(owner.isCurrent(pending)).toBe(false);
        expect(owner.accept('former', snapshot(22))).toBe(true);
        expect(original.dataset.datasetAppearanceUid).toBe('11');
        expect(original.dataset.cardStyleVariant).toBe('standard');
        expect(replacement.dataset.datasetAppearanceUid).toBe('22');
        expect(replacement.dataset.cardStyleVariant).toBe('modern');
    });

    test.each([false, true])('the first tree confirms an authorized owner (snapshot before capture: %s)', acceptedBeforeCapture => {
        const owner = createDatasetAppearanceState(), response = snapshot(11, {}, { schema: 2 });
        if (acceptedBeforeCapture) owner.accept('a', response);
        const pending = owner.capture('a');
        expect(owner.accept('a', response, { token: pending })).toBe(true);
        setAllSpecs({ a: { table_uid: 11 } });
        expect(owner.isCurrent(pending)).toBe(true);
        expect(owner.accept('a', snapshot(11, {}, { schema: 2, version: '2' }), { token: pending })).toBe(true);
        setAllSpecs({ a: { table_uid: 22 } }); setAllSpecs({ a: { table_uid: 11 } });
        expect(owner.isCurrent(pending)).toBe(false);
    });

    test('first discovery cannot authorize an unknown response or replace an accepted UID', () => {
        const owner = createDatasetAppearanceState();
        const unknown = owner.capture('unknown');
        setAllSpecs({ unknown: { table_uid: 11 } });
        expect(owner.isCurrent(unknown)).toBe(false);
        expect(owner.accept('unknown', snapshot(11), { token: unknown })).toBe(false);
        const pending = owner.capture('a'); owner.accept('a', snapshot(11), { token: pending });
        setAllSpecs({ unknown: { table_uid: 11 }, a: { table_uid: 22 } });
        expect(owner.isCurrent(pending)).toBe(false);
        expect(owner.accept('a', snapshot(22), { token: pending })).toBe(false);
        owner.forget('a');
        setAllSpecs({ unknown: { table_uid: 11 }, a: { table_uid: 11 } });
        expect(owner.isCurrent(pending)).toBe(false);
    });

    test('registry replacement and restoration invalidates pending name requests even with no known UID', () => {
        const owner = createDatasetAppearanceState();
        const pending = owner.capture('unknown');
        setAllSpecs({ unknown: { table_uid: 22 } });
        setAllSpecs({});
        expect(owner.isCurrent(pending)).toBe(false);
        expect(owner.accept('unknown', snapshot(11), { token: pending })).toBe(false);
        setAllSpecs({ former: { table_uid: 11 } });
        const original = owner.capture('former');
        setAllSpecs({ former: { table_uid: 22 } });
        setAllSpecs({ former: { table_uid: 11 } });
        expect(owner.isCurrent(original)).toBe(false);
    });

    test('renders two UIDs and nested related surfaces without root or sibling leakage', () => {
        const owner = createDatasetAppearanceState();
        owner.accept('a', snapshot(11, { 'light.image_blur': 7, 'shared.card_style_variant': 'standard',
            'shared.card_image_width': 420, 'shared.card_detail_columns': 4, 'shared.label_value_layout': 'inline',
            'shared.card_image_presentation': 'contain_blur', 'shared.card_show_all_fields': false }));
        owner.accept('b', snapshot(22));
        const a = surface(owner, 'a'), b = surface(owner, 'b', a);
        const first = card(owner, 'a', a), related = card(owner, 'b', b);
        owner.paint('a');
        expect(a.dataset.datasetAppearanceUid).toBe('11'); expect(b.dataset.datasetAppearanceUid).toBe('22');
        expect(a.style.getPropertyValue('--dataset-background-light-image-blur')).toBe('7px');
        expect(b.style.getPropertyValue('--dataset-background-light-image-blur')).toBe('1px');
        expect(first.querySelector('.fields').textContent).toBe('false:standard:4');
        expect(related.querySelector('.fields').textContent).toBe('true:modern:2');
        expect(first.querySelector('.label-value-layout').dataset.labelValueLayout).toBe('inline');
        expect(related.querySelector('.label-value-layout').dataset.labelValueLayout).toBe('stacked');
        expect(first.querySelector('.card_photo_presentation').style.getPropertyValue('--card-photo-source')).toContain('example.jpg');
        expect(related.querySelector('.card_photo_presentation').style.getPropertyValue('--card-photo-source')).toBe('');
        expect(document.documentElement.dataset.cardStyleVariant).toBeUndefined();
        expect(document.documentElement.style.getPropertyValue('--card_image_large_width')).toBe('');
    });

    test('releasing a card-only preview restores the current scoped source rather than its rendered draft', () => {
        datasetAppearanceState.accept('a', snapshot(11, { 'shared.card_style_variant': 'standard', 'shared.card_detail_columns': 3 }, { schema: 2 }));
        const host = surface(datasetAppearanceState, 'a'), item = card(datasetAppearanceState, 'a', host), preview = {};
        datasetAppearanceState.setPreview(preview, 'a', snapshot(11, { 'shared.card_style_variant': 'modern', 'shared.card_detail_columns': 4 }, { schema: 2 }));
        expect(item.querySelector('.fields').textContent).toBe('true:modern:4');
        datasetAppearanceState.releasePreview(preview, 'a');
        expect(item.querySelector('.fields').textContent).toBe('true:standard:3');
        datasetAppearanceState.accept('a', snapshot(11, { 'shared.card_style_variant': 'modern', 'shared.card_detail_columns': 1 }, { version: '2' }));
        expect(item.querySelector('.fields').textContent).toBe('true:modern:1');
    });

    test('detached article surfaces keep their UID, captions and labels through inherited updates', () => {
        const owner = createDatasetAppearanceState();
        owner.accept('a', snapshot(11)); owner.accept('b', snapshot(22, { 'shared.article_image_caption_position': 'below' }));
        const a = surface(owner, 'a'), b = surface(owner, 'b');
        for (const node of [a, b]) {
            node.innerHTML = '<article class="row_article_content"><span class="row_article_inline_image_caption">Kuvateksti</span></article>';
        }
        const modal = document.createElement('section'); document.body.append(modal); modal.append(a);
        const draft = clone(DEFAULT_DATASET_APPEARANCE);
        draft.shared.article_image_caption_position = 'overlay'; draft.shared.label_value_layout = 'inline';
        owner.updateSite(draft, { version: 'site-2' });
        expect(a.querySelector('.row_article_inline_image_caption').dataset.articleImageCaptionPosition).toBe('overlay');
        expect(b.querySelector('.row_article_inline_image_caption').dataset.articleImageCaptionPosition).toBe('below');
        // A detached assembly surface also receives changes before it mounts.
        a.remove(); draft.shared.article_image_caption_position = 'below'; owner.updateSite(draft, { preview: true });
        expect(a.querySelector('.row_article_content').dataset.articleImageCaptionPosition).toBe('below');
        expect(a.dataset.datasetAppearanceUid).toBe('11');
    });

    test('v1 previews retain cover behavior and explicit zero/false/equality, with saved reset', () => {
        const owner = createDatasetAppearanceState(), original = clone(DEFAULT_DATASET_APPEARANCE);
        owner.updateSite(original, { version: 'site-1' });
        owner.accept('a', snapshot(11, { 'shared.card_description_lines': 0, 'shared.card_show_all_fields': false,
            'shared.card_detail_columns': original.shared.card_detail_columns }));
        const node = surface(owner, 'a'), unchanged = node.style.cssText;
        const draft = clone(original); draft.light.image_blur = 9; draft.dark.image_blur = 0;
        draft.shared.card_description_lines = 3; draft.shared.card_show_all_fields = true; draft.shared.card_detail_columns = 4;
        owner.updateSite(draft, { version: 'site-1', preview: true, changed: false });
        expect(node.style.getPropertyValue('--dataset-background-light-image-blur')).toBe('9px');
        expect(node.style.getPropertyValue('--dataset-background-dark-image-blur')).toBe('0px');
        expect(node.style.getPropertyValue('--card-description-lines')).toBe('0');
        expect(node.dataset.cardShowAllFields).toBe('false'); expect(node.dataset.cardDetailColumns).toBe('2');
        owner.updateSite(original, { version: 'site-1', changed: false });
        expect(node.style.cssText).toBe(unchanged);
    });

    test('a site save/preview recomputes v2 defaults while preserving covers and overrides', () => {
        const owner = createDatasetAppearanceState();
        const response = snapshot(11, { 'shared.card_detail_columns': 2 }, { schema: 2 });
        response.effective.light.image_blur = 6; response.effective.shared.hero_extra_height = 80;
        response.tab_values = appearanceValuesForPlace(response.effective, 'tab_only');
        owner.accept('a', response); const a = surface(owner, 'a');
        const draft = clone(DEFAULT_DATASET_APPEARANCE);
        draft.light.image_blur = 19; draft.shared.hero_extra_height = 120;
        draft.shared.card_detail_columns = 4; draft.shared.card_image_width = 390;
        owner.updateSite(draft, { version: 'site-2' });
        expect(a.style.getPropertyValue('--dataset-background-light-image-blur')).toBe('6px');
        expect(a.style.getPropertyValue('--dataset-cover-hero-extra-height')).toBe('80px');
        expect(a.style.getPropertyValue('--card_image_large_width')).toBe('390px');
        expect(a.dataset.cardDetailColumns).toBe('2');
        draft.shared.card_image_width = 450; owner.updateSite(draft, { preview: true });
        expect(a.style.getPropertyValue('--card_image_large_width')).toBe('450px');
        expect(a.style.getPropertyValue('--dataset-background-light-image-blur')).toBe('6px');
    });

    test('guards older revisions, late requests, caller cancellation and UID/name replacement', () => {
        const owner = createDatasetAppearanceState();
        const old = owner.capture('a'), newer = owner.capture('a');
        expect(owner.accept('a', snapshot(11, {}, { version: '2' }), { token: newer })).toBe(true);
        expect(owner.accept('a', snapshot(11, {}, { version: '1' }), { token: old })).toBe(false);
        expect(owner.accept('a', snapshot(11, {}, { version: '2', sharedVersion: 'stale' }), { token: old })).toBe(false);
        expect(owner.accept('a', snapshot(22))).toBe(false);
        expect(owner.accept('a', snapshot(11, {}, { version: '3' }), { isCurrent: () => false })).toBe(false);
        const pending = owner.capture('a'), site = clone(DEFAULT_DATASET_APPEARANCE); site.shared.card_image_width = 410;
        owner.updateSite(site, { version: 'site-2' });
        expect(owner.accept('a', snapshot(11, {}, { version: '2' }), { token: pending })).toBe(true);
        expect(owner.effective('a').shared.card_image_width).toBe(410);
        owner.forget('a'); expect(owner.accept('a', snapshot(11), { token: pending })).toBe(false);
        expect(owner.accept('a', snapshot(22))).toBe(true);
    });

    test('rename preserves UID, retained surfaces read mutable state and disposal clears projections', () => {
        const owner = createDatasetAppearanceState(); owner.accept('old', snapshot(11));
        const old = surface(owner, 'old'); owner.accept('renamed', snapshot(11, { 'shared.card_image_width': 440 }, { version: '2' }));
        expect(old.style.getPropertyValue('--card_image_large_width')).toBe('440px');
        const detached = document.createElement('article'), release = owner.bind(detached, 'renamed');
        expect(detached.style.getPropertyValue('--card_image_large_width')).toBe('440px');
        release(); expect(detached.dataset.datasetAppearanceUid).toBeUndefined(); expect(detached.style.length).toBe(0);
        owner.setPreview({}, 'old', snapshot(11, { 'shared.card_style_variant': 'standard', 'shared.card_detail_columns': 4 }, { schema: 2 }));
        owner.forget('renamed'); expect(old.dataset.datasetAppearanceUid).toBeUndefined(); expect(old.style.length).toBe(0);
        owner.accept('old', snapshot(11)); expect(card(owner, 'old', document.body).querySelector('.fields').textContent).toBe('true:modern:2');
    });

    test('sign-out removes private snapshots/previews before a late response, keeping public defaults', () => {
        datasetAppearanceState.accept('private', snapshot(11, { 'shared.card_style_variant': 'standard' }));
        const node = surface(datasetAppearanceState, 'private'); const item = card(datasetAppearanceState, 'private', node);
        datasetAppearanceState.setPreview({}, 'private', snapshot(11, { 'shared.card_style_variant': 'standard', 'shared.card_detail_columns': 4 }, { schema: 2 }));
        const pending = datasetAppearanceState.capture('private'); invalidateSessionGeneration({ reason: 'logout' });
        expect(node.dataset.datasetAppearanceUid).toBeUndefined(); expect(item.dataset.datasetAppearanceUid).toBeUndefined();
        expect(datasetAppearanceState.accept('private', snapshot(11), { token: pending })).toBe(false);
        datasetAppearanceState.accept('private', snapshot(11)); datasetAppearanceState.bind(item, 'private');
        expect(item.querySelector('.fields').textContent).toBe('true:modern:2');
        expect(localStorage.getItem('private_dataset_appearance')).toBeNull();
    });

    test('a late public GET cannot replace a newer results snapshot, while a site save updates inheritance', async () => {
        let resolve;
        const site = createSitePresentationState({ storage: null, requestFn: () => new Promise(done => { resolve = done; }) });
        const loading = site.loadSettings(); await Promise.resolve();
        const response = snapshot(11, {}, { sharedVersion: 'newer-site' });
        response.effective.light.image_blur = 8; response.effective.shared.card_image_width = 410;
        datasetAppearanceState.accept('a', response);
        const a = surface(datasetAppearanceState, 'a');
        resolve({ version: 'old-site', dataset_cover_theme: clone(DEFAULT_DATASET_APPEARANCE) }); await loading; site.paint();
        expect(a.style.getPropertyValue('--dataset-background-light-image-blur')).toBe('8px');
        expect(a.style.getPropertyValue('--card_image_large_width')).toBe('410px');
        const draft = site.savedSettings(); draft.dataset_cover_theme.shared.card_image_width = 450;
        await site.saveSettings(draft, async () => ({ ...normalizePresentationSettings(draft), version: 'saved-site' }));
        expect(a.style.getPropertyValue('--card_image_large_width')).toBe('450px');
    });

    test('all unchanged visual values remain exact and Home keeps its independent contract', () => {
        const owner = createDatasetAppearanceState(); owner.accept('a', snapshot(11)); const node = surface(owner, 'a');
        for (const path of DATASET_APPEARANCE_PATHS) {
            const [group, key] = path.split('.'); expect(owner.effective('a')[group][key]).toBe(DEFAULT_DATASET_APPEARANCE[group][key]);
        }
        const home = document.createElement('section'); home.style.setProperty('--home-light-wash', '0.4');
        owner.bind(home, 'home'); owner.updateSite(clone(DEFAULT_DATASET_APPEARANCE), { preview: true });
        expect(home.dataset.datasetAppearanceScope).toBeUndefined(); expect(home.style.length).toBe(1);
        expect(node.style.getPropertyValue('--dataset-cover-light-mask-position-y')).toBe('56%');
    });
});
