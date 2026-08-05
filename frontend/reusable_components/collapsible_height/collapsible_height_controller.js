// collapsible_height_controller.js
// Animates expand/collapse height changes for arbitrary frontend DOM elements.
// Bridges reusable UI containers and native DOM measurement so nested layouts can grow smoothly without framework code.
// Exists to centralize height-transition behavior for trees, accordions, and other stacked components.

const DEFAULT_DURATION_MS = 240;
const DEFAULT_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const DEFAULT_COLLAPSED_HEIGHT = 0;
const TRANSITION_END_BUFFER_MS = 80;

const controllerRegistry = new WeakMap();

function clampHeight(value) {
    return Math.max(0, Number.isFinite(value) ? value : 0);
}

function parseDurationToMs(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.max(0, value);
    }
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    if (raw.endsWith("ms")) {
        const parsed = Number.parseFloat(raw.slice(0, -2));
        return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
    }
    if (raw.endsWith("s")) {
        const parsed = Number.parseFloat(raw.slice(0, -1));
        return Number.isFinite(parsed) ? Math.max(0, parsed * 1000) : null;
    }
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function readTransitionDurationMs(element, preferredDurationMs) {
    const explicitDuration = parseDurationToMs(preferredDurationMs);
    if (explicitDuration !== null) {
        return explicitDuration;
    }
    if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
        return DEFAULT_DURATION_MS;
    }
    const computedStyle = window.getComputedStyle(element);
    const cssVarDuration = parseDurationToMs(
        computedStyle.getPropertyValue("--height-transition-duration")
            || computedStyle.getPropertyValue("--transition-time")
    );
    return cssVarDuration ?? DEFAULT_DURATION_MS;
}

function prefersReducedMotion() {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return false;
    }
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function runOnNextFrame(callback) {
    if (typeof requestAnimationFrame === "function") {
        return requestAnimationFrame(callback);
    }
    return setTimeout(callback, 0);
}

function cancelNextFrame(handle) {
    if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(handle);
        return;
    }
    clearTimeout(handle);
}

function readRenderedHeight(element) {
    const rectHeight = element.getBoundingClientRect?.().height ?? 0;
    if (rectHeight > 0) {
        return rectHeight;
    }
    const inlineHeight = Number.parseFloat(element.style.height || "");
    if (Number.isFinite(inlineHeight) && inlineHeight > 0) {
        return inlineHeight;
    }
    return element.scrollHeight || 0;
}

function buildTransitionValue(existingTransition, durationMs, easing) {
    const transitions = [];

    if (existingTransition && existingTransition !== "all 0s ease 0s" && existingTransition !== "none 0s ease 0s") {
        transitions.push(existingTransition);
    }
    transitions.push(`height ${durationMs}ms ${easing}`);

    return transitions.join(", ");
}

function stopActiveAnimation(state) {
    if (state.activeAnimation.cancelFrameId) {
        cancelNextFrame(state.activeAnimation.cancelFrameId);
        state.activeAnimation.cancelFrameId = 0;
    }
    if (state.activeAnimation.timeoutId) {
        clearTimeout(state.activeAnimation.timeoutId);
        state.activeAnimation.timeoutId = 0;
    }
    if (state.activeAnimation.onTransitionEnd) {
        state.element.removeEventListener("transitionend", state.activeAnimation.onTransitionEnd);
        state.activeAnimation.onTransitionEnd = null;
    }
    if (state.activeAnimation.resolve) {
        state.activeAnimation.resolve(false);
        state.activeAnimation.resolve = null;
    }
    state.isTransitioning = false;
}

function restoreExpandedStyles(state) {
    state.element.style.height = "auto";
    state.element.style.overflow = state.inlineStyleSnapshot.overflow;
    state.element.style.transition = state.inlineStyleSnapshot.transition;
    state.lastExpandedHeight = clampHeight(state.element.scrollHeight || readRenderedHeight(state.element));
    state.isTransitioning = false;
}

function restoreCollapsedStyles(state, targetHeight) {
    state.element.style.height = `${targetHeight}px`;
    state.element.style.overflow = "hidden";
    state.element.style.transition = state.inlineStyleSnapshot.transition;
    state.isTransitioning = false;
}

function maybeAttachResizeObserver(state) {
    if (!state.options.observeResize || typeof ResizeObserver === "undefined") {
        return;
    }
    if (!state.resizeObserver) {
        state.resizeObserver = new ResizeObserver(() => {
            if (!state.options.observeResize || !state.isExpanded || state.isTransitioning) {
                return;
            }

            const nextHeight = clampHeight(state.element.scrollHeight || readRenderedHeight(state.element));
            const previousHeight = clampHeight(state.lastExpandedHeight ?? nextHeight);

            if (Math.abs(nextHeight - previousHeight) < 1) {
                state.lastExpandedHeight = nextHeight;
                return;
            }

            animateHeight(state, nextHeight, {
                fromHeight: previousHeight,
                animate: true,
                restoreAutoHeight: true,
            });
        });
    }
    state.resizeObserver.observe(state.element);
}

function maybeDetachResizeObserver(state) {
    state.resizeObserver?.disconnect();
}

function animateHeight(state, targetHeight, options = {}) {
    stopActiveAnimation(state);

    const safeTargetHeight = clampHeight(targetHeight);
    const safeFromHeight = clampHeight(
        options.fromHeight ?? readRenderedHeight(state.element)
    );
    const shouldAnimate =
        options.animate !== false
        && !prefersReducedMotion()
        && readTransitionDurationMs(state.element, state.options.durationMs) > 0
        && Math.abs(safeTargetHeight - safeFromHeight) >= 1;

    state.element.hidden = false;
    state.element.style.overflow = "hidden";
    state.element.style.height = `${safeFromHeight}px`;

    if (!shouldAnimate) {
        if (options.restoreAutoHeight) {
            restoreExpandedStyles(state);
        } else {
            restoreCollapsedStyles(state, safeTargetHeight);
        }
        state.lastExpandedHeight = safeTargetHeight;
        return Promise.resolve(true);
    }

    const durationMs = readTransitionDurationMs(state.element, state.options.durationMs);
    const easing = state.options.easing || DEFAULT_EASING;
    const existingTransition =
        typeof window !== "undefined" && typeof window.getComputedStyle === "function"
            ? window.getComputedStyle(state.element).transition
            : "";

    state.isTransitioning = true;
    state.element.style.transition = "none";
    void state.element.offsetHeight;

    return new Promise((resolve) => {
        const finishTransition = () => {
            if (state.activeAnimation.timeoutId) {
                clearTimeout(state.activeAnimation.timeoutId);
                state.activeAnimation.timeoutId = 0;
            }
            if (state.activeAnimation.onTransitionEnd) {
                state.element.removeEventListener("transitionend", state.activeAnimation.onTransitionEnd);
                state.activeAnimation.onTransitionEnd = null;
            }
            if (!state.isTransitioning) {
                resolve(false);
                return;
            }

            if (options.restoreAutoHeight) {
                restoreExpandedStyles(state);
            } else {
                restoreCollapsedStyles(state, safeTargetHeight);
            }
            state.lastExpandedHeight = safeTargetHeight;
            state.activeAnimation.resolve = null;
            resolve(true);
        };

        const onTransitionEnd = (event) => {
            if (event.target !== state.element || event.propertyName !== "height") {
                return;
            }
            finishTransition();
        };

        state.activeAnimation.resolve = resolve;
        state.activeAnimation.onTransitionEnd = onTransitionEnd;
        state.activeAnimation.timeoutId = setTimeout(
            finishTransition,
            durationMs + TRANSITION_END_BUFFER_MS,
        );
        state.activeAnimation.cancelFrameId = runOnNextFrame(() => {
            state.activeAnimation.cancelFrameId = 0;
            state.element.addEventListener("transitionend", onTransitionEnd);
            state.element.style.transition = buildTransitionValue(existingTransition, durationMs, easing);
            state.element.style.height = `${safeTargetHeight}px`;
        });
    });
}

function applyInitialState(state) {
    state.element.dataset.collapsibleState = state.isExpanded ? "expanded" : "collapsed";

    if (state.isExpanded) {
        state.element.hidden = false;
        state.element.style.height = "auto";
        state.element.style.overflow = state.inlineStyleSnapshot.overflow;
        state.lastExpandedHeight = clampHeight(state.element.scrollHeight || readRenderedHeight(state.element));
        maybeAttachResizeObserver(state);
        return;
    }

    state.element.style.height = `${state.options.collapsedHeight}px`;
    state.element.style.overflow = "hidden";
    state.element.hidden = Boolean(state.options.hiddenWhenCollapsed);
    maybeDetachResizeObserver(state);
}

export function createCollapsibleHeightController(element, options = {}) {
    if (!(element instanceof HTMLElement)) {
        throw new TypeError("createCollapsibleHeightController expects an HTMLElement");
    }

    const existingController = controllerRegistry.get(element);
    if (existingController) {
        existingController.updateOptions(options);
        return existingController;
    }

    const state = {
        element,
        options: {
            durationMs: options.durationMs,
            easing: options.easing || DEFAULT_EASING,
            collapsedHeight: clampHeight(options.collapsedHeight ?? DEFAULT_COLLAPSED_HEIGHT),
            hiddenWhenCollapsed: options.hiddenWhenCollapsed !== false,
            observeResize: Boolean(options.observeResize),
        },
        isExpanded: Boolean(options.startExpanded),
        isTransitioning: false,
        lastExpandedHeight: null,
        resizeObserver: null,
        activeAnimation: {
            cancelFrameId: 0,
            onTransitionEnd: null,
            resolve: null,
            timeoutId: 0,
        },
        inlineStyleSnapshot: {
            overflow: element.style.overflow,
            transition: element.style.transition,
        },
    };

    const controller = {
        expand(animationOptions = {}) {
            state.isExpanded = true;
            state.element.dataset.collapsibleState = "expanded";
            state.element.hidden = false;
            maybeAttachResizeObserver(state);

            const targetHeight = clampHeight(state.element.scrollHeight || readRenderedHeight(state.element));
            const fromHeight = animationOptions.fromHeight ?? state.options.collapsedHeight;

            return animateHeight(state, targetHeight, {
                fromHeight,
                animate: animationOptions.animate,
                restoreAutoHeight: true,
            });
        },
        collapse(animationOptions = {}) {
            state.isExpanded = false;
            state.element.dataset.collapsibleState = "collapsed";
            maybeDetachResizeObserver(state);

            const targetHeight = clampHeight(
                animationOptions.targetHeight ?? state.options.collapsedHeight
            );
            const fromHeight = animationOptions.fromHeight ?? readRenderedHeight(state.element);
            const shouldSkipAnimation =
                animationOptions.animate === false
                || prefersReducedMotion()
                || readTransitionDurationMs(state.element, state.options.durationMs) <= 0;

            if (shouldSkipAnimation) {
                stopActiveAnimation(state);
                restoreCollapsedStyles(state, targetHeight);
                state.lastExpandedHeight = targetHeight;
                if (state.options.hiddenWhenCollapsed && targetHeight === 0) {
                    state.element.hidden = true;
                }
                return Promise.resolve();
            }

            return animateHeight(state, targetHeight, {
                fromHeight,
                animate: animationOptions.animate,
                restoreAutoHeight: false,
            }).then((didComplete) => {
                if (didComplete && state.options.hiddenWhenCollapsed && targetHeight === 0) {
                    state.element.hidden = true;
                }
            });
        },
        toggle(animationOptions = {}) {
            return state.isExpanded
                ? controller.collapse(animationOptions)
                : controller.expand(animationOptions);
        },
        sync(animationOptions = {}) {
            if (!state.isExpanded) {
                return Promise.resolve();
            }

            state.element.hidden = false;
            maybeAttachResizeObserver(state);

            const nextHeight = clampHeight(state.element.scrollHeight || readRenderedHeight(state.element));
            const previousHeight = clampHeight(
                animationOptions.fromHeight ?? state.lastExpandedHeight ?? readRenderedHeight(state.element)
            );

            if (Math.abs(nextHeight - previousHeight) < 1) {
                state.lastExpandedHeight = nextHeight;
                restoreExpandedStyles(state);
                return Promise.resolve();
            }

            return animateHeight(state, nextHeight, {
                fromHeight: previousHeight,
                animate: animationOptions.animate,
                restoreAutoHeight: true,
            });
        },
        animateTo(targetHeight, animationOptions = {}) {
            state.element.hidden = false;
            const previousHeight = clampHeight(
                animationOptions.fromHeight ?? readRenderedHeight(state.element)
            );

            return animateHeight(state, targetHeight, {
                fromHeight: previousHeight,
                animate: animationOptions.animate,
                restoreAutoHeight: Boolean(animationOptions.restoreAutoHeight),
            });
        },
        isExpanded() {
            return state.isExpanded;
        },
        setExpanded(nextExpanded, animationOptions = {}) {
            return nextExpanded
                ? controller.expand(animationOptions)
                : controller.collapse(animationOptions);
        },
        setCollapsedHeight(nextCollapsedHeight) {
            state.options.collapsedHeight = clampHeight(nextCollapsedHeight);
            if (!state.isExpanded) {
                state.element.style.height = `${state.options.collapsedHeight}px`;
            }
        },
        updateOptions(nextOptions = {}) {
            if (Object.prototype.hasOwnProperty.call(nextOptions, "durationMs")) {
                state.options.durationMs = nextOptions.durationMs;
            }
            if (Object.prototype.hasOwnProperty.call(nextOptions, "easing")) {
                state.options.easing = nextOptions.easing || DEFAULT_EASING;
            }
            if (Object.prototype.hasOwnProperty.call(nextOptions, "collapsedHeight")) {
                state.options.collapsedHeight = clampHeight(nextOptions.collapsedHeight);
            }
            if (Object.prototype.hasOwnProperty.call(nextOptions, "hiddenWhenCollapsed")) {
                state.options.hiddenWhenCollapsed = nextOptions.hiddenWhenCollapsed !== false;
            }
            if (Object.prototype.hasOwnProperty.call(nextOptions, "observeResize")) {
                state.options.observeResize = Boolean(nextOptions.observeResize);
                if (state.options.observeResize && state.isExpanded) {
                    maybeAttachResizeObserver(state);
                } else if (!state.options.observeResize) {
                    maybeDetachResizeObserver(state);
                }
            }
        },
        destroy() {
            stopActiveAnimation(state);
            maybeDetachResizeObserver(state);
            controllerRegistry.delete(state.element);
        },
    };

    controllerRegistry.set(element, controller);
    applyInitialState(state);
    return controller;
}
