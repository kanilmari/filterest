-- 20261009000081_seed_runtime_grant_policy_wait_language_key.sql
-- Seeds the bounded policy-lock wait refusal in every bundled language.
-- Connects permission mutation refusals to legacy and normalized copy.
-- Preserves site-authored wording on upgrades and replay.
-- VERSION_DB: 9.11.0
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_11_0.sql

WITH authored(lang_key, fi, en, ch, yue, zh_tw, zh_hk) AS (VALUES
    ('error_runtime_grant_policy_busy',
     'Toista oikeusmuutosta tallennetaan vielä. Yritä hetken kuluttua uudelleen.',
     'Another permission change is still being saved. Try again in a moment.',
     '另一个权限更改仍在保存中。请稍后再试。',
     '另一項權限更改仲儲存緊。請稍後再試。',
     '另一項權限變更仍在儲存中。請稍後再試。',
     '另一項權限更改仍在儲存中。請稍後再試。')
), written AS (
    INSERT INTO public.system_lang_keys AS existing(lang_key, fi, en, ch, yue, creation_spec)
    SELECT lang_key, fi, en, ch, yue, 'Ticket 919 bounded permission-policy wait refusal.' FROM authored
    ON CONFLICT (lang_key) DO UPDATE SET
        -- Legacy columns win in the language reader. Fill their gaps from the
        -- same locale's normalized wording before considering shipped defaults.
        fi = CASE WHEN NULLIF(btrim(existing.fi), '') IS NULL THEN COALESCE((
            SELECT t.translation FROM public.system_lang_key_translations t
            WHERE t.lang_key_id = existing.id AND t.language_code = 'fi'
        ), EXCLUDED.fi) ELSE existing.fi END,
        en = CASE WHEN NULLIF(btrim(existing.en), '') IS NULL THEN COALESCE((
            SELECT t.translation FROM public.system_lang_key_translations t
            WHERE t.lang_key_id = existing.id AND t.language_code = 'en'
        ), EXCLUDED.en) ELSE existing.en END,
        ch = CASE WHEN NULLIF(btrim(existing.ch), '') IS NULL THEN COALESCE((
            SELECT t.translation FROM public.system_lang_key_translations t
            WHERE t.lang_key_id = existing.id AND t.language_code = 'ch'
        ), EXCLUDED.ch) ELSE existing.ch END,
        yue = CASE WHEN NULLIF(btrim(existing.yue), '') IS NULL THEN COALESCE((
            SELECT t.translation FROM public.system_lang_key_translations t
            WHERE t.lang_key_id = existing.id AND t.language_code = 'yue'
        ), EXCLUDED.yue) ELSE existing.yue END
    WHERE NULLIF(btrim(existing.fi), '') IS NULL OR NULLIF(btrim(existing.en), '') IS NULL
       OR NULLIF(btrim(existing.ch), '') IS NULL OR NULLIF(btrim(existing.yue), '') IS NULL
    RETURNING existing.id, existing.lang_key, existing.fi, existing.en, existing.ch, existing.yue
), served AS (
    SELECT * FROM written UNION ALL
    SELECT k.id, k.lang_key, k.fi, k.en, k.ch, k.yue FROM public.system_lang_keys k
    JOIN authored USING(lang_key) WHERE k.lang_key NOT IN (SELECT lang_key FROM written)
)
INSERT INTO public.system_lang_key_translations(lang_key_id, language_code, translation, source_kind, review_status)
SELECT s.id, c.language_code, c.translation, 'manual', c.review_status FROM served s
JOIN authored a USING(lang_key)
-- Chinese locales have their own copy; Cantonese remains the legacy yue copy.
-- Keep the catalogue's existing review policy without enabling new selectors.
CROSS JOIN LATERAL (VALUES
    ('fi', s.fi, 'approved'), ('en', s.en, 'approved'),
    ('zh-CN', s.ch, 'needs_review'), ('zh-TW', a.zh_tw, 'needs_review'), ('zh-HK', a.zh_hk, 'needs_review'),
    ('ch', s.ch, 'needs_review'), ('yue', s.yue, 'needs_review')
) c(language_code, translation, review_status)
JOIN public.system_languages l ON l.language_code=c.language_code
WHERE NULLIF(btrim(c.translation), '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.system_lang_key_translations t
    WHERE t.lang_key_id=s.id AND t.language_code=c.language_code
);
