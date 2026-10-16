// row_article_image_controls.js
// Builds the same accessible image navigation for inline and image-first articles.
// Connects permitted image lists to local previous/next actions and position labels.
// Keeps button labels, propagation boundaries and appearance consistent between views.
import { getTranslationForKey } from "../../lang/translation_handler.js";
import { createMaskIconSpan } from "../../../icons/icon_mask_builder.js";

// History chevrons keep image navigation distinct from the barred record icons.
export function buildRowArticleImageArrowIcon(direction) {
    return createMaskIconSpan(
        `/frontend/icons/navigation/nav-history-${direction === "previous" ? "back" : "forward"}-icon.svg`,
        ["row_article_image_arrow_icon"],
    );
}

export function buildRowArticleImageArrow(direction, activate) {
    const isPrevious = direction === "previous";
    const langKey = isPrevious ? "previous_image" : "next_image";
    const fallback = isPrevious ? "Previous image" : "Next image";
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add(
        "row_article_image_first_arrow",
        `row_article_image_first_arrow--${direction}`,
        "fw-btn",
        "fw-btn--ghost",
    );
    button.dataset.testid = `row-article-image-${direction}`;
    button.dataset.titleLangKey = langKey;
    button.dataset.ariaLabelLangKey = langKey;
    button.appendChild(buildRowArticleImageArrowIcon(direction));
    button.title = getTranslationForKey(langKey) || fallback;
    button.setAttribute("aria-label", button.title);
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        activate();
    });
    return button;
}


export function buildRowArticleImagePosition() {
    const position = document.createElement("span");
    position.classList.add("row_article_image_first_position");
    position.dataset.testid = "row-article-image-position";
    position.setAttribute("aria-live", "polite");
    return position;
}
