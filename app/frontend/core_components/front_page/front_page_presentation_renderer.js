// front_page_presentation_renderer.js
// Applies Home's centred default, saved layout and per-theme media preview.
// Connects the shared presentation to a shrink-wrapped, single-column stage.
// Alignment changes line placement only; oversized text expands normal flow.
import { readHomePresentation, HOME_PRESENTATION_DEFINITION } from '../../shared/front_page_presentation/validator.js';
import { PHONE_BREAKPOINT_PX } from '../../ui_config.js';

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
    hero.dataset.phoneAlignment = value.phone_alignment;
    hero.dataset.phoneStorySize = String(value.phone_story_size);
    page.style.setProperty('--home-text-min-width', `${HOME_PRESENTATION_DEFINITION.max_width_px.min}px`);
    page.style.setProperty('--home-text-horizontal-margin', `${value.horizontal_margin_px}px`);
    stage.style.setProperty('--home-text-vertical-margin', `${value.vertical_margin_px}px`);
    hero.style.setProperty('--home-text-max-width', `${value.max_width_px}px`);
    return true;
}

/** The Home visit owns colours and spacing, including its phone search sheet outside the scroller. */
export function applyHomeSurfacePresentation(container, presentation) {
    const value = readHomePresentation(presentation);
    container.style.setProperty('--home-box-heading-gap', `${value.box_heading_gap_px}px`);
    // The original spacing follows the reader's root font size until the owner changes it.
    if (value.box_row_gap_px === HOME_PRESENTATION_DEFINITION.default.box_row_gap_px) {
        container.style.removeProperty('--home-box-row-gap');
    } else {
        container.style.setProperty('--home-box-row-gap', `${value.box_row_gap_px}px`);
    }
    for (const theme of ['light', 'dark']) for (const property of ['wash', 'opacity']) {
        container.style.setProperty(`--home-${theme}-${property}`, String(value[`${theme}_${property}`] / 100));
    }
}

/** Numerical counterpart of the CSS stage; textWidth represents intrinsic content width. */
export function computeHomeTextGeometry({ width, height, textHeight, textWidth, presentation }) {
    const value = readHomePresentation(presentation);
    const phone = width <= PHONE_BREAKPOINT_PX;
    const [vertical, horizontal] = value.anchor.split('-');
    const insetX = phone ? 16 : Math.min(value.horizontal_margin_px, width * 0.08,
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
