-- 20260816000001_seed_calendar_view_lang_keys.sql
-- Ships the calendar-view controls as product-owned four-language UI copy.
-- VERSION_DB: 8.0.60

INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
VALUES
    (
        'calendar_month',
        'Kuukausi',
        'Month',
        '月',
        '月',
        'Calendar presentation mode: month.'
    ),
    (
        'calendar_week',
        'Viikko',
        'Week',
        '周',
        '週',
        'Calendar presentation mode: week.'
    ),
    (
        'calendar_day',
        'Päivä',
        'Day',
        '日',
        '日',
        'Calendar presentation mode: day.'
    ),
    (
        'calendar_agenda',
        'Agenda',
        'Agenda',
        '日程',
        '議程',
        'Calendar presentation mode: agenda.'
    ),
    (
        'calendar_today',
        'Tänään',
        'Today',
        '今天',
        '今日',
        'Calendar navigation action that returns to today.'
    ),
    (
        'calendar_no_events',
        'Ei tapahtumia',
        'No events',
        '没有事件',
        '冇活動',
        'Empty-state copy for a calendar date without events.'
    ),
    (
        'calendar_no_date_column',
        'Kalenterille sopivaa päivämääräkenttää ei löytynyt',
        'No calendar date column found',
        '未找到日历日期字段',
        '搵唔到日曆日期欄位',
        'Empty-state copy when a dataset has no calendar-compatible date column.'
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
SELECT id,
       'code',
       'frontend/core_components/table_views/calendar_view/calendar_view_printer.js',
       '',
       'Calendar presentation-mode, navigation, and empty-state copy.',
       CURRENT_DATE
FROM public.system_lang_keys
WHERE lang_key IN (
    'calendar_month',
    'calendar_week',
    'calendar_day',
    'calendar_agenda',
    'calendar_today',
    'calendar_no_events',
    'calendar_no_date_column'
)
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
SET source_low = EXCLUDED.source_low,
    usage_explanation = EXCLUDED.usage_explanation,
    last_seen = CURRENT_DATE;

INSERT INTO public.system_db_version (version, description)
SELECT '8.0.60',
       'Added canonical four-language view controls plus field-consented durable embedding refreshes.'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.system_db_version
    WHERE version = '8.0.60'
);
