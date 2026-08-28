// password_visibility_icon_reader.js
// Loads and caches the SVG icons used for password visibility toggles.
// Bridges auth-field UI controls with the shared icon loader and cached SVG markup.
// Exists to keep password visibility icons ready without duplicating icon-loading logic.

import { loadSvgIcon } from "../../icons/icon_loader.js";

const PASSWORD_VISIBILITY_ICON_PATHS = {
    off: "/frontend/icons/auth/password-visibility-off-icon.svg",
    on: "/frontend/icons/auth/password-visibility-on-icon.svg",
};

let password_visibility_icons_load_promise = null;
let password_visibility_off_icon_svg = "";
let password_visibility_on_icon_svg = "";

export async function ensurePasswordVisibilityIconsLoaded() {
    if (!password_visibility_icons_load_promise) {
        password_visibility_icons_load_promise = Promise.all([
            loadSvgIcon(PASSWORD_VISIBILITY_ICON_PATHS.off),
            loadSvgIcon(PASSWORD_VISIBILITY_ICON_PATHS.on),
        ]).then(([offIcon, onIcon]) => {
            password_visibility_off_icon_svg = offIcon;
            password_visibility_on_icon_svg = onIcon;
        });
    }

    return password_visibility_icons_load_promise;
}

export function getPasswordVisibilityIcons() {
    return {
        visibilityOffSvg: password_visibility_off_icon_svg,
        visibilityOnSvg: password_visibility_on_icon_svg,
    };
}
