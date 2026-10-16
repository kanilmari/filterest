// maintenance_action_copy.js
// Owns translated embedding-action and source-scan status copy.
// Connects administrator maintenance controls to the shared fallback dictionary.
// Keeps new security feedback readable without a database migration.
export const MAINTENANCE_ACTION_TRANSLATION_FALLBACKS = Object.freeze({
    embedding_create_action: { fi: 'Luo upotukset', en: 'Create embeddings', ch: '创建嵌入', yue: '建立嵌入' },
    embedding_stream_progress: { fi: 'Edistyminen: $count', en: 'Progress: $count', ch: '进度：$count', yue: '進度：$count' },
    embedding_stream_error: { fi: 'Virhe: $count', en: 'Error: $count', ch: '错误：$count', yue: '錯誤：$count' },
    embedding_stream_done: { fi: 'Valmis: $count', en: 'Done: $count', ch: '完成：$count', yue: '完成：$count' },
    embedding_stream_interrupted: {
        fi: 'Upotusten käsittely keskeytyi. Tarkista tila ennen uutta yritystä.',
        en: 'Embedding processing was interrupted. Check its status before trying again.',
        ch: '嵌入处理已中断。重试前请检查状态。', yue: '嵌入處理中斷咗。再試之前請檢查狀態。',
    },
    consistency_source_scan_stale: {
        fi: 'Orpoavainten lähdetiedot ovat vanhentuneet. Päivitä ne kieliavainten ylläpitoskannauksella.',
        en: 'Orphan source evidence is stale. Refresh it with the language-key maintenance scan.',
        ch: '孤立键的来源信息已过期。请运行语言键维护扫描更新。', yue: '孤立鍵嘅來源資料已過期。請執行語言鍵維護掃描更新。',
    },
    consistency_source_scan_fresh: {
        fi: 'Orpoavainten lähdetiedot ovat ajantasaiset.', en: 'Orphan source evidence is current.',
        ch: '孤立键的来源信息是最新的。', yue: '孤立鍵嘅來源資料係最新嘅。',
    },
    consistency_source_scan_unknown: {
        fi: 'Ylläpitoskannauksen aikaa ei tunneta tämän palvelinkäynnistyksen jälkeen.',
        en: 'No maintenance scan time is known since this server started.',
        ch: '本次服务器启动后尚无维护扫描时间。', yue: '今次伺服器啟動後未有維護掃描時間。',
    },
    consistency_source_scan_at: {
        fi: 'Viimeisin onnistunut ylläpitoskannaus: $count', en: 'Last successful maintenance scan: $count',
        ch: '上次成功的维护扫描：$count', yue: '上次成功嘅維護掃描：$count',
    },
});
