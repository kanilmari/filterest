// admin_version_info_panel_view.js
// Renders and positions the administrator version-information disclosure panel.
// Bridges localized version rows and refresh actions with one semantic table view.
// Exists to keep DOM and viewport mechanics separate from release-fetch state.

const VERSION_INFO_PANEL_GAP_PX = 8;
const VERSION_INFO_PANEL_VIEWPORT_MARGIN_PX = 12;

export function renderAdminVersionInfoRows(panel, rows, title) {
    const heading = document.createElement("thead");
    const headingRow = document.createElement("tr");
    const headingCell = document.createElement("th");
    headingCell.colSpan = 2;
    headingCell.classList.add("filterbar-clock-bar__version-info-title");
    headingCell.textContent = title;
    headingRow.appendChild(headingCell);
    heading.appendChild(headingRow);

    const body = document.createElement("tbody");
    const rowElements = rows.map(({ id, label, value, href = "" }) => {
        const row = document.createElement("tr");
        const keyCell = document.createElement("th");
        keyCell.scope = "row";
        keyCell.classList.add("filterbar-clock-bar__version-info-key");
        keyCell.dataset.versionInfoKey = id;
        keyCell.textContent = label;

        const valueCell = document.createElement("td");
        valueCell.classList.add("filterbar-clock-bar__version-info-value");
        valueCell.dataset.versionInfoValue = id;
        if (href) {
            const releaseLink = document.createElement("a");
            releaseLink.classList.add("filterbar-clock-bar__version-info-link");
            releaseLink.href = href;
            releaseLink.target = "_blank";
            releaseLink.rel = "noopener noreferrer";
            releaseLink.textContent = value;
            valueCell.appendChild(releaseLink);
        } else {
            valueCell.textContent = value;
        }

        row.append(keyCell, valueCell);
        return row;
    });
    body.append(...rowElements);
    panel.replaceChildren(heading, body);
}

export function renderAdminVersionInfoMessage(panel, title, message) {
    const heading = document.createElement("thead");
    const headingRow = document.createElement("tr");
    const headingCell = document.createElement("th");
    headingCell.colSpan = 2;
    headingCell.classList.add("filterbar-clock-bar__version-info-title");
    headingCell.textContent = title;
    headingRow.appendChild(headingCell);
    heading.appendChild(headingRow);

    const body = document.createElement("tbody");
    const messageRow = document.createElement("tr");
    const messageCell = document.createElement("td");
    messageCell.colSpan = 2;
    messageCell.classList.add("filterbar-clock-bar__version-info-message");
    messageCell.textContent = message;
    messageRow.appendChild(messageCell);
    body.appendChild(messageRow);
    panel.replaceChildren(heading, body);
}

export function appendAdminVersionRefreshControl(
    panel,
    labels,
    { checking = false, checkFailed = false, onCheckAgain = () => {} } = {},
) {
    const body = panel.tBodies[0];
    if (!body) return;

    const row = document.createElement("tr");
    row.classList.add("filterbar-clock-bar__version-refresh-row");
    const cell = document.createElement("td");
    cell.colSpan = 2;
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("filterbar-clock-bar__version-refresh-button");
    button.dataset.testid = "filterbar-admin-version-check-again";
    button.disabled = checking;
    button.textContent = checking ? labels.checkingAgain : labels.checkAgain;
    button.addEventListener("click", onCheckAgain);
    cell.appendChild(button);

    if (checkFailed) {
        const errorMessage = document.createElement("span");
        errorMessage.classList.add("filterbar-clock-bar__version-refresh-error");
        errorMessage.setAttribute("role", "status");
        errorMessage.textContent = labels.checkFailed;
        cell.appendChild(errorMessage);
    }

    row.appendChild(cell);
    body.appendChild(row);
}

function clampPanelCoordinate(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function positionAdminVersionInfoPanel(indicator, panel) {
    if (panel.hidden || panel.parentElement !== document.body) return;

    const anchorRect = indicator.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const maximumLeft = viewportWidth
        - VERSION_INFO_PANEL_VIEWPORT_MARGIN_PX
        - panelRect.width;
    const left = clampPanelCoordinate(
        anchorRect.right - panelRect.width,
        VERSION_INFO_PANEL_VIEWPORT_MARGIN_PX,
        maximumLeft,
    );
    const topWhenAbove = anchorRect.top - VERSION_INFO_PANEL_GAP_PX - panelRect.height;
    const topWhenBelow = anchorRect.bottom + VERSION_INFO_PANEL_GAP_PX;
    const spaceAbove = anchorRect.top - VERSION_INFO_PANEL_VIEWPORT_MARGIN_PX;
    const spaceBelow = viewportHeight
        - anchorRect.bottom
        - VERSION_INFO_PANEL_VIEWPORT_MARGIN_PX;
    const placeAbove = topWhenAbove >= VERSION_INFO_PANEL_VIEWPORT_MARGIN_PX
        || spaceAbove >= spaceBelow;
    const maximumTop = viewportHeight
        - VERSION_INFO_PANEL_VIEWPORT_MARGIN_PX
        - panelRect.height;
    const top = clampPanelCoordinate(
        placeAbove ? topWhenAbove : topWhenBelow,
        VERSION_INFO_PANEL_VIEWPORT_MARGIN_PX,
        maximumTop,
    );

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.dataset.versionInfoPlacement = placeAbove ? "top" : "bottom";
}
