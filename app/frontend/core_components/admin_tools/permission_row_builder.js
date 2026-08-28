// permission_row_builder.js
// Builds the per-function rows rendered inside the admin permission editor grid.
// Bridges permission function metadata, icon assets, and checkbox state into row-level DOM.
// Exists to keep permission-row rendering logic separate from editor orchestration and saving.

import {
    table_icon_svg,
    ui_icon_svg,
    edit_icon_svg,
    global_icon_svg,
} from "./permission_icons.js";

export function createFunctionRows(funcList, targetArr, {
    permission_form,
    user_group_list,
    state,
    toggleEditMode,
}) {
    funcList.forEach((function_item) => {
        const row_container = document.createElement("div");
        row_container.classList.add("function-row");
        if (function_item.ui_only) {
            row_container.classList.add("ui-permission-row");
        } else {
            row_container.classList.add("server-permission-row");
        }
        if (function_item.specific_table_related) {
            row_container.classList.add("table-permission-row");
        } else {
            row_container.classList.add("tableless-permission-row");
        }

        let cleaned_name = function_item.name.replace(/Handler/g, "");
        cleaned_name = cleaned_name.replace(/([A-Z])/g, " $1");
        cleaned_name = cleaned_name.replace(/_/g, " ");
        cleaned_name = cleaned_name.replace(/\./, ": ");
        cleaned_name =
            cleaned_name.charAt(0).toUpperCase() + cleaned_name.slice(1);

        const function_cell = document.createElement("div");
        const name_div = document.createElement("div");
        name_div.textContent = cleaned_name;
        name_div.style.fontWeight = "bold";
        const iconWrapper = document.createElement("span");
        iconWrapper.classList.add("permission-type-icon");
        const parser = new DOMParser();
        let svgString = global_icon_svg;
        if (function_item.ui_only) {
            svgString = ui_icon_svg;
        } else if (function_item.specific_table_related) {
            svgString = table_icon_svg;
        }
        const svgDoc = parser.parseFromString(svgString, "image/svg+xml");
        iconWrapper.appendChild(svgDoc.documentElement);
        const route_div = document.createElement("div");
        route_div.textContent = function_item.url_route_endpoint;
        route_div.style.fontSize = "0.8em";
        route_div.style.opacity = "0.8";
        function_cell.appendChild(iconWrapper);
        function_cell.appendChild(name_div);
        function_cell.appendChild(route_div);
        function_cell.classList.add("function-cell");
        row_container.appendChild(function_cell);

        user_group_list.forEach((group_item, idx) => {
            const cell = document.createElement("div");
            cell.classList.add("checkbox-cell");
            if (idx < user_group_list.length - 1) {
                cell.classList.add("checkbox-cell-border");
            }

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.style.display = "none";
            checkbox.dataset.functionId = function_item.id;
            checkbox.dataset.groupId = group_item.id;
            checkbox.dataset.tableRelated =
                function_item.specific_table_related;
            checkbox.dataset.edited = "false";

            const staticIcon = document.createElement("span");
            staticIcon.classList.add("mp-static-checkbox");

            const editBtn = document.createElement("span");
            editBtn.classList.add("mp-edit-button");
            editBtn.innerHTML = edit_icon_svg;
            editBtn.style.display = "none";

            cell.addEventListener("mouseenter", () => {
                if (!state.editMode) editBtn.style.display = "block";
            });
            cell.addEventListener("mouseleave", () => {
                editBtn.style.display = "none";
            });
            editBtn.addEventListener("click", async (e) => {
                e.stopPropagation();
                if (!state.editMode) {
                    await toggleEditMode(true);
                }
            });

            checkbox.addEventListener("change", () => {
                if (!state.editMode) {
                    checkbox.checked =
                        checkbox.dataset.originalChecked === "true";
                    return;
                }
                const wasAmbiguous = checkbox.dataset.ambiguous === "true";
                if (wasAmbiguous) {
                    delete checkbox.dataset.ambiguous;
                    checkbox.indeterminate = false;
                    checkbox.classList.remove("mp-ambiguous-checkbox");
                }
                if (checkbox.dataset.tableRelated === "true") {
                    state.tablePermissionsDirty = true;
                } else {
                    state.tablelessPermissionsDirty = true;
                }

                const original =
                    checkbox.dataset.originalChecked === "true";
                const originalAmb =
                    checkbox.dataset.originalAmbiguous === "true";
                const nowAmb = checkbox.dataset.ambiguous === "true";
                const edited =
                    checkbox.checked !== original ||
                    nowAmb !== originalAmb ||
                    wasAmbiguous;
                let label = cell.querySelector(".mp-edited-label");
                if (edited) {
                    if (!label) {
                        label = document.createElement("span");
                        label.textContent = "edited";
                        label.classList.add("mp-edited-label");
                        cell.appendChild(label);
                    }
                } else if (label) {
                    label.remove();
                }
                checkbox.dataset.edited = edited ? "true" : "false";
            });

            cell.appendChild(checkbox);
            cell.appendChild(staticIcon);
            cell.appendChild(editBtn);
            row_container.appendChild(cell);
        });

        permission_form.appendChild(row_container);
        targetArr.push({ row_container, function_item });
    });
}
