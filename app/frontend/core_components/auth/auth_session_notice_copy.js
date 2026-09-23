// auth_session_notice_copy.js
// Bootstrap copy for the sentences that explain why the login page appeared.
// Bridges the login page and an installation whose reviewed translations for
// these keys do not exist yet; the site's own translations always win.
// Exists because this sentence has to be readable the moment the login page
// opens, before any translation has been fetched, and in every supported
// language rather than only the two the page used to carry.

// Each entry reads [Finnish, English, Chinese, Cantonese].
const COPY = {
    session_ended_sign_in_again: [
        "Istuntosi on päättynyt tai et ole enää kirjautuneena sisään. Kirjaudu uudelleen jatkaaksesi.",
        "Your session has ended or you are no longer signed in. Sign in again to continue.",
        "您的登录会话已结束，或者您已不再处于登录状态。请重新登录以继续。",
        "你嘅登入時段已經結束，或者你已經唔係登入狀態。請重新登入先可以繼續。",
    ],
    signed_out_in_another_tab: [
        "Sinut kirjattiin ulos toisessa välilehdessä.",
        "You were signed out in another tab.",
        "您已在另一个标签页中退出登录。",
        "你喺另一個分頁度已經登出咗。",
    ],
};

const LANGUAGES = ["fi", "en", "ch", "yue"];

/** The copy in the { fi, en, ch, yue } shape the page translator's fallbacks use. */
export const AUTH_SESSION_NOTICE_TRANSLATION_FALLBACKS = Object.freeze(Object.fromEntries(
    Object.entries(COPY).map(([key, texts]) => [
        key,
        Object.freeze(Object.fromEntries(LANGUAGES.map((language, index) => [language, texts[index]]))),
    ])
));

/**
 * Picks the bootstrap sentence for one language key.
 *
 * The language tag comes from the person's own preference or the browser, so it
 * can be anything from "fi" to "zh-HK". The matching follows the page
 * translator's own fallback rule, and an unknown language reads English rather
 * than a key name.
 *
 * @param {string} langKey - The language key to read
 * @param {string} [languageCode] - The reader's language tag
 * @returns {string} The sentence, or an empty string for an unknown key
 */
export function resolveAuthSessionNoticeFallback(langKey, languageCode = "en") {
    const copy = AUTH_SESSION_NOTICE_TRANSLATION_FALLBACKS[langKey];
    if (!copy) return "";

    const language = String(languageCode || "").trim().toLowerCase();
    if (language.startsWith("fi")) return copy.fi;
    if (language.startsWith("yue") || language.startsWith("zh-hk")) return copy.yue;
    if (language.startsWith("ch") || language.startsWith("zh")) return copy.ch;
    return copy.en;
}
