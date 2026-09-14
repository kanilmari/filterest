// article_section_defaults_copy.js
// Defines the article initial-disclosure editor's supported localized copy.
// Connects current language selection to the same small dataset-level settings panel.
// Keeps initial-open defaults distinct from field visibility and reading-time toggles.
const COPY = {
    en: {
        title: 'Article collapsible blocks', info: 'Dataset defaults for new articles, independent of field sets and user groups. Opening or closing a block while reading does not save these settings.',
        presentation: 'Article presentation', classic: 'Traditional article', image_first: 'Image-first article (IFAV)',
        details: 'Details', images: 'Images', attachments: 'Attachments', related_rows: 'Related rows', task_progress: 'Task progress',
        open: 'Open initially', save: 'Save block defaults', reset: 'Restore open defaults',
        saved: 'Article block defaults saved.', restored: 'Article blocks restored to open by default.',
        loading: 'Loading block defaults…', error: 'The article block settings could not be verified. Try again.',
        dirty: 'Unsaved block defaults', readOnly: 'You can view these settings; editing requires administrator access.',
    },
    fi: {
        title: 'Artikkelin avauslohkot', info: 'Aineiston oletukset uusille artikkeleille, erillään kenttäjoukoista ja käyttäjäryhmistä. Lohkon avaaminen tai sulkeminen lukemisen aikana ei tallenna näitä asetuksia.',
        presentation: 'Artikkelin esitystapa', classic: 'Perinteinen artikkeli', image_first: 'Kuvapainotteinen artikkeli (IFAV)',
        details: 'Tiedot', images: 'Kuvat', attachments: 'Liitteet', related_rows: 'Liittyvät rivit', task_progress: 'Tehtävän eteneminen',
        open: 'Auki aluksi', save: 'Tallenna lohkojen oletukset', reset: 'Palauta avoimet oletukset',
        saved: 'Artikkelin lohkojen oletukset tallennettu.', restored: 'Artikkelin lohkot palautettu oletuksena avoimiksi.',
        loading: 'Ladataan lohkojen oletuksia…', error: 'Artikkelin lohkoasetuksia ei voitu varmistaa. Yritä uudelleen.',
        dirty: 'Tallentamattomia lohkoasetuksia', readOnly: 'Voit katsoa asetuksia. Muokkaaminen vaatii ylläpito-oikeuden.',
    },
    ch: {
        title: '文章折叠区块', info: '新文章的数据集默认设置，独立于字段集和用户组。阅读时展开或折叠区块不会保存这些设置。',
        presentation: '文章展示方式', classic: '传统文章', image_first: '图片优先文章 (IFAV)',
        details: '详情', images: '图片', attachments: '附件', related_rows: '相关行', task_progress: '任务进度',
        open: '初始展开', save: '保存区块默认设置', reset: '恢复默认展开',
        saved: '已保存文章区块默认设置。', restored: '文章区块已恢复默认展开。',
        loading: '正在加载区块默认设置…', error: '无法验证文章区块设置，请重试。',
        dirty: '区块默认设置尚未保存', readOnly: '可以查看设置；编辑需要管理员权限。',
    },
    yue: {
        title: '文章開合區塊', info: '新文章嘅資料集預設設定，獨立於欄位集同用戶群組。閱讀時開合區塊唔會儲存呢啲設定。',
        presentation: '文章展示方式', classic: '傳統文章', image_first: '圖片優先文章 (IFAV)',
        details: '詳情', images: '圖片', attachments: '附件', related_rows: '相關資料列', task_progress: '工作進度',
        open: '初始展開', save: '儲存區塊預設設定', reset: '還原預設展開',
        saved: '已儲存文章區塊預設設定。', restored: '文章區塊已還原為預設展開。',
        loading: '載入緊區塊預設設定…', error: '無法驗證文章區塊設定，請再試。',
        dirty: '區塊預設設定未儲存', readOnly: '可以查看設定；編輯需要管理員權限。',
    },
};
export function getArticleSectionDefaultsCopy(language) { return COPY[language] || COPY.en; }
