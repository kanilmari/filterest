// front_page_presentation_renderer.js
// Applies the saved Home layout before the first content frame and during preview.
// Connects the shared validated presentation to a normal-flow text stage.
// Preserves legacy DOM/geometry and expands rather than clipping long translations.
import { isValidHomePresentation, HOME_PRESENTATION_DEFINITION } from '../../shared/front_page_presentation/validator.js';

/** Blank lines separate plain-text paragraphs; single newlines remain authored line breaks. */
export function renderHomeDescription(element, text, positioned) {
    element.replaceChildren();
    element.hidden = !text;
    if (!positioned) { element.textContent = text; return; }
    for (const paragraph of text.replace(/\r\n?/g, '\n').split(/\n[\t ]*\n+/).filter(value => value.trim())) {
        const part = document.createElement('p');
        part.className = 'morphing-subtitle';
        part.textContent = paragraph;
        element.append(part);
    }
}

/** Activate positioning only for a valid saved/preview value; null retains today's layout. */
export function applyHomePresentation(page, scroller, stage, hero, presentation) {
    const positioned = isValidHomePresentation(presentation);
    page.classList.toggle('front-page-content--positioned', positioned);
    scroller.classList.toggle('front-page-scroller--positioned', positioned);
    stage.classList.toggle('front-page-text-stage', positioned);
    if (!positioned) {
        delete stage.dataset.anchor;
        delete hero.dataset.paragraphLayout;
        stage.removeAttribute('style');
        hero.removeAttribute('style');
        return false;
    }
    stage.dataset.anchor = presentation.anchor;
    hero.dataset.paragraphLayout = presentation.paragraph_layout;
    stage.style.setProperty('--home-text-min-width', `${HOME_PRESENTATION_DEFINITION.max_width_px.min}px`);
    stage.style.setProperty('--home-text-margin', `${presentation.margin_px}px`);
    hero.style.setProperty('--home-text-max-width', `${presentation.max_width_px}px`);
    return true;
}

/** Numerical counterpart of the CSS stage, used for reviewable nine-anchor geometry. */
export function computeHomeTextGeometry({ width, height, textHeight, presentation }) {
    if (!isValidHomePresentation(presentation)) return null;
    const phone = width <= 600;
    const [vertical, horizontal] = presentation.anchor.split('-');
    const insetX = phone ? 16 : horizontal === 'center' ? 0
        : Math.min(presentation.margin_px, Math.max(0, (width - HOME_PRESENTATION_DEFINITION.max_width_px.min) / 2));
    const insetY = phone ? 16 : vertical === 'center' ? 0 : presentation.margin_px;
    const blockWidth = Math.min(phone ? width - 32 : presentation.max_width_px, Math.max(0, width - insetX * 2));
    const stageHeight = Math.max(height, textHeight + insetY * 2);
    return { width: blockWidth, height: textHeight, stageHeight,
        x: phone || horizontal === 'left' ? insetX : horizontal === 'right' ? width - insetX - blockWidth : (width - blockWidth) / 2,
        y: phone || vertical === 'top' ? insetY : vertical === 'bottom' ? stageHeight - insetY - textHeight : (stageHeight - textHeight) / 2 };
}
