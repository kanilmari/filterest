// filterbar_chat_layout_controller.js
// Coordinates chat expansion inside the existing filter panel.
// Bridges measured panel geometry and the chat dock's own maximized state.
// Keeps animation timers and cleanup local to the mounted panel lifetime.

export function createFilterbarChatLayout({ chatDock, panel, panelBody, datasetTitleRow,
    signal, closeOpenFilterDropdowns, syncPanelBodyScrolledState }) {
    function getChatDockCollapsedHeight() {
        const header = chatDock?.querySelector(".filterbar-chat-dock__header");
        const headerHeight = header?.getBoundingClientRect?.().height || 0;
        if (headerHeight > 0) {
            return headerHeight;
        }
        return 56;
    }

    function getChatDockExpandedHeight() {
        const panelRect = panel.getBoundingClientRect();
        const titleRect = datasetTitleRow?.getBoundingClientRect?.();
        const panelStyles = window.getComputedStyle(panel);
        const reservedBottom = Number.parseFloat(panelStyles.paddingBottom || "0") || 0;
        return Math.max(
            getChatDockCollapsedHeight(),
            panelRect.height - (titleRect?.height || 0) - reservedBottom
        );
    }

    function setChatDockAnimationHeight(height) {
        const normalizedHeight = `${Math.max(0, height)}px`;
        chatDock.style.height = normalizedHeight;
        chatDock.style.maxHeight = normalizedHeight;
        chatDock.style.flex = `0 0 ${normalizedHeight}`;
    }

    function clearChatDockAnimationStyles() {
        chatDock.style.height = "";
        chatDock.style.maxHeight = "";
        chatDock.style.flex = "";
        chatDock.style.transition = "";
    }

    function animateChatLayout(maximized, onComplete) {
        if (!chatDock) {
            return;
        }

        const animationToken = Symbol("filterbar-chat-animation");
        chatDock.__chatAnimationToken = animationToken;
        const nextMaximized = Boolean(maximized);
        const currentChatHeight = chatDock.getBoundingClientRect().height ||
            getChatDockCollapsedHeight();
        const targetChatHeight = nextMaximized
            ? getChatDockExpandedHeight()
            : getChatDockCollapsedHeight();
        const duration = 240;

        const finishAnimation = () => {
            if (chatDock.__chatAnimationToken !== animationToken) {
                return;
            }
            onComplete?.();
            chatDock.removeEventListener("transitionend", handleChatDockTransitionEnd);
            panel.classList.remove("filterbar-panel--chat-layout-animating");
            clearChatDockAnimationStyles();
            delete chatDock.dataset.chatAnimationDirection;
            delete chatDock.__chatAnimationToken;
        };
        let completed = false;
        const finishOnce = () => {
            if (completed) {
                return;
            }
            completed = true;
            finishAnimation();
        };
        const handleChatDockTransitionEnd = (event) => {
            if (event.target !== chatDock) {
                return;
            }
            if (event.propertyName !== "height") {
                return;
            }
            finishOnce();
        };

        panel.classList.add("filterbar-panel--chat-layout-animating");
        chatDock.style.transition = "none";
        setChatDockAnimationHeight(currentChatHeight);
        void panel.offsetHeight;

        if (nextMaximized) {
            chatDock.__setMaximized?.(true);
            panel.classList.add("filterbar-panel--chat-maximized");
        }

        window.requestAnimationFrame(() => {
            const easing = "cubic-bezier(0.4, 0, 0.2, 1)";
            chatDock.style.transition = [
                `height ${duration}ms ${easing}`,
                `max-height ${duration}ms ${easing}`,
                `flex-basis ${duration}ms ${easing}`,
            ].join(", ");
            setChatDockAnimationHeight(targetChatHeight);
        });

        chatDock.addEventListener("transitionend", handleChatDockTransitionEnd);
        window.setTimeout(finishOnce, duration + 200);
    }

    function setChatMaximized(maximized) {
        if (!chatDock) {
            return;
        }

        const nextMaximized = Boolean(maximized);
        chatDock.dataset.chatAnimationDirection = nextMaximized ? "opening" : "closing";
        if (nextMaximized) {
            closeOpenFilterDropdowns();
            panel.classList.remove("filterbar-panel--body-scrolled");
            panelBody.scrollTop = 0;
            animateChatLayout(true);
            return;
        }

        animateChatLayout(false, () => {
            chatDock.__setMaximized?.(false);
            panel.classList.remove("filterbar-panel--chat-maximized");
            syncPanelBodyScrolledState();
        });
    }

    chatDock?.addEventListener("filterbar-chat-maximize-toggle", (event) => {
        event.preventDefault();
        setChatMaximized(Boolean(event.detail?.maximized));
    }, { signal });

    return { setChatMaximized };
}
