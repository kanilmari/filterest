// custom_root_copy.js
// Owns four-language labels for the operator-provided root page setting.
// Connects Home settings and live language changes without database language keys.
// Follows the source-owned administrator-copy convention of this release series.
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';

export const CUSTOM_ROOT_COPY = Object.freeze({
    en: {
        enabled: 'Show the site’s own index.html at Home',
        help: 'The custom page replaces the whole Home page, including menus. Requiring login to browse also protects this page and its files.',
        ready: 'index.html exists and is ready to serve.',
        missing: 'index.html is missing. The normal Home behaviour remains.',
        unavailable: 'index.html exists but cannot be served. Check permissions, symlinks and the 2 MiB size limit.',
        unknown: 'File status is unavailable. Reload Home settings.',
    },
    fi: {
        enabled: 'Näytä sivuston oma index.html etusivuna',
        help: 'Oma sivu korvaa koko etusivun valikoineen. Selailun kirjautumisvaatimus suojaa myös tätä sivua ja sen tiedostoja.',
        ready: 'index.html on olemassa ja valmis näytettäväksi.',
        missing: 'index.html puuttuu. Etusivu toimii tavalliseen tapaan.',
        unavailable: 'index.html on olemassa, mutta sitä ei voi näyttää. Tarkista käyttöoikeudet, symboliset linkit ja 2 MiB:n kokoraja.',
        unknown: 'Tiedoston tila ei ole saatavilla. Lataa etusivun asetukset uudelleen.',
    },
    ch: {
        enabled: '将网站自己的 index.html 显示为首页',
        help: '自定义页面替换整个首页，包括菜单。要求登录才能浏览时，此页面及其文件也受到保护。',
        ready: 'index.html 已存在，可以显示。',
        missing: '缺少 index.html，首页将保持原有行为。',
        unavailable: 'index.html 已存在，但无法显示。请检查权限、符号链接及 2 MiB 大小限制。',
        unknown: '无法获取文件状态，请重新加载首页设置。',
    },
    yue: {
        enabled: '將網站自己嘅 index.html 顯示為首頁',
        help: '自訂頁面會取代成個首頁，包括選單。要求登入先可以瀏覽時，呢個頁面同佢嘅檔案都會受到保護。',
        ready: 'index.html 已經存在，可以顯示。',
        missing: '搵唔到 index.html，首頁會維持原本嘅行為。',
        unavailable: 'index.html 已經存在，但顯示唔到。請檢查權限、符號連結同 2 MiB 大小限制。',
        unknown: '暫時讀唔到檔案狀態，請重新載入首頁設定。',
    },
});

export function getCustomRootCopy(language = getLanguageWithBrowserFallback()) {
    const normalized = String(language).toLowerCase().replaceAll('_', '-');
    if (normalized.startsWith('fi')) return CUSTOM_ROOT_COPY.fi;
    if (normalized.startsWith('yue') || normalized.startsWith('zh-hk')) return CUSTOM_ROOT_COPY.yue;
    if (normalized.startsWith('ch') || normalized.startsWith('zh')) return CUSTOM_ROOT_COPY.ch;
    return CUSTOM_ROOT_COPY.en;
}
