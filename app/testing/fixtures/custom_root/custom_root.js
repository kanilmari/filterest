// custom_root.js
// Publishes a visible marker only after the fixture's external script executes.
// Connects CSP-permitted local script delivery with the coordinator's browser assertions.
// Requires no inline script, fetch, application API or third-party resource.
const marker = document.querySelector('[data-testid="custom-root-script-marker"]');
marker.textContent = 'K378 external script loaded';
marker.hidden = false;
