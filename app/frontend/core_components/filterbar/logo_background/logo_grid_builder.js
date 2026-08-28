// logo_grid_builder.js
// Builds the decorative project logo for the filterbar hero area.
// Uses a backend-provided logo path when a project logo exists on disk.
// Falls back to the fixed Serlog grid only for Serlog-branded projects.
// Exists to avoid false Serlog branding and blind 404 image probes on other projects.

const GRID_COLUMNS = 8;

const HUE_LIGHTNESS_OFFSETS_LIGHT = {
    210: [0, 0], 240: [15, -30], 270: [10, -25], 300: [0, 0],
    330: [0, -30], 0: [5, -30], 30: [5, -25], 60: [-5, -15],
    90: [0, 0], 120: [0, 0], 150: [-5, -25], 180: [-10, -20],
};
const HUE_LIGHTNESS_OFFSETS_DARK = {
    210: [0, 0], 240: [15, -30], 270: [-5, -25], 300: [0, 0],
    330: [-10, -30], 0: [-15, -30], 30: [-15, -10], 60: [-15, -10],
    90: [0, 0], 120: [0, 0], 150: [-5, -25], 180: [-15, -10],
};

function isDarkMode() {
    if (document.body.classList.contains("dark-mode")) return true;
    if (document.body.classList.contains("light-mode")) return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getConfiguredProjectLogoPath() {
    return document.querySelector('meta[name="project-logo-path"]')?.content?.trim() || "";
}

function getCurrentSiteName() {
    return document.querySelector('meta[property="og:site_name"]')?.content?.trim() || "";
}

function isSerlogProject(siteName) {
    return siteName.toLowerCase().includes("serlog");
}

/* -------------------------------------------------------
 *  Serlog letter grid — fixed layout, do not modify.
 *  Row 1: [gray] S E R V I C E
 *  Row 2: C A T A L O G [gray]
 * ------------------------------------------------------- */
const SERLOG_GRID_DATA = [
    { text: "THE", style: "gray-gradient", label: "endcap" },
    { text: "S", hue: 210 }, { text: "E", hue: 210 }, { text: "R", hue: 210 },
    { text: "V", hue: 240 }, { text: "I", hue: 270 }, { text: "C", hue: 330 },
    { text: "E", hue: 0 },
    { text: "C", hue: 30 }, { text: "A", hue: 60 }, { text: "T", hue: 150 },
    { text: "A", hue: 180 }, { text: "L", hue: 210 }, { text: "O", hue: 210 },
    { text: "G", hue: 210 }, { text: ".COM", style: "gray-gradient", label: "endcap" },
];

function buildSerlogGrid() {
    const darkMode = isDarkMode();
    const hueLightnessOffsets = darkMode ? HUE_LIGHTNESS_OFFSETS_DARK : HUE_LIGHTNESS_OFFSETS_LIGHT;

    const grid = document.createElement("div");
    grid.classList.add("logo-letter-backgrounds-container");
    grid.classList.add("logo-letter-backgrounds-container--serlog-glow");
    grid.classList.add(darkMode
        ? "logo-letter-backgrounds-container--theme-dark"
        : "logo-letter-backgrounds-container--theme-light");

    const totalCells = SERLOG_GRID_DATA.length;
    SERLOG_GRID_DATA.forEach((item, i) => {
        const cell = document.createElement("div");
        cell.classList.add("logo-letter-background");
        if (item.text) {
            cell.classList.add("logo-letter-background--has-letter");
        }
        if (item.label === "endcap") {
            cell.classList.add("logo-letter-background--endcap-label");
        }
        cell.style.setProperty("--logo-cell-column", String(i % GRID_COLUMNS));
        cell.style.setProperty("--logo-cell-row", String(Math.floor(i / GRID_COLUMNS)));

        // Corner classes for selective border-radius
        if (i === 0) cell.classList.add("logo-corner-tl");
        if (i === GRID_COLUMNS - 1) cell.classList.add("logo-corner-tr");
        if (i === totalCells - GRID_COLUMNS) cell.classList.add("logo-corner-bl");
        if (i === totalCells - 1) cell.classList.add("logo-corner-br");

        if (item.style === "gray-gradient") {
            cell.style.background = "var(--logo-letter-bg-gray-gradient)";
            cell.style.color = "var(--logo-letter-bg-neutral-text-color)";
        } else {
            const hueVal = item.hue;
            if (hueVal !== 210) {
                cell.classList.add("logo-letter-background--monochrome-letter");
                cell.style.backgroundColor = "var(--logo-letter-bg-monochrome-color)";
                cell.style.color = "var(--logo-letter-bg-monochrome-text-color)";
            } else {
                cell.classList.add("logo-letter-background--blue-letter");
                let lightnessOffset = 0;
                let saturationOffset = 0;
                if (hueLightnessOffsets[hueVal] !== undefined) {
                    [lightnessOffset, saturationOffset] = hueLightnessOffsets[hueVal];
                }
                cell.style.backgroundColor = `hsl(${hueVal} calc(var(--logo-letter-bg-sat) * (1 + ${saturationOffset} / 100)) calc(var(--logo-letter-bg-light) * (1 + ${lightnessOffset} / 100)))`;
                cell.style.color = "var(--logo-letter-bg-text-color)";
            }
        }

        cell.textContent = item.text;
        grid.appendChild(cell);
    });

    return grid;
}

/* ===========================================================
 *  buildLogoLetterGrid
 *  Creates the project logo for the filterbar hero.
 *  Tries /storage/project_logo.png first (any project can
 *  provide a custom image). Falls back to the Serlog letter grid.
 * =========================================================*/
export function buildLogoLetterGrid() {
    const wrapper = document.createElement("div");
    wrapper.classList.add("project-logo-wrapper");

    const logoPath = getConfiguredProjectLogoPath();
    const siteName = getCurrentSiteName();

    if (!logoPath) {
        if (isSerlogProject(siteName)) {
            wrapper.appendChild(buildSerlogGrid());
        } else {
            wrapper.classList.add("project-logo-wrapper--hidden");
        }
        return wrapper;
    }

    const img = document.createElement("img");
    img.src = logoPath;
    img.alt = "";
    img.classList.add("project-logo-image");
    img.draggable = false;

    img.addEventListener("load", () => {
        wrapper.appendChild(img);
    });

    img.addEventListener("error", () => {
        if (isSerlogProject(siteName)) {
            wrapper.appendChild(buildSerlogGrid());
        } else {
            wrapper.classList.add("project-logo-wrapper--hidden");
        }
    });

    return wrapper;
}
