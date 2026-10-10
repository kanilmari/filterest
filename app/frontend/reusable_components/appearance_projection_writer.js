// appearance_projection_writer.js
// Records removable presentation writes at the adapter that makes them.
// Connects scoped renderers and field/media adapters with lifecycle cleanup.
// Avoids a second inventory of private attributes, styles or modifier classes.
import { appearanceScopeElements } from './appearance_scope_reader.js';

const projections = new WeakMap();

function record(element, kind, name) {
    const writes = projections.get(element) || { attributes: new Set(), styles: new Set(), classes: new Set() };
    writes[kind].add(name);
    projections.set(element, writes);
}

/** Dynamic choices are projections; structural classes and event wiring stay with the renderer. */
export function projectAppearanceAttribute(element, name, value) {
    record(element, 'attributes', name);
    element.dataset[name] = value;
}

export function projectAppearanceStyle(element, name, value) {
    record(element, 'styles', name);
    if (value == null) element.style.removeProperty(name);
    else element.style.setProperty(name, value);
}

export function projectAppearanceClass(element, name, enabled) {
    record(element, 'classes', name);
    element.classList.toggle(name, enabled);
}

/** Run before removing scope identity, including on detached trees; other owners keep their writes. */
export function clearAppearanceProjections(scope) {
    for (const element of appearanceScopeElements(scope, '*')) {
        const writes = projections.get(element);
        if (!writes) continue;
        for (const name of writes.attributes) delete element.dataset[name];
        for (const name of writes.styles) element.style.removeProperty(name);
        for (const name of writes.classes) element.classList.remove(name);
        projections.delete(element);
    }
}
