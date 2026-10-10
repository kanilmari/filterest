// dataset_appearance_cleanup.test.js
// Checks all private projections immediately after lifecycle invalidation.
// Connects actual field, label, image and caption adapters with retained DOM.
// Protects connected and detached owners while preserving another nested UID.
import { beforeEach, expect, test } from 'vitest';
import { createDatasetAppearanceState } from './dataset_appearance_state.js';
import { DEFAULT_DATASET_APPEARANCE } from '../../shared/dataset_appearance/validator.js';
import { setAllSpecs } from '../state_stores/table_specs_reader.js';
import { mountCardFieldGroup } from './card_view/card_field_presentation.js';
import { prepareCardImagePresentation } from './card_view/card_image_presentation.js';
import { applyLabelValueLayout } from '../../reusable_components/key_value_container/label_value_layout.js';

function privateSnapshot(uid) {
    const effective = structuredClone(DEFAULT_DATASET_APPEARANCE);
    Object.assign(effective.shared, { label_value_layout: 'inline', card_image_presentation: 'contain_blur',
        article_image_caption_position: 'overlay', card_style_variant: 'modern', card_detail_columns: 4 });
    return { dataset_uid: uid, schema_version: 1, effective, overrides: {}, version: '1', shared_version: 'site-1' };
}

function projectedSurface(owner, name, uid) {
    owner.accept(name, privateSnapshot(uid));
    const host = document.createElement('section');
    owner.bind(host, name, uid);
    host.innerHTML = '<div class="card"><div class="fields"></div></div><article class="row_article_content">'
        + '<p class="row_article_inline_image_caption">Kuvateksti</p></article>';
    const card = host.querySelector('.card');
    mountCardFieldGroup(card, card.querySelector('.fields'), 'card', () => {});
    const label = document.createElement('div');
    label.innerHTML = '<span>Nimi</span><span>Arvo</span>';
    card.append(label);
    applyLabelValueLayout(label, label.firstChild, label.lastChild, 'inline');
    const imageWrapper = document.createElement('div'), image = document.createElement('img');
    imageWrapper.dataset.cardImageRenderSlot = 'card_media';
    imageWrapper.dataset.imagePresentationKind = 'raster';
    image.src = '/storage/private.jpg';
    imageWrapper.append(image); card.append(imageWrapper);
    prepareCardImagePresentation(imageWrapper, image);
    image.dispatchEvent(new Event('load'));
    owner.paint(name);
    return host;
}

beforeEach(() => { document.body.replaceChildren(); setAllSpecs({}); });

test.each([false, true])('denied revalidation clears private adapters before public repaint (detached: %s)', detached => {
    const owner = createDatasetAppearanceState();
    const host = projectedSurface(owner, 'private', 11), nested = projectedSurface(owner, 'related', 22);
    host.append(nested); document.body.append(host);
    if (detached) host.remove();
    const nestedBefore = nested.outerHTML;
    const image = host.querySelector('.card_photo_presentation');
    expect(image.style.getPropertyValue('--card-photo-source')).toContain('private.jpg');
    owner.revoke('private', { token: owner.captureRegistry() });
    expect(host.querySelector('.label-value-layout').dataset.labelValueLayout).toBe('stacked');
    expect(image.dataset.cardImagePresentation).toBe('contain');
    expect(image.style.getPropertyValue('--card-photo-source')).toBe('');
    expect(host.querySelector('.card').dataset.cardDetailColumns).toBe('2');
    expect(host.querySelector('.row_article_inline_image_caption').dataset.articleImageCaptionPosition).toBe('below');
    expect(host.dataset.datasetAppearanceUid).toBeUndefined();
    expect(host.dataset.datasetAppearanceResolved).toBe('false');
    image.querySelector('img').dispatchEvent(new Event('load'));
    expect(image.style.getPropertyValue('--card-photo-source')).toBe('');
    expect(nested.outerHTML).toBe(nestedBefore);
});

test.each(['clear', 'forget'].flatMap(action => [false, true].map(detached => [action, detached])))(
    '%s removes descendant projections (detached: %s) while retaining another UID', (action, detached) => {
        const owner = createDatasetAppearanceState();
        // clear invalidates every dataset in its store; a foreign store's nested
        // owner survives. forget must also preserve another UID in the same store.
        const nestedOwner = action === 'forget' ? owner : createDatasetAppearanceState();
        const host = projectedSurface(owner, 'private', 11), nested = projectedSurface(nestedOwner, 'related', 22);
        host.append(nested); document.body.append(host);
        if (detached) host.remove();
        const nestedBefore = nested.outerHTML;
        const label = host.querySelector('.label-value-layout'), image = host.querySelector('.card_photo_presentation');
        expect(label.dataset.labelValueLayout).toBe('inline');
        expect(image.style.getPropertyValue('--card-photo-source')).toContain('private.jpg');
        owner[action]('private');
        expect.soft(label.dataset.labelValueLayout).toBeUndefined();
        expect.soft(image.dataset.cardImagePresentation).toBeUndefined();
        expect.soft(image.style.getPropertyValue('--card-photo-source')).toBe('');
        expect.soft(host.querySelector('.row_article_content').dataset.articleImageCaptionPosition).toBeUndefined();
        expect.soft(host.querySelector('.row_article_inline_image_caption').dataset.articleImageCaptionPosition).toBeUndefined();
        expect.soft(host.querySelector('.card').dataset.cardStyleVariant).toBeUndefined();
        expect.soft(host.querySelector('.card').dataset.cardDetailColumns).toBeUndefined();
        expect.soft(host.querySelector('.card').classList.contains('card--modern')).toBe(false);
        expect.soft(host.dataset.datasetAppearanceUid).toBeUndefined();
        expect.soft(host.style.length).toBe(0);
        expect.soft(nested.outerHTML).toBe(nestedBefore);
        image.querySelector('img').dispatchEvent(new Event('load'));
        expect.soft(image.dataset.cardImagePresentation).toBeUndefined();
        expect.soft(image.style.getPropertyValue('--card-photo-source')).toBe('');
        // A retained owner can be bound again even when its render choice is identical.
        owner.accept('private', privateSnapshot(11)); owner.bind(host, 'private', 11);
        expect(label.dataset.labelValueLayout).toBe('inline');
        expect(host.querySelector('.card').classList.contains('card--modern')).toBe(true);
    },
);
