// row_article_child_tabs.js
// Exposes article-view related-tab names on top of the legacy big-card child-tab module.
// Bridges newer row_article imports with the existing related-record tab rendering behavior.
// Exists to let callers migrate deeper card-view naming without touching the tab logic itself.

export {
    buildChildTabs,
    buildRelatedTabs,
    buildRowArticleRelatedTabs,
} from "./big_card_child_tabs.js";
