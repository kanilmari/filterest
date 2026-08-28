// permission_icons.js
// Loads and caches the SVG icons used by the permission editor UI.
// Bridges the shared icon loader with permission-row visuals and checkbox states.
// Exists to keep permission-editor icon assets centralized and reusable.

import { loadSvgIcon } from "../../icons/icon_loader.js";

const PERMISSION_ICON_PATHS = {
    table: "/frontend/icons/admin/permission-table-icon.svg",
    user: "/frontend/icons/admin/permission-user-icon.svg",
    ui: "/frontend/icons/admin/permission-ui-icon.svg",
    edit: "/frontend/icons/admin/permission-edit-icon.svg",
    global: "/frontend/icons/admin/permission-global-icon.svg",
    checked: "/frontend/icons/admin/permission-checkbox-checked-icon.svg",
    unchecked: "/frontend/icons/admin/permission-checkbox-unchecked-icon.svg",
    ambiguous: "/frontend/icons/admin/permission-checkbox-ambiguous-icon.svg",
};

export let table_icon_svg = "";
export let user_icon_svg = "";
export let ui_icon_svg = "";
export let edit_icon_svg = "";
export let global_icon_svg = "";
export let static_checked_svg = "";
export let static_unchecked_svg = "";
export let static_ambiguous_svg = "";

let permission_icons_load_promise = null;

export async function ensurePermissionIconsLoaded() {
    if (!permission_icons_load_promise) {
        permission_icons_load_promise = Promise.all([
            loadSvgIcon(PERMISSION_ICON_PATHS.table),
            loadSvgIcon(PERMISSION_ICON_PATHS.user),
            loadSvgIcon(PERMISSION_ICON_PATHS.ui),
            loadSvgIcon(PERMISSION_ICON_PATHS.edit),
            loadSvgIcon(PERMISSION_ICON_PATHS.global),
            loadSvgIcon(PERMISSION_ICON_PATHS.checked),
            loadSvgIcon(PERMISSION_ICON_PATHS.unchecked),
            loadSvgIcon(PERMISSION_ICON_PATHS.ambiguous),
        ]).then((icons) => {
            [
                table_icon_svg,
                user_icon_svg,
                ui_icon_svg,
                edit_icon_svg,
                global_icon_svg,
                static_checked_svg,
                static_unchecked_svg,
                static_ambiguous_svg,
            ] = icons;
        });
    }

    return permission_icons_load_promise;
}
