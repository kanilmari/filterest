// dom_element_checker.js
// Waits for a DOM element to appear using MutationObserver.
// Bridges asynchronous DOM mutations and callers that need a resolved element reference.
// Exists to let dynamic UIs defer work until target elements are present.
export function wait_until_appears(css_selector, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        // Jos elementti on jo olemassa, palauta se heti
        const existing_element = document.querySelector(css_selector);
        if (existing_element) {
            resolve(existing_element);
            return;
        }

        // Muuten tarkkaillaan DOMia, kunnes elementti ilmestyy
        const observer = new MutationObserver((mutations, obs) => {
            const element = document.querySelector(css_selector);
            if (element) {
                clearTimeout(timeoutId);
                resolve(element);
                obs.disconnect();
            }
        });

        // Disconnect observer and reject if element never appears within timeoutMs
        const timeoutId = setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Timeout: "${css_selector}" did not appear within ${timeoutMs}ms`));
        }, timeoutMs);

        // Tarkkaillaan koko dokumenttirunkoa
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
}
