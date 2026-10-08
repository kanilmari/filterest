// front_page_presentation_renderer.test.js
// Proves Home layout geometry, safe paragraph rendering and legacy reset.
// Connects the nine-anchor CSS policy with its numerical review representation.
// Ensures phones and oversized translations can flow without clipped text.
import { expect, test } from 'vitest';
import { DEFAULT_HOME_PRESENTATION as defaults, HOME_PRESENTATION_DEFINITION as rules } from '../../shared/front_page_presentation/validator.js';
import { applyHomePresentation, renderHomeDescription, computeHomeTextGeometry } from './front_page_presentation_renderer.js';

test('nine desktop anchors place the whole block with independent paragraph layout', () => {
    const xs = { left: 40, center: 80, right: 120 };
    const ys = { top: 40, center: 280, bottom: 520 };
    for (const anchor of rules.anchors) for (const paragraph_layout of rules.paragraph_layouts) {
        const presentation = { ...defaults, anchor, paragraph_layout };
        const [vertical, horizontal] = anchor.split('-');
        expect(computeHomeTextGeometry({ width: 1280, height: 760, textHeight: 200, presentation }))
            .toEqual({ width: 1120, height: 200, stageHeight: 760, x: xs[horizontal], y: ys[vertical] });
        const [page, scroller, stage, hero] = Array.from({ length: 4 }, () => document.createElement('div'));
        expect(applyHomePresentation(page, scroller, stage, hero, presentation)).toBe(true);
        expect(stage.dataset.anchor).toBe(anchor);
        expect(hero.dataset.paragraphLayout).toBe(paragraph_layout);
        expect(hero.style.getPropertyValue('--home-text-max-width')).toBe('1120px');
        expect(applyHomePresentation(page, scroller, stage, hero, null)).toBe(false);
        expect(page.className).toBe('');
        expect(stage.hasAttribute('style')).toBe(false);
        expect(hero.dataset.paragraphLayout).toBeUndefined();
    }
});

test('375px phones use 16px gutters for every anchor and extreme margin', () => {
    for (const anchor of rules.anchors) for (const margin_px of [0, 40, 320]) {
        expect(computeHomeTextGeometry({ width: 375, height: 600, textHeight: 900,
            presentation: { ...defaults, anchor, margin_px } }))
            .toEqual({ width: 343, height: 900, stageHeight: 932, x: 16, y: 16 });
    }
});

test('desktop margins bound width, while long centered/bottom text expands the stage', () => {
    for (const anchor of ['bottom-left', 'bottom-right', 'center-left']) {
        const geometry = computeHomeTextGeometry({ width: 1280, height: 760, textHeight: 1000,
            presentation: { ...defaults, anchor, margin_px: 320 } });
        expect(geometry.width).toBe(640);
        expect(geometry.y).toBe(anchor.startsWith('center') ? 0 : 320);
        expect(geometry.stageHeight).toBe(anchor.startsWith('center') ? 1000 : 1640);
    }
});

test('blank lines form safe paragraphs; legacy retains literal line breaks and empty description hides', () => {
    const description = document.createElement('div');
    const text = 'First\r\nline\r\n \r\n<b>Literal</b>\n\n\nLast';
    renderHomeDescription(description, text, true);
    expect([...description.children].map(p => p.textContent)).toEqual(['First\nline', '<b>Literal</b>', 'Last']);
    expect(description.querySelector('b')).toBeNull();
    renderHomeDescription(description, text, false);
    expect(description.children.length).toBe(0);
    expect(description.textContent).toBe(text);
    renderHomeDescription(description, '', true);
    expect(description.hidden).toBe(true);
});

test('large margins on a narrow desktop retain at least the minimum text width', () => {
    const result = computeHomeTextGeometry({ width: 610, height: 760, textHeight: 200,
        presentation: { ...defaults, margin_px: 320 } });
    expect(result.width).toBe(320);
    expect(result.x).toBe(145);
});
