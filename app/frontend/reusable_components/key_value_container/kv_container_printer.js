// kv_container_printer.js
// Renders responsive key-value pair layouts into a container element.
// Bridges key-value data and layout options and the DOM presentation used across views.
// Exists to centralise reusable key-value rendering behavior for cards, details, and modal content.

import { createKvPairBuilders } from "./kv_pair_builder.js";
import { applyLabelValueLayout } from "./label_value_layout.js";

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
 *        - 'inline': (DEPRECATED) avain ja arvo vierekkäin 50/50 gridissä
 *        - 'stacked': avain ja arvo allekkain
 *        - 'conditional': älykäs rivitys - arvo sijoitetaan avaimen viereen jos mahtuu,
 *          muuten pudotetaan omalle rivilleen (suositeltu)
 * @param {number}   [userOptions.responsiveBreakpoint=400]
 * @param {string}   [userOptions.containerClassName='kv-display']
 * @param {number}   [userOptions.singleColumnBreakpoint=0] - Jos containerin leveys on alle tämän, käytetään 1 saraketta
 * @param {boolean}  [userOptions.animateHeight=false] - Animoi containerin korkeuden muutokset
 * @param {number}   [userOptions.deferResponsiveLayoutMs=0] - Lykkää conditional-tilan ensimmäistä relayoutia ja observereita
 * @param {Function|null} [userOptions.decorateKeyElement=null] - Valinnainen avainelementin koristelija
 *
 * @returns {Function} unmount
 */
export function renderKeyValuePairs(
    containerElement,
    keyValuePairDataArray,
    userOptions = {}
) {
    const CARD_MOUNT_EVENT = "easelect:card-mounted";
    const textWidthCache = new Map();

    // console.log("[KV-DEBUG] renderKeyValuePairs CALLED", { dataCount: keyValuePairDataArray?.length, userOptions });

    /* ---------- Oletusasetukset ---------- */
    const {
        maxColumns = 6,
        minPairWidth = 320,
        layoutMode = "stacked", // 'stacked', 'inline' (deprecated), 'conditional'
        responsiveBreakpoint = 400,
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
    let _skipNextConditionalHeightAnimation = shouldDeferResponsiveLayout;
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

    const { createInlineElements, createStackedElement, createConditionalElement, applyPairColumnClass } =
        createKvPairBuilders({ translate, decorateKeyElement });

    /**
     * Apufunktio: Tekstin leveyden mittaus Canvas API:lla.
     * Nopeampi kuin DOM-elementin renderöinti mittausta varten.
     */
    function getTextWidth(text, font) {
        const canvas = getTextWidth.canvas || (getTextWidth.canvas = document.createElement("canvas"));
        const context = canvas.getContext("2d");
        context.font = font;
        return context.measureText(text).width;
    }

    function getCachedTextWidth(text, font) {
        const cacheKey = `${font}\n${text}`;
        const cachedWidth = textWidthCache.get(cacheKey);
        if (cachedWidth !== undefined) {
            return cachedWidth;
        }

        const measuredWidth = getTextWidth(text, font);
        textWidthCache.set(cacheKey, measuredWidth);
        return measuredWidth;
    }

    /**
     * Älykäs asettelun säätö conditional-tilassa.
     * Tarkistaa jokaisen rivin ja päättää pudotetaanko arvo omalle rivilleen.
     * Laskee sarakekohtaisen leveimmän avaimen ja käyttää sitä yhtenäiseen sisennykseen.
     */
    function adjustConditionalLayout(colCountHint = _prevCols) {
        const previousHeight = containerElement.offsetHeight;

        const allRows = containerElement.querySelectorAll(".kv-smart-row");
        if (allRows.length === 0) return;

        const colCount = Math.max(1, colCountHint || 1);
        const sampleRow = allRows[0];
        const sampleKey =
            sampleRow?._kvKeyElement || sampleRow?.querySelector(".kv-conditional-key");
        const sampleValue =
            sampleRow?._kvValueElement || sampleRow?.querySelector(".kv-conditional-value");

        let sharedLineHeight = 0;
        if (sampleKey) {
            const keyStyle = window.getComputedStyle(sampleKey);
            sharedLineHeight = parseFloat(keyStyle.lineHeight);
            if (isNaN(sharedLineHeight)) {
                const fontSize = parseFloat(keyStyle.fontSize);
                sharedLineHeight = fontSize * 1.2;
            }
        }

        const sharedValueFont = sampleValue ? window.getComputedStyle(sampleValue).font : "";

        // VAIHE 2: JÄSENNELLÄÄN RIVIT SARAKKEITTAIN
        // Elementit tulevat DOM:ssa rivi kerrallaan: [col0row0, col1row0, col0row1, col1row1, ...]
        const columns = [];
        for (let c = 0; c < colCount; c++) {
            columns[c] = [];
        }
        allRows.forEach((row, idx) => {
            const colIdx = idx % colCount;
            columns[colIdx].push(row);
        });

        // VAIHE 3: LASKE SARAKEKOHTAINEN LEVEIN AVAIN (max 50% sarakkeen leveydestä)
        const columnMaxKeyWidths = [];
        const columnMetrics = [];
        for (let c = 0; c < colCount; c++) {
            let maxKeyWidth = 0;
            let columnWidth = 0;
            const rowMetrics = [];
            
            for (const row of columns[c]) {
                if (row.dataset.labelValueLayout) continue;
                const key =
                    row._kvKeyElement || row.querySelector(".kv-conditional-key");
                const value =
                    row._kvValueElement || row.querySelector(".kv-conditional-value");
                if (!key || !value) continue;
                
                // Tarkistetaan onko avain monirivinen - ei lasketa mukaan
                const lineHeight =
                    sharedLineHeight ||
                    parseFloat(window.getComputedStyle(key).lineHeight) ||
                    19;
                const isMultiLine = key.offsetHeight > lineHeight * 1.5;
                const rowWidth = row.clientWidth;
                const keyWidth = key.offsetWidth + 10;
                const valueText = row._kvValueText || value.textContent || "";
                const valueFont = sharedValueFont || getComputedStyle(value).font;
                const textMetricsWidth = getCachedTextWidth(valueText, valueFont);
                const hasLink = row._kvHasLink || value.querySelector("a") !== null;
                const valueNeededWidth = hasLink ? textMetricsWidth + 20 : textMetricsWidth;
                
                if (!isMultiLine) {
                    if (keyWidth > maxKeyWidth) {
                        maxKeyWidth = keyWidth;
                    }
                }
                
                if (rowWidth > columnWidth) {
                    columnWidth = rowWidth;
                }

                rowMetrics.push({
                    isMultiLine,
                    keyWidth,
                    rowWidth,
                    value,
                    valueNeededWidth,
                });
            }
            
            // Max 50% sarakkeen leveydestä
            const maxAllowed = columnWidth * 0.5;
            columnMaxKeyWidths[c] = Math.min(maxKeyWidth, maxAllowed);
            columnMetrics[c] = rowMetrics;
        }

        // VAIHE 4: KÄSITTELE RIVIT SARAKEKOHTAISESTI
        for (let c = 0; c < colCount; c++) {
            const columnKeyOffset = columnMaxKeyWidths[c];
            const rows = columnMetrics[c] || [];

            for (const row of rows) {
                const { isMultiLine, keyWidth, rowWidth, value, valueNeededWidth } = row;

                if (rowWidth === 0) continue;
                
                // Käytetään sarakkeen leveintä avainta sisennykseen (tai tämän avaimen leveyttä jos suurempi)
                const effectiveOffset = Math.max(columnKeyOffset, keyWidth);
                const spaceNextToOffset = rowWidth - effectiveOffset;

                let shouldDrop = false;
                let marginLeft = "0px";

                if (isMultiLine) {
                    shouldDrop = true;
                } else if (valueNeededWidth <= spaceNextToOffset) {
                    marginLeft = `${effectiveOffset}px`;
                } else {
                    shouldDrop = true;
                }

                value.classList.toggle("kv-dropped", shouldDrop);
                if (value.style.marginLeft !== marginLeft) {
                    value.style.marginLeft = marginLeft;
                }
            }
        }

        if (_hasMeasuredInitialHeight) {
            if (_skipNextConditionalHeightAnimation) {
                _skipNextConditionalHeightAnimation = false;
            } else {
                animateContainerHeight(previousHeight, containerElement.scrollHeight);
            }
        }

    }

    /** Track previous render state to skip redundant DOM rebuilds. */
    let _prevCols = -1;
    let _prevMode = "";
    let _prevTotal = -1;
    let _prevContainerWidth = -1;
    let _conditionalRelayoutFrame = 0;
    let _pendingConditionalCols = 1;

    function scheduleConditionalRelayout(cols) {
        _pendingConditionalCols = cols;
        if (_conditionalRelayoutFrame) {
            return;
        }

        _conditionalRelayoutFrame = requestAnimationFrame(() => {
            _conditionalRelayoutFrame = 0;
            adjustConditionalLayout(_pendingConditionalCols);
        });
    }

    function renderNow() {
        withAnimatedHeight(() => {
            // Käytetään containerin omaa leveyttä ikkunan leveyden sijaan
            const containerWidth = containerElement.offsetWidth || window.innerWidth;
            const ww = window.innerWidth;
            // conditional-tilassa ei vaihdeta stacked-tilaan responsiveBreakpointin perusteella
            const mode = (layoutMode === "conditional")
                ? "conditional"
                : (ww < responsiveBreakpoint ? "stacked" : layoutMode);

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

            const widthChanged = Math.abs(containerWidth - _prevContainerWidth) >= 4;
            _prevContainerWidth = containerWidth;

            // Skip full DOM rebuild if column count, mode, and data length unchanged.
            // Conditional mode still needs a cheap relayout when width changes.
            if (cols === _prevCols && mode === _prevMode && total === _prevTotal) {
                if (mode === "conditional" && widthChanged && _responsiveLayoutArmed) {
                    scheduleConditionalRelayout(cols);
                }
                return;
            }
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
                // DEPRECATED: inline-tila - avain ja arvo vierekkäin 50/50 gridissä
                // Suositellaan käytettäväksi 'conditional'-tilaa sen sijaan
                containerElement.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
                // Tulostetaan sarakkeittain, mutta rivi kerrallaan
                for (let row = 0; row < rows; row++) {
                    for (let col = 0; col < cols; col++) {
                        const pair = columnArrays[col][row];
                        if (!pair) continue;
                        const wrap = document.createElement("div");
                        wrap.className = "kv-pair-inline";
                        applyPairColumnClass(wrap, pair);
                        wrap.style.display = "grid";
                        wrap.style.gridTemplateColumns = "1fr 1fr";
                        const [k, v] = createInlineElements(pair);
                        wrap.appendChild(k);
                        wrap.appendChild(v);
                        applyLabelValueLayout(wrap, k, v, pair?.labelMeta?.label_value_layout);
                        containerElement.appendChild(wrap);
                    }
                }
            } else if (mode === "conditional") {
                // CONDITIONAL: Älykäs rivitys - arvo avaimen viereen jos mahtuu, muuten omalle rivilleen
                containerElement.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
                for (let row = 0; row < rows; row++) {
                    for (let col = 0; col < cols; col++) {
                        const pair = columnArrays[col][row];
                        if (!pair) continue;
                        containerElement.appendChild(createConditionalElement(pair));
                    }
                }
                // Ajetaan älykäs asettelu heti renderöinnin jälkeen
                // requestAnimationFrame varmistaa että DOM on päivittynyt
                if (_responsiveLayoutArmed) {
                    scheduleConditionalRelayout(cols);
                }
            } else {
                // STACKED: avain ja arvo allekkain
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

    // Legacy code moved to kv_container_legacy_code.txt to fix syntax error issues.


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
            scheduleConditionalRelayout(_prevCols > 0 ? _prevCols : 1);
            return;
        }

        _deferredResponsiveLayoutTimer = setTimeout(() => {
            _deferredResponsiveLayoutTimer = null;
            _responsiveLayoutArmed = true;
            attachResponsiveLayoutObserver();
            scheduleConditionalRelayout(_prevCols > 0 ? _prevCols : 1);
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
    _skipNextConditionalHeightAnimation = true;
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
        if (_conditionalRelayoutFrame) {
            cancelAnimationFrame(_conditionalRelayoutFrame);
            _conditionalRelayoutFrame = 0;
        }
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
