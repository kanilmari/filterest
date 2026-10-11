// card_resource_lifecycle.js
// Owns mounting and disposal for resources within a result card subtree.
// Connects detached card construction, accepted DOM swaps and field cleanup callbacks.
// Uses weak ownership so abandoned elements cannot be retained by the lifecycle itself.

const resources = new WeakMap();
const mountedCards = new WeakSet();
const disposedElements = new WeakSet();

/** Register cleanup on its owning element, including fields built off screen. */
export function registerCardResource(element, cleanup) {
    if (disposedElements.has(element)) { cleanup(); return; }
    let callbacks = resources.get(element);
    if (!callbacks) resources.set(element, callbacks = new Set());
    callbacks.add(cleanup);
    return () => callbacks.delete(cleanup);
}

/** Bind a card-owned DOM listener to the same explicit removal lifecycle. */
export function addCardResourceListener(element, eventName, listener, options) {
    element.addEventListener(eventName, listener, options);
    registerCardResource(element, () => element.removeEventListener(eventName, listener, options));
}

/** Release field observers, timers and subscriptions before removing any subtree. */
export function disposeCardResources(root) {
    if (!root) return;
    // Collect first: field cleanup may remove children while callbacks run.
    const elements = [root, ...root.querySelectorAll?.('*') || []];
    elements.forEach(element => {
        disposedElements.add(element);
        const callbacks = resources.get(element);
        resources.delete(element);
        callbacks?.forEach(cleanup => cleanup());
    });
}

/** Announce each accepted card once, only after its final host is connected. */
export function notifyCardsMounted(root) {
    const cards = root.matches?.('.card') ? [root] : [...root.querySelectorAll('.card')];
    cards.forEach(card => {
        if (!card.isConnected || mountedCards.has(card) || disposedElements.has(card)) return;
        mountedCards.add(card);
        // A palette preview may have changed while the card was built off screen.
        card._refreshFieldPresentation?.forEach(refresh => refresh());
        card.dispatchEvent(new CustomEvent('easelect:card-mounted'));
    });
}
