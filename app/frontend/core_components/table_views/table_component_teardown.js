// table_component_teardown.js
// Owns the list/table component's menu and interaction-listener teardown.
// Connects explicit destruction, dataset subtree disposal and direct DOM removal.
// Keeps a body-mounted selection menu from retaining a removed component.

import { registerCardResource } from './card_view/card_resource_lifecycle.js';

/**
 * Bind component interactions to the existing dataset subtree disposal lifecycle.
 * After a connected checkpoint, direct root/ancestor removals also dispose at
 * the next checkpoint; connected moves and internal rerenders stay alive. Roots
 * never seen connected (including same-task mount/removal) need explicit destroy
 * or dataset disposal, as do the renderer's abandoned/superseded builds.
 *
 * @param {import('./table_component_builder.js').TableComponent} component
 * @returns {() => void} Idempotent release of the component-owned resources.
 */
export function initializeTableComponentTeardown(component) {
    const { rootElement, selectionMenu } = component;
    const listeners = [];
    let disposed = false;

    const addListener = (element, eventName, listener) => {
        element.addEventListener(eventName, listener);
        listeners.push(() => element.removeEventListener(eventName, listener));
    };
    addListener(selectionMenu, 'click', event => {
        const action = event.target.dataset.action;
        if (action === 'copy-headers') component.copySelected(true);
        else if (action === 'copy-no-headers') component.copySelected(false);
        component.hideSelectionMenu();
    });
    [
        ['mousedown', 'onMouseDown'], ['mousemove', 'onMouseMove'], ['mouseup', 'onMouseUp'],
        ['click', 'onCellClick'], ['contextmenu', 'onContextMenu'],
        ['dblclick', 'onCellDoubleClick'], ['keydown', 'onCellKeyDown'],
    ].forEach(([eventName, methodName]) => {
        addListener(rootElement, eventName, event => component[methodName](event));
    });

    // Check only current connection state, regardless of record/node counts.
    // Dataset owners explicitly dispose roots removed before their first checkpoint.
    let seenConnected = rootElement.isConnected;
    const removalObserver = new MutationObserver(() => {
        if (rootElement.isConnected) {
            seenConnected = true;
        } else if (seenConnected) {
            component.destroy();
        }
    });
    removalObserver.observe(rootElement.ownerDocument, { childList: true, subtree: true });

    // Despite its historical card name, this registry already releases every
    // replaced or abandoned dataset subtree, including list/table view roots.
    const unregisterResource = registerCardResource(rootElement, () => component.destroy());
    return () => {
        if (disposed) return;
        disposed = true;
        removalObserver.disconnect();
        unregisterResource();
        listeners.splice(0).forEach(removeListener => removeListener());
        component.hideSelectionMenu();
        selectionMenu.remove();
        delete rootElement.tableComponentInstance;
    };
}
