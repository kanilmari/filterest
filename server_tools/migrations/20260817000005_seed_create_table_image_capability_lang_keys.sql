-- 20260817000005_seed_create_table_image_capability_lang_keys.sql
-- Adds explicit copy for the image capability offered during table creation.
-- VERSION_DB: 9.0.0
-- VERSION_DB_OWNER: 20260817000007_repair_filterest_admin_schema_permissions.sql

INSERT INTO public.system_lang_keys (lang_key, fi, en, ch, yue, creation_spec)
VALUES
    (
        'create_table_enable_images',
        'Ota kuvien lataus käyttöön tälle taululle',
        'Enable image uploads for this table',
        '为此表启用图片上传',
        '為此資料表啟用圖片上載',
        'Checkbox shown while an administrator creates a table. When selected, Filterest enables the standard image asset relation after the table has been created.'
    ),
    (
        'table_created_image_setup_failed',
        'Taulu luotiin, mutta kuvien latausta ei voitu ottaa käyttöön. Voit yrittää uudelleen Medialinkitykset-näkymässä.',
        'The table was created, but image uploads could not be enabled. You can retry from Asset linking.',
        '表已创建，但无法启用图片上传。您可以在资源关联中重试。',
        '資料表已建立，但無法啟用圖片上載。你可以喺資產連結再試。',
        'Warning shown after table creation succeeds but the separate image asset capability setup fails.'
    )
ON CONFLICT (lang_key) DO UPDATE
SET fi = EXCLUDED.fi,
    en = EXCLUDED.en,
    ch = EXCLUDED.ch,
    yue = EXCLUDED.yue,
    creation_spec = EXCLUDED.creation_spec,
    updated = now();

WITH authored_translations AS (
    SELECT keys.id AS lang_key_id,
           values.language_code,
           values.translation,
           values.review_status
    FROM public.system_lang_keys AS keys
    CROSS JOIN LATERAL (
        VALUES
            ('en'::TEXT, keys.en, 'approved'::TEXT),
            ('fi'::TEXT, keys.fi, 'approved'::TEXT),
            ('zh-CN'::TEXT, keys.ch, 'needs_review'::TEXT)
    ) AS values(language_code, translation, review_status)
    WHERE keys.lang_key IN (
        'create_table_enable_images',
        'table_created_image_setup_failed'
    )
)
INSERT INTO public.system_lang_key_translations (
    lang_key_id,
    language_code,
    translation,
    source_kind,
    review_status
)
SELECT
    authored.lang_key_id,
    authored.language_code,
    authored.translation,
    'manual',
    authored.review_status
FROM authored_translations AS authored
WHERE NULLIF(btrim(authored.translation), '') IS NOT NULL
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation,
    source_kind = EXCLUDED.source_kind,
    review_status = EXCLUDED.review_status,
    updated = now();
