// filter_bar_test_environment_builder.js
// Builds deterministic DOM timing and scroll metrics for filter-bar unit tests.
// Bridges jsdom elements with observer-frame and scroll-dependent test scenarios.
// Exists to keep test-environment mechanics separate from filter-bar assertions.

export function flushObserverFrame() {
    return new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
    });
}

export function setScrollMetrics(element, { scrollTop, scrollHeight, clientHeight }) {
    Object.defineProperty(element, 'scrollHeight', {
        configurable: true,
        value: scrollHeight,
    });
    Object.defineProperty(element, 'clientHeight', {
        configurable: true,
        value: clientHeight,
    });
    element.scrollTop = scrollTop;
}
