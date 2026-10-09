// front_page_presentation_renderer.js
// Applies Home's centred default, saved layout and per-theme media preview.
// Connects the shared presentation to a shrink-wrapped, single-column stage.
// Alignment changes line placement only; oversized text expands normal flow.
import { readHomePresentation, HOME_PRESENTATION_DEFINITION } from '../../shared/front_page_presentation/validator.js';

/** Blank lines separate plain-text paragraphs; single newlines remain authored line breaks. */
export function renderHomeDescription(element, text) {
    element.replaceChildren();
    const paragraphs = String(text || '').replace(/\r\n?/g, '\n').split(/\n[\t ]*\n+/).filter(value => value.trim());
    element.hidden = paragraphs.length === 0;
    for (const paragraph of paragraphs) {
        const part = document.createElement('p');
        part.className = 'home-text-paragraph';
        part.textContent = paragraph;
        element.append(part);
    }
}

/** Apply defaults/conversion before the first frame; malformed values refuse rendering. */
export function applyHomePresentation(page, scroller, stage, hero, presentation) {
    const value = readHomePresentation(presentation);
    page.classList.add('front-page-content--positioned');
    scroller.classList.add('front-page-scroller--positioned');
    stage.classList.add('front-page-text-stage');
    stage.dataset.anchor = value.anchor;
    hero.dataset.alignment = value.alignment;
    stage.style.setProperty('--home-text-min-width', `${HOME_PRESENTATION_DEFINITION.max_width_px.min}px`);
    stage.style.setProperty('--home-text-horizontal-margin', `${value.horizontal_margin_px}px`);
    stage.style.setProperty('--home-text-vertical-margin', `${value.vertical_margin_px}px`);
    hero.style.setProperty('--home-text-max-width', `${value.max_width_px}px`);
    return true;
}

/** CSS chooses the explicit application theme; both pairs remain ready for theme switches. */
export function applyHomeMediaPresentation(container, presentation) {
    const value = readHomePresentation(presentation);
    for (const theme of ['light', 'dark']) for (const property of ['wash', 'opacity']) {
        container.style.setProperty(`--home-${theme}-${property}`, String(value[`${theme}_${property}`] / 100));
    }
}

/** Numerical counterpart of the CSS stage; textWidth represents intrinsic content width. */
export function computeHomeTextGeometry({ width, height, textHeight, textWidth, presentation }) {
    const value = readHomePresentation(presentation);
    const phone = width <= 600;
    const [vertical, horizontal] = value.anchor.split('-');
    const insetX = phone ? 16 : Math.min(value.horizontal_margin_px,
        Math.max(0, (width - HOME_PRESENTATION_DEFINITION.max_width_px.min) / 2));
    const insetY = phone ? 16 : value.vertical_margin_px;
    // Phones give the block the whole width between the gutters, so short centred or right-aligned text still uses the line.
    const blockWidth = phone ? Math.max(0, width - insetX * 2)
        : Math.min(textWidth ?? value.max_width_px, value.max_width_px, Math.max(0, width - insetX * 2));
    const stageHeight = Math.max(height, textHeight + insetY * 2);
    return { width: blockWidth, height: textHeight, stageHeight,
        x: phone || horizontal === 'left' ? insetX : horizontal === 'right' ? width - insetX - blockWidth : (width - blockWidth) / 2,
        // Phones keep the vertical anchor too; long text makes stageHeight grow, so every anchor then starts at the top.
        y: vertical === 'top' ? insetY : vertical === 'bottom' ? stageHeight - insetY - textHeight : (stageHeight - textHeight) / 2 };
}
