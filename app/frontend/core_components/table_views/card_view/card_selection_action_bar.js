// card_selection_action_bar.js
// Resolves card action permissions and renders the shared selected-row bar.
// Bridges existing card assembly with shared selection and presentation contracts.
// Exists to keep one card implementation within the source size limit.
import { parseRoleString } from "./card_field_formatter.js";
import { hasDatasetPermission } from "../../route_permission_checker.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import { resolveSiteTimestampDisplayOptions } from "./row_article_presentation_settings.js";
import { createEditRowPermissionsButton } from "../../admin_tools/row_access_editor.js";
import { createRowGroupAssignmentButton } from '../../admin_tools/row_group_assignment_editor.js';

/** Update all mass-delete bars to reflect current selection count. */
export function updateMassDeleteBar() {
    document.querySelectorAll('.card_mass_delete_bar').forEach(bar => {
        const w = bar.closest('.card_view_wrapper');
        if (!w) return;
        const count = w.querySelectorAll('.card.selected').length;
        if (count > 0) {
            bar.style.display = 'flex';
            const btn = bar.querySelector('.mass_delete_button');
            if (btn) {
                btn.dataset.langKey = 'delete_selected';
                btn.textContent = `Poista valitut (${count})`;
            }
            bar.querySelectorAll('.edit-row-permissions-button').forEach((button) => {
                button.__updateSelectionCount?.(count);
            });
        } else {
            bar.style.display = 'none';
        }
    });
}

export async function resolveCardRenderContext(
    table_name,
    columns,
    data_types,
    locale = getLanguageWithBrowserFallback()
) {
    const [hasDeleteRight, canManageRowAccess, canManageRowGroups, timestampDisplayOptions] = await Promise.all([
        hasDatasetPermission(
            "/api/delete-rows",
            table_name
        ),
        hasDatasetPermission("/api/admin/row-access-rules", ""),
        hasDatasetPermission("/api/admin/row-groups", ""),
        resolveSiteTimestampDisplayOptions(locale),
    ]);
    const tableHasImageRole = columns.some((column) =>
        parseRoleString(data_types[column]?.card_element || "").baseRoles.includes(
            "image"
        )
    );

    return {
        hasDeleteRight,
        canManageRowAccess,
        canManageRowGroups,
        tableHasImageRole,
        timestampDisplayOptions,
    };
}


export function createCardSelectionActionBar(table_name, renderContext) {
    // Shared selected-row action bar — hidden until cards are selected.
    const massDeleteBar = document.createElement("div");
    massDeleteBar.classList.add("card_mass_delete_bar", "card_selected_row_action_bar");
    massDeleteBar.style.display = "none";

    if (renderContext.hasDeleteRight) {
        const massDeleteBtn = document.createElement("button");
        massDeleteBtn.classList.add("button", "fw-btn", "mass_delete_button");
        massDeleteBtn.dataset.langKey = "delete_selected";
        massDeleteBtn.addEventListener("click", async () => {
            const { delete_selected_items } = await import("../../general_tables/gt_1_row_crud/gt_1_4_row_delete/row_remover.js");
            await delete_selected_items(table_name);
            updateMassDeleteBar();
        });
        massDeleteBar.appendChild(massDeleteBtn);
    }
    if (renderContext.canManageRowAccess) {
        massDeleteBar.appendChild(createEditRowPermissionsButton(table_name));
    }
    if (renderContext.canManageRowGroups) {
        massDeleteBar.appendChild(createRowGroupAssignmentButton(table_name));
    }
    if (massDeleteBar.children.length > 0) {
        return massDeleteBar;

    }

    return null;
}
