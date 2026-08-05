#!/bin/bash
# check_file_length.sh
# Enforces the 700-line file limit from DEV_GUIDE §3.
# Scans selected core/reusable frontend and backend source roots (.js, .go, .css).
# Exits 0 with warnings or exits 1 in strict mode (--strict) for unknown violations.
#
# Usage:
#   ./server_tools/scripts/check_file_length.sh                         # warn only
#   ./server_tools/scripts/check_file_length.sh --strict                 # fail on unknown violations
#   ./server_tools/scripts/check_file_length.sh --strict --show-legacy   # also list known legacy files

MAX_LINES=700
STRICT=false
SHOW_LEGACY=false
VIOLATIONS=0
NEW_VIOLATIONS=0
LEGACY_VIOLATIONS=0

# Known legacy violations — these warn but don't fail in strict mode.
# Remove entries as files are refactored under the limit.
KNOWN_LEGACY=(
    "backend/core_components/dev_tools/queen_session_handler.go"
    "backend/core_components/dev_tools/queen_session_handler_test.go"
    "backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_delete/delete_row.go"
    "backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_delete/delete_row_test.go"
    "backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/card_support_enrichment.go"
    "backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/card_support_enrichment_test.go"
    "backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/filterbar_ai_facade_handler.go"
    "backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/filterbar_ai_facade_handler_test.go"
    "backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/filterbar_ai_query_builder.go"
    "backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/get_child_items.go"
    "backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read/get_child_items_test.go"
    "backend/core_components/dynamic_table_tools/dtt_asset_linking/image_asset_linking_handlers_test.go"
    "backend/core_components/dynamic_table_tools/dtt_crud_workflows/crud_workflows.go"
    "backend/core_components/dynamic_table_tools/dtt_table_folders/table_folders_test.go"
    "frontend/core_components/admin_tools/queen_chat_helpers.js"
    "frontend/core_components/admin_tools/queen_chat_helpers.test.js"
    "frontend/core_components/admin_tools/queen_chat_view.js"
    "frontend/core_components/ai_features/table_chat/table_chat_printer.js"
    "frontend/core_components/ai_features/table_chat/table_chat_printer.test.js"
    "frontend/core_components/auth/auth.css"
    "frontend/core_components/filterbar/filter_bar_builder.js"
    "frontend/core_components/filterbar/filter_list/filter_column_builder.js"
    "frontend/core_components/filterbar/filterbar.css"
    "frontend/core_components/general_tables/gt_1_row_crud/gt_1_1_row_create/row_relation_builder.js"
    "frontend/core_components/navigation/main_tabs/main_tab_printer.js"
    "frontend/core_components/navigation/menu_button/navbar.css"
    "frontend/core_components/table_views/card_view/big_card_attachment_list.js"
    "frontend/core_components/table_views/card_view/big_card_image_gallery.js"
    "frontend/core_components/table_views/card_view/card_view_printer.js"
    "frontend/core_components/table_views/card_view/cards.css"
    "frontend/core_components/table_views/map_view/map_view_printer.js"
    "frontend/core_components/table_views/table_component_builder.js"
    "frontend/core_components/vanilla_tree/van_tr_components/admin_tree_builder.js"
    "frontend/reusable_components/key_value_container/kv_container_printer.js"
    "frontend/reusable_components/vanilla_checkbox_table/vanilla_checkbox_table.js"
)

for arg in "$@"; do
    case "$arg" in
        --strict)
            STRICT=true
            ;;
        --show-legacy)
            SHOW_LEGACY=true
            ;;
    esac
done

is_known_legacy() {
    local file="$1"
    for known in "${KNOWN_LEGACY[@]}"; do
        if [ "$file" = "$known" ]; then
            return 0
        fi
    done
    return 1
}

while IFS= read -r line; do
    lines=$(echo "$line" | awk '{print $1}')
    file=$(echo "$line" | awk '{print $2}')
    if is_known_legacy "$file"; then
        LEGACY_VIOLATIONS=$((LEGACY_VIOLATIONS + 1))
        if [ "$SHOW_LEGACY" = true ]; then
            echo "  ℹ️  $file ($lines lines) [legacy]"
        fi
    else
        echo "  ⚠️  $file ($lines lines) [NEW]"
        NEW_VIOLATIONS=$((NEW_VIOLATIONS + 1))
    fi
    VIOLATIONS=$((VIOLATIONS + 1))
done < <(find frontend/core_components frontend/reusable_components backend/core_components backend/reusable_components \
    -type f \( -name '*.js' -o -name '*.go' -o -name '*.css' \) \
    -exec wc -l {} + 2>/dev/null \
    | awk -v max="$MAX_LINES" '$1 > max && $2 != "total" {print $1, $2}' \
    | sort -rn)

if [ "$VIOLATIONS" -eq 0 ]; then
    echo "  ✅ All files within ${MAX_LINES}-line limit."
else
    echo ""
    echo "  Found $VIOLATIONS file(s) exceeding ${MAX_LINES} lines ($NEW_VIOLATIONS new, $LEGACY_VIOLATIONS legacy)."
    if [ "$LEGACY_VIOLATIONS" -gt 0 ] && [ "$SHOW_LEGACY" != true ]; then
        echo "  ℹ️  Known legacy over-limit files hidden. Pass --show-legacy to list them."
    fi
    if [ "$STRICT" = true ] && [ "$NEW_VIOLATIONS" -gt 0 ]; then
        echo "  ❌ Strict mode: $NEW_VIOLATIONS new violation(s). Failing."
        exit 1
    elif [ "$STRICT" = true ]; then
        echo "  ✅ Strict mode: only known legacy violations, passing."
    else
        echo "  ℹ️  Warning only (use --strict to fail on new violations)."
    fi
fi
