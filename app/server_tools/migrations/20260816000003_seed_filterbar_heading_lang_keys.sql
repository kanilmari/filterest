-- 20260816000003_seed_filterbar_heading_lang_keys.sql
-- Ships the descriptive compact-filterbar section headings in four languages.
-- VERSION_DB: 8.0.60
-- VERSION_DB_OWNER: 20260816000001_seed_calendar_view_lang_keys.sql

INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
VALUES
    (
        'filterbar_filter_results',
        'Suodata tuloksia',
        'Filter results',
        '筛选结果',
        '篩選結果',
        'Compact filterbar heading for result-filter controls.'
    ),
    (
        'filterbar_view_content_as',
        'Näytä sisältö muodossa…',
        'View content as…',
        '内容显示方式…',
        '內容顯示方式…',
        'Compact filterbar heading for presentation-style controls.'
    ),
    (
        'filterbar_add_manage_content',
        'Lisää ja hallitse sisältöä',
        'Add & manage content',
        '添加和管理内容',
        '新增及管理內容',
        'Compact filterbar heading for content creation and management tools.'
    ),
    (
        'filterbar_select_visible_fields',
        'Valitse näkyvät kentät',
        'Select visible fields',
        '选择可见字段',
        '選擇顯示欄位',
        'Compact filterbar heading for visible-field and field-set controls.'
    )
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    ch = EXCLUDED.ch,
    yue = EXCLUDED.yue,
    creation_spec = EXCLUDED.creation_spec,
    updated = NOW();

INSERT INTO public.system_lang_key_sources (
    lang_key_id,
    source_type,
    source_high,
    source_low,
    usage_explanation,
    last_seen
)
SELECT key_row.id,
       'code',
       source_row.source_high,
       '',
       source_row.usage_explanation,
       CURRENT_DATE
FROM (
    VALUES
        (
            'filterbar_filter_results',
            'frontend/core_components/filterbar/filter_bar_builder.js',
            'Compact filterbar heading for result-filter controls.'
        ),
        (
            'filterbar_view_content_as',
            'frontend/core_components/filterbar/top_row_buttons/top_row_builder.js',
            'Compact filterbar heading for presentation-style controls.'
        ),
        (
            'filterbar_add_manage_content',
            'frontend/core_components/filterbar/top_row_buttons/top_row_builder.js',
            'Compact filterbar heading for content creation and management tools.'
        ),
        (
            'filterbar_select_visible_fields',
            'frontend/core_components/filterbar/filter_list/column_view_preset_builder.js',
            'Compact filterbar heading for visible-field and field-set controls.'
        )
) AS source_row(lang_key, source_high, usage_explanation)
JOIN public.system_lang_keys key_row ON key_row.lang_key = source_row.lang_key
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;
