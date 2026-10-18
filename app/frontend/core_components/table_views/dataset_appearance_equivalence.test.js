// dataset_appearance_equivalence.test.js
// Compares every projected property/attribute with the frozen pre-WO19 algorithm.
// Connects real card, image, label and article adapters to both state owners.
// Protects exact presentation through batching, previews and immutable UID changes.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createDatasetAppearanceState } from './dataset_appearance_state.js';
import { createLegacyAppearanceOracle } from './dataset_appearance_legacy_test_oracle.js';
import { DEFAULT_DATASET_APPEARANCE } from '../../shared/dataset_appearance/validator.js';
import { appearanceValuesForPlace } from '../../shared/dataset_appearance/snapshot.js';
import { setAllSpecs } from '../state_stores/table_specs_reader.js';
import { mountCardFieldGroup } from './card_view/card_field_presentation.js';
import { prepareCardImagePresentation } from './card_view/card_image_presentation.js';
import { applyLabelValueLayout } from '../../reusable_components/key_value_container/label_value_layout.js';

function snapshot(uid, schema, overrides = {}, version = '1') {
    const effective = structuredClone(DEFAULT_DATASET_APPEARANCE);
    for (const [path, value] of Object.entries(overrides)) {
        const [group, key] = path.split('.'); effective[group][key] = value;
    }
    return { dataset_uid: uid, schema_version: schema, effective, overrides, version, shared_version: 'site-1',
        ...(schema === 2 ? { tab_values: appearanceValuesForPlace(effective, 'tab_only'),
            defaults: appearanceValuesForPlace(DEFAULT_DATASET_APPEARANCE, 'site_default'),
            site_values: appearanceValuesForPlace(DEFAULT_DATASET_APPEARANCE, 'site_only') } : {}) };
}

function buildSurfaces(owner) {
    const host = document.createElement('section'); document.body.append(host);
    const card = document.createElement('div'); card.className = 'card'; host.append(card);
    owner.bind(card, 'former');
    const firstCardSnapshot = properties(card);
    const fields = document.createElement('div'); card.append(fields);
    mountCardFieldGroup(card, fields, 'card', (target, showAll, style, columns) => {
        target.textContent = `Kentät 中文: ${showAll}/${style}/${columns}`;
    });
    const label = document.createElement('div'); label.innerHTML = '<span>Nimi 中文</span><span>Arvo</span>';
    card.append(label); applyLabelValueLayout(label, label.firstChild, label.lastChild);
    const image = document.createElement('div');
    image.dataset.cardImageRenderSlot = 'card_media'; image.dataset.imagePresentationKind = 'raster';
    image.innerHTML = '<img src="/storage/appearance-proof.jpg">'; card.append(image);
    owner.bind(image, 'former'); prepareCardImagePresentation(image, image.firstChild);
    image.firstChild.dispatchEvent(new Event('load'));
    const thumbnail = document.createElement('div'); thumbnail.dataset.cardImageRenderSlot = 'small_thumbnail';
    thumbnail.dataset.imagePresentationKind = 'raster'; thumbnail.innerHTML = '<img src="/storage/thumbnail.jpg">';
    card.append(thumbnail); owner.bind(thumbnail, 'former'); prepareCardImagePresentation(thumbnail, thumbnail.firstChild);
    thumbnail.firstChild.dispatchEvent(new Event('load'));
    // The production card binds before and after assembly; this second bind is intentional.
    owner.bind(card, 'former');
    const article = document.createElement('article'); article.className = 'row_article_content';
    owner.bind(article, 'former');
    article.innerHTML = '<p class="row_article_inline_image_caption">Kuvateksti 中文</p>';
    owner.bind(article, 'former'); // detached article assembly must also project its new caption
    const preview = document.createElement('section'); host.append(preview); owner.bind(preview, 'former');
    const nodes = { card, image, thumbnail, article, preview };
    return { nodes, firstCardSnapshot, release: () => owner.clear(), bindAfter(name, uid) {
        const node = document.createElement('section'); host.append(node); owner.bind(node, name, uid);
        return node;
    } };
}

function properties(node) {
    return [node, ...node.querySelectorAll('*')].map(element => ({
        // WO27 adds a source explanation; the frozen visual oracle predates it.
        attributes: Object.fromEntries([...element.attributes].filter(attribute =>
            !['style', 'data-card-image-source'].includes(attribute.name))
            .map(attribute => [attribute.name, attribute.value]).sort(([a], [b]) => a.localeCompare(b))),
        styles: Object.fromEntries(Array.from(element.style).sort().map(name =>
            [name, [element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]])),
        text: element.childElementCount ? '' : element.textContent,
    }));
}

beforeEach(() => {
    document.body.replaceChildren(); setAllSpecs({ former: { table_uid: 11 } });
    // OS dark + explicit app light is deliberately included; projections contain both palettes.
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { vi.unstubAllGlobals(); document.body.className = ''; });

test.each([1, 2].flatMap(schema => ['light', 'dark'].map(theme => [schema, theme])))(
    'exact pre-WO19 property snapshots: schema %s, explicit %s over OS dark', async (schema, theme) => {
        document.body.className = `${theme}-mode`;
        const owners = [createLegacyAppearanceOracle(), createDatasetAppearanceState()];
        const original = snapshot(11, schema, { 'light.image_blur': 7, 'dark.image_blur': 0,
            'shared.card_image_width': 420, 'shared.card_description_lines': 0,
            'shared.card_show_all_fields': false, 'shared.label_value_layout': 'inline',
            'shared.card_image_presentation': 'contain_blur', 'shared.article_image_caption_position': 'overlay' });
        owners.forEach(owner => owner.accept('former', original));
        const fixtures = owners.map(buildSurfaces), draftOwner = {};
        expect(fixtures[1].firstCardSnapshot, 'first card bind before assembly').toEqual(fixtures[0].firstCardSnapshot);
        const compare = async stage => {
            await Promise.resolve();
            expect(Object.keys(fixtures[1].nodes)).toEqual(Object.keys(fixtures[0].nodes));
            for (const key of Object.keys(fixtures[0].nodes)) {
                expect(properties(fixtures[1].nodes[key]), `${stage}: ${key}`).toEqual(properties(fixtures[0].nodes[key]));
            }
        };
        try {
            await compare('card bound again, wrappers, detached article and preview');
            owners.forEach(owner => owner.setPreview(draftOwner, 'former', snapshot(11, 2, {
                'light.oval_enabled': false, 'dark.oval_enabled': true, 'shared.card_image_width': 510,
                'shared.card_style_variant': 'standard', 'shared.label_value_layout': 'stacked',
                'shared.card_image_presentation': 'contain', 'shared.article_image_caption_position': 'below' })));
            await compare('preview override');
            owners.forEach(owner => owner.releasePreview(draftOwner, 'former'));
            await compare('preview released');
            const site = structuredClone(DEFAULT_DATASET_APPEARANCE);
            site.shared.card_detail_columns = 4; site.dark.image_blur = 13; site.light.image_blur = 2;
            owners.forEach(owner => owner.updateSite(site, { version: 'site-2', preview: true }));
            await compare('site preview');
            owners.forEach(owner => owner.updateSite(DEFAULT_DATASET_APPEARANCE, { version: 'site-1', changed: false }));
            await compare('site preview released');
            setAllSpecs({ renamed: { table_uid: 11 }, former: { table_uid: 22 } });
            owners.forEach(owner => owner.accept('former', snapshot(22, schema)));
            fixtures.forEach(fixture => { fixture.nodes.replacement = fixture.bindAfter('former', 22); });
            owners.forEach(owner => owner.accept('renamed', snapshot(11, schema, {
                'shared.card_image_width': 444, 'shared.card_style_variant': 'standard' }, '2')));
            // Bind before the queued configuration repaint: it must already use the latest config.
            fixtures.forEach(fixture => { fixture.nodes.afterChange = fixture.bindAfter('renamed', 11); });
            expect(fixtures[1].nodes.afterChange.style.getPropertyValue('--card_image_large_width')).toBe('444px');
            await compare('owner rename, old name reuse and a late-bound surface');
            owners.forEach(owner => owner.revoke('renamed'));
            await compare('revoked owner');
        } finally { fixtures.forEach(fixture => fixture.release()); }
    },
);
