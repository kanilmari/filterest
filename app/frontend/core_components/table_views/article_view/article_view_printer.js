// article_view_printer.js
// Builds the independent article presentation and its result navigation shell.
// Bridges the article field projection and state with reusable card summaries.
// Exists so article visibility, selection, and DOM never reuse the card view container.
import { create_card_view } from "../card_view/card_view_printer.js";
import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";

/** Builds article result navigation while preserving the card presentation state. */
export async function create_article_view(columns, data, tableName) {
    const state = getUnifiedTableState(tableName).articleView || {};
    if (!state.collapsed && state.expandedId == null) {
        setUnifiedTableState(tableName, {
            articleView: { collapsed: true, pendingAutoOpenFirstRenderedResult: true },
        });
    }
    const wrapper = await create_card_view(columns, data, tableName, {
        viewKey: "article_view",
        stateKey: "articleView",
    });
    wrapper.classList.add("article_view_wrapper");
    return wrapper;
}
