// front_page_presentation_renderer.test.js
// Proves shrink-wrapped anchor geometry, paragraphs, defaults and media preview.
// Connects all four alignments to a single invariant text-block width.
// Protects normal downward flow on narrow and short screens.
import { expect, test } from 'vitest';
import { DEFAULT_HOME_PRESENTATION as defaults, HOME_PRESENTATION_DEFINITION as rules } from '../../shared/front_page_presentation/validator.js';
import { applyHomePresentation, applyHomeMediaPresentation, renderHomeDescription, computeHomeTextGeometry } from './front_page_presentation_renderer.js';

test('nine anchors and every alignment preserve intrinsic block width and anchored edges', () => {
    const xs = { left: 40, center: 490, right: 940 }, ys = { top: 40, center: 280, bottom: 520 };
    for (const anchor of rules.anchors) for (const alignment of rules.alignments) {
        const presentation = { ...defaults, anchor, alignment };
        const [vertical, horizontal] = anchor.split('-');
        expect(computeHomeTextGeometry({ width: 1280, height: 760, textHeight: 200, textWidth: 300, presentation }))
            .toEqual({ width: 300, height: 200, stageHeight: 760, x: xs[horizontal], y: ys[vertical] });
        const [page, scroller, stage, hero] = Array.from({ length: 4 }, () => document.createElement('div'));
        applyHomePresentation(page, scroller, stage, hero, presentation);
        expect(stage.dataset.anchor).toBe(anchor); expect(hero.dataset.alignment).toBe(alignment);
        expect(hero.style.getPropertyValue('--home-text-max-width')).toBe('1120px');
        applyHomePresentation(page, scroller, stage, hero, null);
        expect(stage.dataset.anchor).toBe('center-center'); expect(hero.dataset.alignment).toBe('left');
    }
});

test('375px phones keep 16px gutters; long text flows from the top with every saved anchor and margin', () => {
    for (const anchor of rules.anchors) for (const margin of [0, 40, 320]) {
        expect(computeHomeTextGeometry({ width: 375, height: 600, textHeight: 900,
            presentation: { ...defaults, anchor, horizontal_margin_px: margin, vertical_margin_px: margin } }))
            .toEqual({ width: 343, height: 900, stageHeight: 932, x: 16, y: 16 });
    }
    // Short text and the narrowest maximum width still fill the phone line, so centre and right alignment show,
    // and the default block is centred vertically in the visible area, as on wide screens.
    for (const alignment of rules.alignments) {
        expect(computeHomeTextGeometry({ width: 375, height: 600, textHeight: 80, textWidth: 120,
            presentation: { ...defaults, alignment, max_width_px: rules.max_width_px.min } }))
            .toEqual({ width: 343, height: 80, stageHeight: 600, x: 16, y: 260 });
    }
});

test('short text on a phone keeps its vertical anchor with 16px insets, whatever the saved margins', () => {
    const ys = { top: 16, center: 260, bottom: 504 };
    for (const anchor of rules.anchors) for (const margin of [0, 40, 320]) {
        const vertical = anchor.split('-')[0];
        expect(computeHomeTextGeometry({ width: 375, height: 600, textHeight: 80,
            presentation: { ...defaults, anchor, horizontal_margin_px: margin, vertical_margin_px: margin } }))
            .toEqual({ width: 343, height: 80, stageHeight: 600, x: 16, y: ys[vertical] });
    }
});

test('long text converges vertically and full narrow text converges horizontally across anchors', () => {
    for (const anchor of rules.anchors) {
        const geometry = computeHomeTextGeometry({ width: 610, height: 300, textHeight: 1000,
            presentation: { ...defaults, anchor, horizontal_margin_px: 320, vertical_margin_px: 65 } });
        expect(geometry).toEqual({ width: 320, height: 1000, stageHeight: 1130, x: 145, y: 65 });
    }
    expect(computeHomeTextGeometry({ width: 1280, height: 760, textHeight: 200, presentation: null }))
        .toMatchObject({ x: 80, y: 280, width: 1120 });
});

test('blank lines form safe paragraphs; single line breaks remain and blank text hides', () => {
    const description = document.createElement('div');
    renderHomeDescription(description, 'First\r\nline\r\n \r\n<b>Literal</b>\n\n\nLast');
    expect([...description.children].map(p => p.textContent)).toEqual(['First\nline', '<b>Literal</b>', 'Last']);
    expect(description.querySelector('b')).toBeNull();
    renderHomeDescription(description, ' \n '); expect(description.hidden).toBe(true);
});

test('media preview writes both themes, and reset restores all four default values', () => {
    const container = document.createElement('div');
    applyHomeMediaPresentation(container, { ...defaults, light_wash: 87, light_opacity: 60, dark_wash: 31, dark_opacity: 44 });
    expect(['light-wash', 'light-opacity', 'dark-wash', 'dark-opacity'].map(key => container.style.getPropertyValue(`--home-${key}`)))
        .toEqual(['0.87', '0.6', '0.31', '0.44']);
    applyHomeMediaPresentation(container, null);
    expect(container.style.getPropertyValue('--home-dark-opacity')).toBe('0.2');
    expect(container.style.getPropertyValue('--home-light-opacity')).toBe('0.75');
});
