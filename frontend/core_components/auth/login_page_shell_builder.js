// login_page_shell_builder.js
// Initializes the standalone login page shell that wraps the pre-auth form.
// Bridges standalone-only tab controls with the shared login template panels.
// Exists so forced-login mode can show a polished full-page Login/Tour layout
// without entangling the SPA guest-shell modal flow.

export function resolveStandaloneAuthTab(hash = "") {
    return hash === "#tour" ? "tour" : "login";
}

export function initializeStandaloneLoginShell() {
    if (document.body?.dataset.loginPageMode !== "standalone") {
        return;
    }

    const tabButtons = Array.from(document.querySelectorAll("[data-auth-tab-target]"));
    const tabPanels = Array.from(document.querySelectorAll("[data-auth-tab-panel]"));
    if (tabButtons.length === 0 || tabPanels.length === 0) {
        return;
    }

    function activateTab(target, updateHash = false) {
        const activeTab = target === "tour" ? "tour" : "login";

        tabButtons.forEach((button) => {
            const isActive = button.dataset.authTabTarget === activeTab;
            button.classList.toggle("is-active", isActive);
            button.setAttribute("aria-selected", isActive ? "true" : "false");
            button.tabIndex = isActive ? 0 : -1;
        });

        tabPanels.forEach((panel) => {
            panel.hidden = panel.dataset.authTabPanel !== activeTab;
        });

        if (updateHash && window?.history?.replaceState) {
            const nextHash = activeTab === "tour" ? "#tour" : "";
            window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}${nextHash}`);
        }
    }

    tabButtons.forEach((button) => {
        button.addEventListener("click", () => {
            activateTab(button.dataset.authTabTarget, true);
        });
    });

    activateTab(resolveStandaloneAuthTab(window.location.hash));
}
