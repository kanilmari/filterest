// card_keyword_builder.js
// Builds the keyword section for card view entries with responsive overflow behavior.
// Bridges keyword field data and the card DOM keyword container with ResizeObserver-driven layout.
// Exists to isolate keyword display logic and shared-observer lifecycle from the main card element builder.

import { createKeyValueElement } from "./card_field_formatter.js";
import { createShowMoreLink } from "./card_element_builder.js";
import { count_this_function } from "../../dev_tools/function_counter.js";
import { show_more_button_on_cards } from "../../../ui_config.js";

const keywordResizeCallbacks = new Map();
let sharedKeywordResizeObserver = null;

function observeKeywordContainer(target, onResize) {
    if (typeof ResizeObserver === "undefined") {
        window.addEventListener("resize", onResize);
        return () => {
            window.removeEventListener("resize", onResize);
        };
    }

    if (!sharedKeywordResizeObserver) {
        sharedKeywordResizeObserver = new ResizeObserver((entries) => {
            entries.forEach((entry) => {
                const callback = keywordResizeCallbacks.get(entry.target);
                if (callback) {
                    callback();
                }
            });
        });
    }

    keywordResizeCallbacks.set(target, onResize);
    sharedKeywordResizeObserver.observe(target);

    return () => {
        keywordResizeCallbacks.delete(target);
        sharedKeywordResizeObserver.unobserve(target);
    };
}

function addKeywordsSection(keywords_list, row_item, table_name, container, userOptions = {}) {
    count_this_function("addKeywordsSection");
    const CARD_MOUNT_EVENT = "easelect:card-mounted";

    const { deferResponsiveLayoutMs = 0 } = userOptions;

    if (keywords_list.length === 0) return;

    const hideFieldsOnCardsString =
        localStorage.getItem("hide_fields_on_cards") === "true"
            ? "true"
            : "false";
    const setFieldHideAttribute = (el) => (el.dataset.hideFieldOnCard = hideFieldsOnCardsString);

    const keywordsOuterContainer = document.createElement("div");
    keywordsOuterContainer.classList.add("card_keywords_container");
    keywordsOuterContainer.style.overflow = "hidden";
    setFieldHideAttribute(keywordsOuterContainer);

    const keywordTagsContainer = document.createElement("div");
    keywordTagsContainer.classList.add("card_keywords_tags");

    const allKeywordEntries = [];
    for (const kwObj of keywords_list) {
        kwObj.rawValue
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((word) => allKeywordEntries.push({ kwObj, word }));
    }

    const keywordsToShow = allKeywordEntries.slice(0, 3);

    const tagEntriesForLayout = [];
    const frag = document.createDocumentFragment();
    for (const { kwObj, word } of keywordsToShow) {
        const tagDiv = document.createElement("div");
        tagDiv.classList.add("keyword_tag", kwObj.columnClass);
        setFieldHideAttribute(tagDiv);

        let contentElement;
        if (!kwObj.hasLangKey && word.length > 100) {
            const shortened = word.slice(0, 100) + "...";
            contentElement = createKeyValueElement(
                kwObj.label,
                shortened,
                kwObj.column,
                kwObj.hasLangKey,
                "keyword_value"
            );
            const v = contentElement.querySelector(
                `[data-column="${kwObj.column}"]`
            );
            if (v && show_more_button_on_cards) {
                v.appendChild(document.createTextNode(" "));
                v.appendChild(createShowMoreLink(row_item, table_name));
            }
        } else {
            contentElement = createKeyValueElement(
                kwObj.label,
                word,
                kwObj.column,
                kwObj.hasLangKey,
                "keyword_value"
            );
        }
        contentElement.classList.add(kwObj.columnClass);
        setFieldHideAttribute(contentElement);

        tagDiv.appendChild(contentElement);
        frag.appendChild(tagDiv);
        tagEntriesForLayout.push({ dom: tagDiv, width: 0 });
    }

    keywordTagsContainer.appendChild(frag);
    keywordsOuterContainer.appendChild(keywordTagsContainer);
    container.appendChild(keywordsOuterContainer);

    let lastAvailableWidth = -1;

    function measureTagWidths() {
        tagEntriesForLayout.forEach((entry) => {
            entry.width = entry.dom.offsetWidth;
        });
    }

    function layoutTagsByAvailableWidth(force = false) {
        const available =
            keywordTagsContainer.clientWidth || keywordsOuterContainer.clientWidth;
        if (!force && available === lastAvailableWidth) {
            return;
        }
        lastAvailableWidth = available;

        let used = 0;
        for (const { dom, width } of tagEntriesForLayout) {
            if (used + width <= available) {
                dom.style.display = "inline-block";
                used += width;
            } else {
                dom.style.display = "none";
            }
        }
    }

    // Debounced resize: during continuous window resize, defer keyword layout
    // until the user stops resizing. Prevents N keyword sections from each
    // doing synchronous layout work every frame.
    let _kwDebounce = null;
    const scheduleLayout = () => {
        if (_kwDebounce !== null) clearTimeout(_kwDebounce);
        _kwDebounce = setTimeout(() => {
            _kwDebounce = null;
            layoutTagsByAvailableWidth();
        }, 150);
    };

    let deferredObserverTimer = null;
    let cleanupResizeObserver = () => {};
    let cleanupMountWait = () => {};
    let cleanupObserverActivationWait = () => {};

    const attachKeywordResizeObserver = () => {
        cleanupResizeObserver = observeKeywordContainer(
            keywordsOuterContainer,
            scheduleLayout
        );
    };

    const scheduleObserverActivation = () => {
        cleanupObserverActivationWait();

        const activate = (delayMs = deferResponsiveLayoutMs) => {
            if (delayMs > 0) {
                deferredObserverTimer = setTimeout(() => {
                    deferredObserverTimer = null;
                    attachKeywordResizeObserver();
                }, delayMs);
            } else {
                attachKeywordResizeObserver();
            }
        };

        const cardHost = keywordsOuterContainer.closest(".card");
        if (cardHost?.classList.contains("card--entering")) {
            const onAnimationEnd = () => {
                cleanupObserverActivationWait();
                activate(0);
            };
            cardHost.addEventListener("animationend", onAnimationEnd, { once: true });
            cleanupObserverActivationWait = () => {
                cardHost.removeEventListener("animationend", onAnimationEnd);
            };
            return;
        }

        activate();
    };

    const initializeWhenMounted = () => {
        cleanupMountWait();
        measureTagWidths();
        layoutTagsByAvailableWidth(true);
        scheduleObserverActivation();
    };

    if (keywordsOuterContainer.isConnected) {
        initializeWhenMounted();
    } else {
        const cardHost = keywordsOuterContainer.closest(".card");
        if (cardHost) {
            const onCardMounted = () => {
                initializeWhenMounted();
            };
            cardHost.addEventListener(CARD_MOUNT_EVENT, onCardMounted, { once: true });
            cleanupMountWait = () => {
                cardHost.removeEventListener(CARD_MOUNT_EVENT, onCardMounted);
            };
        } else {
            initializeWhenMounted();
        }
    }

    const mutationObserver = new MutationObserver((muts) => {
        muts.forEach((mut) => {
            mut.removedNodes.forEach((node) => {
                if (node === keywordsOuterContainer) {
                    cleanupMountWait();
                    cleanupObserverActivationWait();
                    cleanupResizeObserver();
                    mutationObserver.disconnect();
                    if (deferredObserverTimer !== null) {
                        clearTimeout(deferredObserverTimer);
                        deferredObserverTimer = null;
                    }
                    if (_kwDebounce !== null) {
                        clearTimeout(_kwDebounce);
                        _kwDebounce = null;
                    }
                }
            });
        });
    });
    mutationObserver.observe(container, { childList: true });
}

export { addKeywordsSection };
