// card_image_presentation_resolver.js
// Resolves the light model's three presentation levels and an independent focal point.
// Shared by card painting and the future per-use editor preview.
// Values are closed enums and finite coordinates before becoming CSS.
export const CARD_IMAGE_PRESENTATIONS = Object.freeze(['cover', 'contain', 'contain_blur']);
const validMode = value => CARD_IMAGE_PRESENTATIONS.includes(value);

export function resolveCardImagePresentation({ own, dataset, site } = {}) {
    const source = validMode(own?.presentation) ? 'image' : validMode(dataset) ? 'dataset' : 'site';
    const value = validMode(own?.presentation) ? own.presentation
        : validMode(dataset) ? dataset : validMode(site) ? site : 'contain';
    const point = own?.focal;
    const validPoint = point && [point.x, point.y].every(number =>
        typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 1);
    return { value, source, focal: validPoint ? { x: point.x, y: point.y } : { x: 0.5, y: 0.5 },
        focalSource: validPoint ? 'image' : 'center' };
}
