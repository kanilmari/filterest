// initial_browser_check.js
// Performs very early browser compatibility and initial layout-state checks.
// Bridges the static HTML shell, CSS layout variables, and localStorage navbar preference.
// Exists to block unsupported browsers and prevent avoidable navbar flicker before modules load.

const IS_DEV_MODE = document.querySelector('meta[name="app-env"]')?.content === "dev";

if (IS_DEV_MODE) console.log("Initial browser check script loaded.");

function readCssBreakpointPx(variableName, fallbackPx) {
    try {
        const rawValue = window
            .getComputedStyle(document.documentElement)
            .getPropertyValue(variableName)
            .trim();
        const parsedValue = Number.parseInt(rawValue, 10);
        return Number.isFinite(parsedValue) ? parsedValue : fallbackPx;
    } catch {
        return fallbackPx;
    }
}

const NAVBAR_WIDTH_THRESHOLD = readCssBreakpointPx("--navbar-breakpoint", 1850);

function checkForIEBrowser() {
    var userAgent = window.navigator.userAgent;
    // Otetaan selainkieli (IE:ssä voi olla userLanguage)
    var userLang = navigator.language || navigator.userLanguage || "en";

    // Tarkistetaan IE
    if (userAgent.indexOf("MSIE ") > 0 || userAgent.indexOf("Trident/") > 0) {
        // Jos kieli on suomi (tarkistetaan, alkaako "fi", fi-FI tms.)
        if (userLang.toLowerCase().indexOf("fi") === 0) {
            document.body.innerHTML = "<h1>Hei IE-käyttäjä!</h1>" +
                "<p>Internet Explorer on vanhentunut selain. " +
                "Lataa jokin uudempi, esimerkiksi <a href='https://brave.com/download/'>Brave</a>.</p>";
        } else {
            document.body.innerHTML = "<h1>Hello IE user!</h1>" +
                "<p>Your Internet Explorer browser is outdated. " +
                "Please install a more modern browser, for example <a href='https://brave.com/download/'>Brave</a>.</p>";
        }
        return false;
    } else {
        if (IS_DEV_MODE) console.log("Selaintarkistus OK, kaikki kunnossa!");
    }
}

// Kutsu funktiota
checkForIEBrowser();

function bootstrapInitialNavbarState() {
    const bodyContent = document.querySelector(".body_content");
    if (!bodyContent) {
        return;
    }

    try {
        const isWide = window.innerWidth >= NAVBAR_WIDTH_THRESHOLD;
        const storageKey = isWide ? "navVisibleWide" : "navVisibleNarrow";
        const storedVisibility = localStorage.getItem(storageKey);
        const shouldShowNavbar =
            storedVisibility !== null ? storedVisibility === "true" : isWide;

        bodyContent.dataset.navbarInitialOpen = shouldShowNavbar ? "true" : "false";
    } catch {
        bodyContent.dataset.navbarInitialOpen = "false";
    }
}

bootstrapInitialNavbarState();
