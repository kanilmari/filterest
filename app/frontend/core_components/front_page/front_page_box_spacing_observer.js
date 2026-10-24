// front_page_box_spacing_observer.js
// Lets Home boxes follow the hero without changing its viewport-based anchor.
// Publishes only the stage's unused tail; CSS owns the three spacing tokens.
// One visit owns its size/anchor observers and disconnects them before replacing content.

/** Measure flow compensation after mounting the real text and phone bar. */
export function mountHomeBoxSpacing(page, stage, hero) {
    if (!page.querySelector('.front-page-blocks')) return () => {};
    const view = page.ownerDocument.defaultView;
    const property = '--home-hero-trailing-space';
    function measure() {
        // A difference of viewport coordinates is unchanged by whole-page scrolling.
        const trailing = Math.max(0, stage.getBoundingClientRect().bottom - hero.getBoundingClientRect().bottom);
        page.style.setProperty(property, `${trailing}px`);
    }
    const sizes = view.ResizeObserver ? new view.ResizeObserver(measure) : null;
    sizes?.observe(stage);
    sizes?.observe(hero);
    // A different anchor can move short text without resizing either observed box.
    const anchors = new view.MutationObserver(measure);
    anchors.observe(stage, { attributes: true, attributeFilter: ['data-anchor', 'style'] });
    measure();
    return () => {
        sizes?.disconnect();
        anchors.disconnect();
        page.style.removeProperty(property);
    };
}
