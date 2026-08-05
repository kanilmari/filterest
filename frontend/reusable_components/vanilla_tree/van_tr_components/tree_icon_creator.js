// tree_icon_creator.js
// Creates the reusable SVG icons used by vanilla tree nodes and toggles.
// Bridges vanilla-tree node rendering with consistent folder, file, and expand/collapse icon markup.
// Exists to keep tree icon SVG generation out of node-rendering logic.

/** Kansio- / tiedostokuvake (.icon) */
export function createSvgIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute(
        'd',
        'M 22 18 V 10 a 2 2 0 0 0 -2 -2 h -7 c -2 0 -1 -2 -3 -2 H 4 a 2 2 0 0 0 -2 2 v 10 a 2 2 0 0 0 2 2 h 16 a 2 2 0 0 0 2 -2 z'
    );
    svg.appendChild(path);
    return svg;
}

/** Pieni chevron, jota klikataan kansion avaamiseksi/sulkemiseksi */
export function createSvgToggle() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('toggle');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', '12 6, 18 12, 12 18');
    svg.appendChild(poly);
    return svg;
}

/** Tyhjä paikkapituri, jotta rivit pysyvät samalla tasolla lehdissä */
export function createEmptySvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('toggle-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'none');
    svg.setAttribute('stroke-width', '0');
    return svg;
}