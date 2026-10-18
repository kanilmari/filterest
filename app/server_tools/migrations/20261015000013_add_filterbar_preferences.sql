-- 20261015000013_add_filterbar_preferences.sql
-- Extends the existing account visual preferences and seeds explained filter bar choices.
-- Connects safe shared UI configuration to one account-wide personal order.
-- Preserves site orders, theme choices and all legacy visibility keys.
-- VERSION_DB: 9.12.0
-- VERSION_DB_OWNER: 20261015000099_record_database_release_9_12_0.sql
-- COMPLETION_MARKER: wl77_filterbar_preferences

SET LOCAL lock_timeout = '3s';
ALTER TABLE public.system_user_visual_preferences
    ADD COLUMN IF NOT EXISTS filterbar_order_mode text NOT NULL DEFAULT 'shared',
    ADD COLUMN IF NOT EXISTS filterbar_section_order jsonb,
    ADD COLUMN IF NOT EXISTS filterbar_visibility_memory text NOT NULL DEFAULT 'shared';
DO $constraints$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_user_filterbar_choices'
        AND conrelid='public.system_user_visual_preferences'::regclass) THEN
        ALTER TABLE public.system_user_visual_preferences ADD CONSTRAINT ck_user_filterbar_choices CHECK (
            filterbar_order_mode IN ('shared', 'own') AND filterbar_visibility_memory IN ('shared', 'dataset')
            AND (filterbar_section_order IS NULL OR filterbar_section_order = 'null'::jsonb
                OR jsonb_typeof(filterbar_section_order) = 'array'));
    END IF;
END $constraints$;
COMMENT ON COLUMN public.system_user_visual_preferences.filterbar_section_order IS
    'One explicit personal order across the site, never scoped to a dataset. Shared order stays in system_config.';

INSERT INTO public.system_data_repair_records (migration, action, detail)
SELECT 'wl77_filterbar_preferences', 'completed', '{"file":"20261015000013_add_filterbar_preferences.sql"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records WHERE migration='wl77_filterbar_preferences' AND action='completed');

-- BOOTSTRAP_LANGUAGE_SEED
-- Registry metadata is seeded after the account table exists in fresh installs.
INSERT INTO public.system_column_details (table_uid, column_name, data_type, co_number, editable_in_ui)
SELECT registry.table_uid, cols.column_name, cols.data_type, cols.ordinal_position, false
FROM public.system_db_tables registry JOIN information_schema.columns cols
    ON cols.table_name=registry.table_name AND cols.table_schema='public'
WHERE registry.table_name='system_user_visual_preferences'
    AND COALESCE(NULLIF(registry.schema_name,''),'public')='public'
    AND cols.column_name IN ('filterbar_order_mode','filterbar_section_order','filterbar_visibility_memory')
    AND NOT EXISTS (SELECT 1 FROM public.system_column_details existing
        WHERE existing.table_uid=registry.table_uid AND existing.column_name=cols.column_name);

INSERT INTO public.system_config (key, value_type, json_value, creation_spec)
SELECT 'filterbar_section_layout', 5, '{"section_order":[],"section_collapsed":{},"allow_own_order":false}'::jsonb,
    'Shared filter bar order and policy. Edit through the filter bar settings controls.'
WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key='filterbar_section_layout');

WITH authored_keys(lang_key, fi, en) AS (VALUES
    ('filterbar_preferences', 'Suodatinpalkin asetukset', 'Filter bar settings'),
    ('filterbar_order_title', 'Osioiden järjestys', 'Section order'),
    ('filterbar_order_shared', 'Yhteinen järjestys', 'Shared order'),
    ('filterbar_order_own', 'Oma järjestys', 'Own order'),
    ('filterbar_order_help', 'Yhteinen järjestys näkyy kaikille. Oma järjestys koskee kaikkia aineistojasi tällä sivustolla. Yhteinen järjestys kopioidaan vain, kun valitset oman järjestyksen. Tavallisen käyttäjän oma järjestys edellyttää sivuston lupaa.', 'Everyone sees the shared order. Your own order applies to all your datasets on this site. The shared order is copied only when you choose your own order. An ordinary user''s own order requires the site''s permission.'),
    ('filterbar_own_allow', 'Salli tavallisten käyttäjien oma järjestys', 'Allow ordinary users to use their own order'),
    ('filterbar_own_allow_help', 'Ylläpitäjät voivat aina käyttää omaa järjestystä. Yhteistä järjestystä muuttaa vain ylläpitäjä tai erikseen oikeutettu käyttäjä.', 'Administrators can always use their own order. Only administrators or explicitly authorized users can change the shared order.'),
    ('filterbar_visibility_title', 'Näkyvyyden muisti', 'Visibility memory'),
    ('filterbar_visibility_shared', 'Yhteinen kaikille aineistoille', 'Shared for all datasets'),
    ('filterbar_visibility_dataset', 'Muista aineistoittain', 'Remember per dataset'),
    ('filterbar_visibility_help', 'Yhteinen muisti alkaa käytössä olevasta palkista ja säilyttää näkyvyyden aineistoa vaihdettaessa. Aineistokohtainen muisti palauttaa aineiston valinnan yhdellä siirtymällä. Ilman muistia käytetään nykytilaa tai ensimmäisellä käynnillä aineiston oletusta.', 'Shared memory starts from the bar in use and keeps its visibility when you change datasets. Per-dataset memory restores that dataset’s choice in one transition. Without memory, the current state is kept, or the dataset default on a first visit.'),
    ('filterbar_move_up', 'Siirrä ylemmäs', 'Move up'),
    ('filterbar_move_down', 'Siirrä alemmas', 'Move down')
), resolved AS (
    SELECT copy.lang_key,
        COALESCE(CASE WHEN NULLIF(btrim(keys.fi), '') IS NOT NULL THEN keys.fi END,
            CASE WHEN NULLIF(btrim(fi.translation), '') IS NOT NULL THEN fi.translation END, copy.fi) AS fi,
        COALESCE(CASE WHEN NULLIF(btrim(keys.en), '') IS NOT NULL THEN keys.en END,
            CASE WHEN NULLIF(btrim(en.translation), '') IS NOT NULL THEN en.translation END, copy.en) AS en
    FROM authored_keys copy
    LEFT JOIN public.system_lang_keys keys USING (lang_key)
    LEFT JOIN public.system_lang_key_translations fi ON fi.lang_key_id = keys.id AND fi.language_code = 'fi'
    LEFT JOIN public.system_lang_key_translations en ON en.lang_key_id = keys.id AND en.language_code = 'en'
), written AS (
    INSERT INTO public.system_lang_keys AS existing (lang_key, fi, en, creation_spec)
    SELECT lang_key, fi, en, 'WO77 shared and personal filter bar choices; Finnish and English.' FROM resolved
    ON CONFLICT (lang_key) DO UPDATE
    SET fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN EXCLUDED.fi ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN EXCLUDED.en ELSE existing.en END
    WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
    RETURNING id, lang_key, fi, en
), served AS (
    SELECT * FROM written UNION ALL
    SELECT k.id, k.lang_key, k.fi, k.en FROM public.system_lang_keys k JOIN authored_keys USING (lang_key)
    WHERE k.id NOT IN (SELECT id FROM written)
)
INSERT INTO public.system_lang_key_translations AS existing
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT s.id, translated.language_code, translated.translation, 'manual', 'approved'
FROM served s
CROSS JOIN LATERAL (VALUES ('fi', s.fi), ('en', s.en)) AS translated(language_code, translation)
JOIN public.system_languages language ON language.language_code = translated.language_code
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation, source_kind = EXCLUDED.source_kind, review_status = EXCLUDED.review_status
WHERE NULLIF(btrim(existing.translation), '') IS NULL;

INSERT INTO public.system_lang_key_sources
    (lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen)
SELECT id, 'code', 'frontend/core_components/filterbar/filterbar_preferences_controls.js',
    '', 'Filter bar order and visibility choices.', CURRENT_DATE
FROM public.system_lang_keys WHERE lang_key IN ('filterbar_preferences', 'filterbar_order_title', 'filterbar_order_shared', 'filterbar_order_own', 'filterbar_order_help', 'filterbar_own_allow', 'filterbar_own_allow_help', 'filterbar_visibility_title', 'filterbar_visibility_shared', 'filterbar_visibility_dataset', 'filterbar_visibility_help', 'filterbar_move_up', 'filterbar_move_down')
ON CONFLICT (lang_key_id, source_type, source_high) DO NOTHING;
