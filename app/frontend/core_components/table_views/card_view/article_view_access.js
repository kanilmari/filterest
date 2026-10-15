// article_view_access.js
// Gates article openers before they change dataset, history or modal state.
// Connects authoritative route grants, card affordances and the shared notice component.
// Keeps classic and image-first articles behind the same view permission for every viewer.

import { hasRoutePermission } from '../../route_permission_checker.js';
import { getLanguageWithBrowserFallback } from '../../state_stores/lang_preference_reader.js';
import { showToast } from '../../../reusable_components/notifications/toast_notification_printer.js';
import { addCardResourceListener } from './card_resource_lifecycle.js';

export const ARTICLE_VIEW_ROUTE = '/ui/view/article_view';
export const ARTICLE_VIEW_DENIED_KEY = 'article_view_permission_missing';
const COPY = Object.freeze({
    fi: 'Artikkelia ei voi avata, koska sinulta puuttuu artikkelinäkymän käyttöoikeus.',
    en: 'You cannot open this article because you do not have permission to use the article view.',
    ch: '你没有文章视图的使用权限，无法打开此文章。',
    yue: '你冇文章視圖嘅使用權限，無法開啟呢篇文章。',
});

export function canOpenArticleView() {
    return hasRoutePermission(ARTICLE_VIEW_ROUTE);
}

/** Explains denial locally before any opener commits its view or address. */
export function requireArticleViewAccess() {
    if (canOpenArticleView()) return true;
    const language = getLanguageWithBrowserFallback();
    const content = document.createElement('span');
    content.dataset.langKey = ARTICLE_VIEW_DENIED_KEY;
    const locale = language === 'zh-HK' ? 'yue' : language.startsWith('zh') ? 'ch' : language;
    content.textContent = COPY[locale] || COPY.en;
    // The normal language observer applies site-authored copy and live language changes.
    showToast({ content, level: 'warning' });
    return false;
}

/** Removes opening semantics while retaining a click/keyboard explanation. */
export function applyArticleViewAffordance(element) {
    const allowed = canOpenArticleView();
    element.dataset.articleAccess = allowed ? 'allowed' : 'denied';
    if (!allowed) {
        element.removeAttribute('href');
        element.removeAttribute('role');
        element.removeAttribute('tabindex');
        element.removeAttribute('aria-label');
        delete element.dataset.ariaLabelLangKey;
    }
    return allowed;
}

/** Native buttons must be plain text when denied, without an implicit button role. */
export function createArticleOpenerElement(tagName) {
    return document.createElement(canOpenArticleView() ? tagName : 'span');
}

function isSeparateInteractiveChild(element, target) {
    if (!(target instanceof Element)) return false;
    const control = target.closest('a[href], button, input, select, textarea, [contenteditable="true"]');
    return control && control !== element && element.contains(control)
        && !control.hasAttribute('data-article-access');
}

/** Binds existing opener behavior without granting rights or changing its allowed path. */
export function bindArticleViewActivation(element, activate, { keyboard = false } = {}) {
    applyArticleViewAffordance(element);
    const open = event => {
        // Independent field links/editors are still usable without an article grant.
        if (!canOpenArticleView() && isSeparateInteractiveChild(element, event.target)) return;
        if (!requireArticleViewAccess()) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        activate(event);
    };
    addCardResourceListener(element, 'click', open);
    addCardResourceListener(element, 'keydown', event => {
        if (!['Enter', ' '].includes(event.key)) return;
        const allowed = canOpenArticleView();
        if (allowed && event.target !== element) return;
        if (!allowed && isSeparateInteractiveChild(element, event.target)) return;
        if (keyboard || !allowed) {
            event.preventDefault();
            open(event);
        }
    });
    return element;
}
