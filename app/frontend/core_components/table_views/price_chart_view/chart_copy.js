// chart_copy.js
// Owns general chart language keys and bundled four-language fallbacks.
// Connects chart controls and registry labels to the existing translation handler.
// Keeps new copy usable without a rename migration or an installation dictionary.
const COPY = {
    view_chart: ['Kaavio', 'Chart', '图表', '圖表'],
    'ui.view.price_chart': ['Kaavionäkymä', 'Chart view', '图表视图', '圖表視圖'],
    chart_x_axis: ['X-akseli (aika)', 'X-axis (time)', 'X轴（时间）', 'X軸（時間）'],
    chart_y_axis: ['Y-akseli (luku)', 'Y-axis (numeric)', 'Y轴（数值）', 'Y軸（數值）'],
    chart_save_default: ['Tallenna oletusakselit', 'Save default axes', '保存默认坐标轴', '儲存預設坐標軸'],
    chart_default_saved: ['Oletusakselit tallennettu', 'Default axes saved', '默认坐标轴已保存', '預設坐標軸已儲存'],
    chart_default_failed: ['Oletusakseleita ei voitu tallentaa', 'Could not save default axes', '无法保存默认坐标轴', '無法儲存預設坐標軸'],
    chart_defaults_unavailable: ['Oletusakseleita ei voitu ladata. Käytössä ovat päätellyt akselit.', 'Could not load default axes. Using inferred axes.', '无法加载默认坐标轴。使用推断的坐标轴。', '無法載入預設坐標軸。使用推斷嘅坐標軸。'],
    chart_unavailable_title: ['Kaavio ei ole käytettävissä', 'Chart is unavailable', '图表不可用', '圖表不可用'],
    chart_unavailable_body: ['Kaavio tarvitsee vähintään yhden päivämäärä-, aika- tai aikaleimasarakkeen ja yhden numeerisen sarakkeen. Tekstisarakkeet eivät kelpaa aika-akseliksi. Valitse käytettävissä oleva näkymä.', 'Chart requires a date, time or timestamp column and a numeric column. Text columns cannot be time axes. Choose an available view.', '图表需要日期、时间或时间戳列及数值列。文本列不能用作时间轴。请选择可用视图。', '圖表需要日期、時間或時間戳欄及數值欄。文字欄不能用作時間軸。請揀可用視圖。'],
    chart_no_data_title: ['Kaaviodataa ei löytynyt', 'No chart data found', '未找到图表数据', '未搵到圖表資料'],
    chart_no_data_body: ['Riveillä täytyy olla kelvollinen aika- ja lukuarvo.', 'Rows need valid time and numeric values.', '行需要有效时间和数值。', '資料列需要有效時間及數值。'],
    chart_no_visible_data_title: ['Näkyvällä alueella ei ole dataa', 'No visible chart data', '当前范围没有图表数据', '目前範圍冇圖表資料'],
    chart_no_visible_data_body: ['Palauta aikaväli tai loitonna.', 'Reset the range or zoom out.', '重置范围或缩小。', '重設範圍或縮小。'],
    chart_zoom_in: ['Lähennä', 'Zoom in', '放大', '放大'],
    chart_zoom_out: ['Loitonna', 'Zoom out', '缩小', '縮小'],
    chart_reset: ['Palauta', 'Reset', '重置', '重設'],
    chart_wheel_help: ['Alt+vieritys muuttaa aikaväliä', 'Alt+scroll zooms the time range', 'Alt+滚动缩放时间范围', 'Alt+捲動縮放時間範圍'],
};
export const CHART_TRANSLATION_FALLBACKS = Object.fromEntries(Object.entries(COPY).map(([key, values]) => [
    key, Object.fromEntries(['fi', 'en', 'ch', 'yue'].map((language, index) => [language, values[index]])),
]));

export function chartFallback(key, language = 'en') {
    const lang = String(language).toLowerCase();
    const code = lang.startsWith('fi') ? 'fi' : /^(yue|zh-hk)/.test(lang) ? 'yue' : /^(ch|zh)/.test(lang) ? 'ch' : 'en';
    return CHART_TRANSLATION_FALLBACKS[key]?.[code] || '';
}
