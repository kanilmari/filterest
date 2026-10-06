// kv_container_printer.js
// Renders responsive key-value pair layouts into a container element.
// Bridges key-value data and layout options and the DOM presentation used across views.
// Exists to centralise reusable key-value rendering behavior for cards, details, and modal content.

import { createKvPairBuilders } from "./kv_pair_builder.js";

const kvResizeCallbacks = new Map();
let sharedKvResizeObserver = null;

function observeKvContainer(target, onResize) {
    if (typeof ResizeObserver === "undefined") {
        window.addEventListener("resize", onResize);
        return () => {
            window.removeEventListener("resize", onResize);
        };
    }

    if (!sharedKvResizeObserver) {
        sharedKvResizeObserver = new ResizeObserver((entries) => {
            entries.forEach((entry) => {
                const callback = kvResizeCallbacks.get(entry.target);
                if (callback) {
                    callback();
                }
            });
        });
    }

    kvResizeCallbacks.set(target, onResize);
    sharedKvResizeObserver.observe(target);

    return () => {
        kvResizeCallbacks.delete(target);
        sharedKvResizeObserver.unobserve(target);
    };
}

/**
 * Piirtää avain-arvo-parit konttiin ja huolehtii responsiivisuudesta.
 *
 * @param {HTMLElement}                 containerElement
 * @param {{key:string,value:string,isLink?:boolean,labelText?:string,labelKey?:string,href?:string,openInNewTabHref?:string,columnClass?:string}[]} keyValuePairDataArray
 * @param {Object}   [userOptions={}]
 * @param {number}   [userOptions.maxColumns=6]
 * @param {number}   [userOptions.minPairWidth=320]
 * @param {'inline'|'stacked'|'conditional'} [userOptions.layoutMode='stacked']
 *        Legacy pair markup variants. The shared site setting decides label/value placement.
 * @param {string}   [userOptions.containerClassName='kv-display']
 * @param {number}   [userOptions.singleColumnBreakpoint=0] - Jos containerin leveys on alle tämän, käytetään 1 saraketta
 * @param {boolean}  [userOptions.animateHeight=false] - Animoi containerin korkeuden muutokset
 * @param {number}   [userOptions.deferResponsiveLayoutMs=0] - Lykkää ensimmäistä sarakeasettelua ja observereita
 * @param {Function|null} [userOptions.decorateKeyElement=null] - Valinnainen avainelementin koristelija.
 *        Se voi lisäksi palauttaa `{labelPlacement}` ("hidden", "inline" tai "stacked"),
 *        The caller decides name visibility; the shared site adapter decides placement.
 *
 * @returns {Function} unmount
 */
export function renderKeyValuePairs(
    containerElement,
    keyValuePairDataArray,
    userOptions = {}
) {
    const CARD_MOUNT_EVENT = "easelect:card-mounted";

    // console.log("[KV-DEBUG] renderKeyValuePairs CALLED", { dataCount: keyValuePairDataArray?.length, userOptions });

    /* ---------- Oletusasetukset ---------- */
    const {
        maxColumns = 6,
        minPairWidth = 320,
        layoutMode = "stacked", // 'stacked', 'inline' (deprecated), 'conditional'
        containerClassName = "kv-display",
        singleColumnBreakpoint = 0,  // Jos > 0, pakottaa 1 sarakkeen kun container on kapeampi
        animateHeight = false,
        deferResponsiveLayoutMs = 0,
        translate = () => undefined,
        decorateKeyElement = null,
    } = userOptions;
    /* ------------------------------------- */

    if (!(containerElement instanceof HTMLElement)) {
        console.warn("virhe: containerElement ei ole HTMLElement");
        return () => {};
    }

    containerElement.classList.add(containerClassName);

    let _heightTransitionCleanup = null;
    let _heightAnimationFrame = 0;
    let _hasMeasuredInitialHeight = false;
    const shouldDeferResponsiveLayout =
        layoutMode === "conditional" && deferResponsiveLayoutMs > 0;
    let _responsiveLayoutArmed = !shouldDeferResponsiveLayout;
    let _deferredResponsiveLayoutTimer = null;
    let _mountCleanup = null;
    let _observerActivationCleanup = null;

    function cleanupHeightTransition() {
        if (_heightAnimationFrame) {
            cancelAnimationFrame(_heightAnimationFrame);
            _heightAnimationFrame = 0;
        }

        if (_heightTransitionCleanup) {
            _heightTransitionCleanup();
            _heightTransitionCleanup = null;
        }
    }

    function cleanupMountWait() {
        if (_mountCleanup) {
            _mountCleanup();
            _mountCleanup = null;
        }
    }

    function cleanupObserverActivationWait() {
        if (_observerActivationCleanup) {
            _observerActivationCleanup();
            _observerActivationCleanup = null;
        }
    }

    function animateContainerHeight(fromHeight, toHeight) {
        if (!animateHeight) {
            return;
        }

        if (fromHeight <= 0 || toHeight <= 0 || Math.abs(fromHeight - toHeight) < 2) {
            return;
        }

        cleanupHeightTransition();

        containerElement.style.height = `${fromHeight}px`;
        containerElement.style.overflow = "hidden";
        containerElement.style.transition = "none";
        containerElement.getBoundingClientRect();

        _heightAnimationFrame = requestAnimationFrame(() => {
            _heightAnimationFrame = 0;
            containerElement.style.transition = "height 180ms cubic-bezier(0.2, 0.8, 0.2, 1)";
            containerElement.style.height = `${toHeight}px`;

            const onTransitionEnd = (event) => {
                if (event.target !== containerElement || event.propertyName !== "height") {
                    return;
                }
                cleanup();
            };

            const cleanup = () => {
                containerElement.removeEventListener("transitionend", onTransitionEnd);
                containerElement.style.removeProperty("height");
                containerElement.style.removeProperty("overflow");
                containerElement.style.removeProperty("transition");
                _heightTransitionCleanup = null;
            };

            _heightTransitionCleanup = cleanup;
            containerElement.addEventListener("transitionend", onTransitionEnd);
        });
    }

    function withAnimatedHeight(work) {
        const previousHeight = containerElement.offsetHeight;
        work();
        const nextHeight = containerElement.scrollHeight;

        if (_hasMeasuredInitialHeight) {
            animateContainerHeight(previousHeight, nextHeight);
        } else {
            _hasMeasuredInitialHeight = nextHeight > 0;
        }
    }

    const { createInlineElement, createStackedElement, createConditionalElement } =
        createKvPairBuilders({ translate, decorateKeyElement });

    /** Track the container grid only; field placement belongs to the shared adapter. */
    let _prevCols = -1;
    let _prevMode = "";
    let _prevTotal = -1;

    function renderNow() {
        withAnimatedHeight(() => {
            // Käytetään containerin omaa leveyttä ikkunan leveyden sijaan
            const containerWidth = containerElement.offsetWidth || window.innerWidth;
            const mode = layoutMode;

            containerElement.classList.toggle("kv-inline", mode === "inline");
            containerElement.classList.toggle("kv-stacked", mode === "stacked");
            containerElement.classList.toggle("kv-conditional", mode === "conditional");

            const total = keyValuePairDataArray.length;
            
            // Lasketaan sarakkeet containerin leveyden perusteella
            // Jos singleColumnBreakpoint on asetettu ja container on sitä kapeampi, käytetään 1 saraketta
            let cols;
            if (singleColumnBreakpoint > 0 && containerWidth < singleColumnBreakpoint) {
                cols = 1;
            } else {
                cols = Math.min(
                    maxColumns,
                    Math.max(1, Math.floor(containerWidth / minPairWidth))
                );
            }

            if (cols === _prevCols && mode === _prevMode && total === _prevTotal) return;
            _prevCols = cols;
            _prevMode = mode;
            _prevTotal = total;

            const rows = Math.ceil(total / cols);

            containerElement.innerHTML = "";

            // Lasketaan montako alkiota kuhunkin sarakkeeseen kuuluu
            let colLengths = [];
            let remain = total;
            for (let c = 0; c < cols; c++) {
                // Ensimmäisiin sarakkeisiin voi tulla yksi ylimääräinen, jos ei mene tasan
                const len = Math.ceil(remain / (cols - c));
                colLengths.push(len);
                remain -= len;
            }

            // Jaetaan data sarakkeisiin
            let columnArrays = [];
            let pointer = 0;
            for (let c = 0; c < cols; c++) {
                columnArrays[c] = keyValuePairDataArray.slice(
                    pointer,
                    pointer + colLengths[c]
                );
                pointer += colLengths[c];
            }

            if (mode === "inline") {
                // Legacy inline pair markup; the shared adapter owns field placement.
                containerElement.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
                // Tulostetaan sarakkeittain, mutta rivi kerrallaan
                for (let row = 0; row < rows; row++) {
                    for (let col = 0; col < cols; col++) {
                        const pair = columnArrays[col][row];
                        if (!pair) continue;
                        containerElement.appendChild(createInlineElement(pair));
                    }
                }
            } else if (mode === "conditional") {
                // Legacy conditional pair markup; no text-width measurement is used.
                containerElement.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
                for (let row = 0; row < rows; row++) {
                    for (let col = 0; col < cols; col++) {
                        const pair = columnArrays[col][row];
                        if (!pair) continue;
                        containerElement.appendChild(createConditionalElement(pair));
                    }
                }
            } else {
                // Legacy stacked pair markup; the shared adapter owns field placement.
                containerElement.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
                for (let row = 0; row < rows; row++) {
                    for (let col = 0; col < cols; col++) {
                        const pair = columnArrays[col][row];
                        if (!pair) continue;
                        containerElement.appendChild(createStackedElement(pair));
                    }
                }
            }
        });
    }

    /* ---------- Alustus & kuuntelija ---------- */
    // Debounced resize handler: during continuous window resize, skip intermediate
    // renders entirely and only re-render once the user stops resizing (150ms).
    // Combined with the early-exit guard in renderNow(), this eliminates virtually
    // all resize-time DOM thrashing.
    let _debounceTimer = null;
    const scheduleRender = () => {
        if (!_responsiveLayoutArmed) {
            return;
        }
        if (_debounceTimer !== null) clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(() => {
            _debounceTimer = null;
            renderNow();
        }, 150);
    };

    let cleanupResizeObserver = () => {};
    let usingWindowResizeFallback = false;

    function attachResponsiveLayoutObserver() {
        if (usingWindowResizeFallback) {
            return;
        }

        // Käytetään ResizeObserveria containerin koon seurantaan
        // jotta sarakkeet reagoivat containerin leveyteen, ei ikkunan leveyteen.
        // Ensilatauksessa observer aktivoidaan vasta entrance-animaation jälkeen,
        // jotta se ei kilpaile saman framen layout-laskennan kanssa.
        if (typeof ResizeObserver !== "undefined") {
            cleanupResizeObserver = observeKvContainer(containerElement, scheduleRender);
        } else {
            usingWindowResizeFallback = true;
            window.addEventListener("resize", scheduleRender);
            cleanupResizeObserver = () => {
                window.removeEventListener("resize", scheduleRender);
            };
        }
    }

    function armResponsiveLayout(delayMs = deferResponsiveLayoutMs) {
        if (_responsiveLayoutArmed) {
            attachResponsiveLayoutObserver();
            return;
        }

        if (delayMs <= 0) {
            _responsiveLayoutArmed = true;
            attachResponsiveLayoutObserver();
            return;
        }

        _deferredResponsiveLayoutTimer = setTimeout(() => {
            _deferredResponsiveLayoutTimer = null;
            _responsiveLayoutArmed = true;
            attachResponsiveLayoutObserver();
        }, delayMs);
    }

    function startResponsiveLayoutLifecycle() {
        cleanupObserverActivationWait();

        const cardHost = containerElement.closest(".card");
        if (cardHost?.classList.contains("card--entering")) {
            const onAnimationEnd = () => {
                cleanupObserverActivationWait();
                armResponsiveLayout(0);
            };
            cardHost.addEventListener("animationend", onAnimationEnd, { once: true });
            _observerActivationCleanup = () => {
                cardHost.removeEventListener("animationend", onAnimationEnd);
            };
            return;
        }

        armResponsiveLayout();
    }

    function initializeWhenMounted() {
        cleanupMountWait();
        startResponsiveLayoutLifecycle();
    }

    /* ---------- Alustus & kuuntelija ---------- */
    renderNow();

    if (containerElement.isConnected) {
        initializeWhenMounted();
    } else {
        const cardHost = containerElement.closest(".card");
        if (cardHost) {
            const onCardMounted = () => {
                initializeWhenMounted();
            };
            cardHost.addEventListener(CARD_MOUNT_EVENT, onCardMounted, { once: true });
            _mountCleanup = () => {
                cardHost.removeEventListener(CARD_MOUNT_EVENT, onCardMounted);
            };
        } else {
            initializeWhenMounted();
        }
    }

    /* ---------- Poistofunktio ---------- */
    function unmount() {
        cleanupHeightTransition();
        cleanupMountWait();
        cleanupObserverActivationWait();
        cleanupResizeObserver();
        if (_debounceTimer !== null) {
            clearTimeout(_debounceTimer);
            _debounceTimer = null;
        }
        if (_deferredResponsiveLayoutTimer !== null) {
            clearTimeout(_deferredResponsiveLayoutTimer);
            _deferredResponsiveLayoutTimer = null;
        }
        containerElement.innerHTML = "";
    }

    return unmount;
}
