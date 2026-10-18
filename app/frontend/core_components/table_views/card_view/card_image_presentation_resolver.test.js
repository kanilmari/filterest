// @vitest-environment jsdom
// Proves light-model precedence, independent focal points and per-use painting.
// Exercises real photo wrappers across appearance refreshes in both app themes.
// Keeps CSS injection and cross-use changes outside the renderer contract.
import { afterEach, expect, it } from 'vitest';
import { resolveCardImagePresentation } from './card_image_presentation_resolver.js';
import { createImageElement } from './card_avatar_builder.js';
import { applyCardImagePresentationSetting } from './card_image_presentation.js';
import { buildCardImageRenderOptions } from './card_image_render_options.js';
import { resolveFallbackCardImageCandidate } from './card_element_builder_helpers.js';

afterEach(() => {
    document.body.replaceChildren();
    document.body.classList.remove('light-mode', 'dark-mode');
    delete document.documentElement.dataset.cardImagePresentation;
    delete document.documentElement._cardImageDefaults;
});

it.each([
    [{ own: { presentation: 'cover' }, dataset: 'contain', site: 'contain_blur' }, 'cover', 'image'],
    [{ own: { presentation: null }, dataset: 'contain', site: 'cover' }, 'contain', 'dataset'],
    [{ dataset: null, site: 'contain_blur' }, 'contain_blur', 'site'],
    [{}, 'contain', 'site'],
])('resolves the highest explicit presentation %j', (input, value, source) => {
    expect(resolveCardImagePresentation(input)).toMatchObject({ value, source });
});

it('keeps a focal point when presentation is inherited', () => {
    expect(resolveCardImagePresentation({ own: { presentation: null, focal: { x: 0, y: 1 } }, site: 'cover' }))
        .toEqual({ value: 'cover', source: 'site', focal: { x: 0, y: 1 }, focalSource: 'image' });
});

it.each([NaN, Infinity, -0.1, 1.1, '50%;background:url(…)'])('refuses unsafe focal coordinates %s', x => {
    expect(resolveCardImagePresentation({ own: { focal: { x, y: 0.5 } } }).focal).toEqual({ x: 0.5, y: 0.5 });
});

it.each(['light', 'dark'])('keeps each use independent through %s-theme default refreshes', theme => {
    document.body.classList.add(`${theme}-mode`);
    const use = { dataset: 'example', row_id: 4, column: 'hero_image', relation_id: 9, link_row_id: 12, version: 'v' };
    const own = createImageElement('/same.png', true, { renderSlot: 'card_media', cardImageUse: use,
        cardImageOwn: { presentation: 'cover', focal: { x: 0.2, y: 0.8 } } });
    const inherited = createImageElement('/same.png', true, { renderSlot: 'card_media' });
    document.body.append(own, inherited);
    applyCardImagePresentationSetting('contain_blur');
    expect(own.dataset.cardImagePresentation).toBe('cover');
    expect(own.dataset.cardImageSource).toBe('image');
    expect(own.style.getPropertyValue('--card-photo-focal')).toBe('20% 80%');
    expect(own._cardImageUse).toEqual(use);
    expect(inherited.dataset.cardImagePresentation).toBe('contain_blur');
    inherited.querySelector('img').dispatchEvent(new Event('load'));
    expect(inherited.style.getPropertyValue('--card-photo-source')).toContain('/same.png');
    applyCardImagePresentationSetting('contain');
    expect(own.dataset.cardImagePresentation).toBe('cover');
    expect(inherited.dataset.cardImagePresentation).toBe('contain');
    expect(inherited.style.getPropertyValue('--card-photo-focal')).toBe('');
});

it('passes the actual fallback field and its own companions to the image builder', () => {
    const row = { cached_image: null, hero_image: 'second.png', hero_image_presentation: 'cover',
        hero_image_focal_x: 0.1, hero_image_focal_y: 0.9, hero_image_usage: { link_row_id: 12 },
        cached_image_presentation: 'contain' };
    const candidate = resolveFallbackCardImageCandidate(row);
    expect(candidate).toEqual({ column: 'hero_image', value: 'second.png' });
    const options = buildCardImageRenderOptions(row, candidate.column);
    expect(options.cardImageOwn).toEqual({ presentation: 'cover', focal: { x: 0.1, y: 0.9 } });
    expect(options.cardImageUse.link_row_id).toBe(12);
});
