-- 20260908000006_add_media_asset_registry.sql
-- Adds physical image identities and bounded per-row reuse records.
-- Between protected media storage and existing registered asset child relations.
-- Exists so detaching or deleting a parent never deletes another row's reused image.
-- VERSION_DB: 9.7.9

CREATE TABLE IF NOT EXISTS public.system_media_assets (
 id UUID PRIMARY KEY,
 relation_id BIGINT NOT NULL,
 parent_table_uid BIGINT NOT NULL,
 child_table_uid BIGINT NOT NULL,
 foreign_key_column TEXT NOT NULL,
 filename_column TEXT NOT NULL,
 source_row_id BIGINT NOT NULL CHECK (source_row_id>0),
 source_reference TEXT NOT NULL,
 filename TEXT NOT NULL CHECK (filename ~ '^image\.(png|jpg|jpeg|webp|gif)$'),
 original_sha256 CHAR(64) NOT NULL CHECK (original_sha256 ~ '^[0-9a-f]{64}$'),
 default_caption JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_by BIGINT NOT NULL,
 created TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(relation_id,source_row_id,source_reference,original_sha256)
);
CREATE TABLE IF NOT EXISTS public.system_media_asset_usages (
 asset_id UUID NOT NULL REFERENCES public.system_media_assets(id) ON DELETE RESTRICT,
 relation_id BIGINT NOT NULL,
 parent_row_id BIGINT NOT NULL CHECK(parent_row_id>0),
 child_row_id BIGINT NOT NULL CHECK(child_row_id>0),
 created TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(asset_id,relation_id,parent_row_id),
 UNIQUE(relation_id,child_row_id)
);
COMMENT ON TABLE public.system_media_assets IS
 'Physical images copied out of parent-owned folders; dedicated API only, no automatic garbage collection.';
COMMENT ON TABLE public.system_media_asset_usages IS
 'Bounded references to ordinary asset-child rows. Authorization rechecks each live row and current audience.';
REVOKE ALL ON public.system_media_assets,public.system_media_asset_usages FROM PUBLIC;
DO $$
DECLARE role_name TEXT;
BEGIN
 FOR role_name IN SELECT rolname FROM pg_roles
  WHERE rolname IN ('admin_user','basic_user','confidential_user','readonly_user','guest_user') LOOP
  EXECUTE format('GRANT SELECT ON public.system_media_assets,public.system_media_asset_usages TO %I',role_name);
  IF role_name IN ('admin_user','basic_user','confidential_user') THEN
   EXECUTE format('GRANT INSERT, DELETE ON public.system_media_assets,public.system_media_asset_usages TO %I',role_name);
  END IF;
 END LOOP;
END $$;

-- BEGIN media library language seed.
WITH authored_keys(lang_key, fi, en, creation_spec) AS (
    VALUES
    ('media_library_choose', 'Käytä olemassa olevaa kuvaa', 'Use an existing image', 'Existing-image reuse: choose.'),
    ('media_library_close', 'Sulje kuvalista', 'Close image list', 'Existing-image reuse: close.'),
    ('media_library_clear', 'Poista valinta', 'Clear selection', 'Existing-image reuse: clear.'),
    ('media_library_next', 'Lisää kuvia', 'More images', 'Existing-image reuse: next.'),
    ('media_library_loading', 'Ladataan kuvia…', 'Loading images…', 'Existing-image reuse: loading.'),
    ('media_library_scope', 'Valitse saman aineiston kuva. Kuva ja sen nykyiset kuvatekstit liitetään, kun tallennat rivin.', 'Choose an image from this dataset. Its current captions are copied when you save the row.', 'Existing-image reuse: scope.'),
    ('media_library_unavailable', 'Kuvaa ei voi käyttää uudelleen näillä oikeuksilla.', 'This image cannot be reused with these permissions.', 'Existing-image reuse: unavailable.'),
    ('media_library_empty', 'Uudelleenkäytettäviä kuvia ei löytynyt.', 'No reusable images were found.', 'Existing-image reuse: empty.'),
    ('media_library_selected', 'Valittu kuva', 'Selected image', 'Existing-image reuse: selected.')
)
INSERT INTO public.system_lang_keys (lang_key, fi, en, creation_spec)
SELECT lang_key, fi, en, creation_spec FROM authored_keys
ON CONFLICT (lang_key) DO UPDATE
SET fi = CASE WHEN NULLIF(btrim(system_lang_keys.fi), '') IS NULL THEN EXCLUDED.fi ELSE system_lang_keys.fi END,
    en = CASE WHEN NULLIF(btrim(system_lang_keys.en), '') IS NULL THEN EXCLUDED.en ELSE system_lang_keys.en END,
    creation_spec = CASE WHEN NULLIF(btrim(system_lang_keys.creation_spec), '') IS NULL THEN EXCLUDED.creation_spec ELSE system_lang_keys.creation_spec END,
    updated = now()
WHERE NULLIF(btrim(system_lang_keys.fi), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.en), '') IS NULL
   OR NULLIF(btrim(system_lang_keys.creation_spec), '') IS NULL;

INSERT INTO public.system_lang_key_translations
    (lang_key_id, language_code, translation, source_kind, review_status)
SELECT keys.id, copy.language_code, copy.translation, 'manual', 'approved'
FROM public.system_lang_keys keys
CROSS JOIN LATERAL (VALUES ('fi', keys.fi), ('en', keys.en)) AS copy(language_code, translation)
WHERE keys.lang_key IN ('media_library_choose', 'media_library_close', 'media_library_clear', 'media_library_next', 'media_library_loading', 'media_library_scope', 'media_library_unavailable', 'media_library_empty', 'media_library_selected')
ON CONFLICT (lang_key_id, language_code) DO UPDATE
SET translation = EXCLUDED.translation, source_kind = EXCLUDED.source_kind,
    review_status = EXCLUDED.review_status, updated = now()
WHERE NULLIF(btrim(system_lang_key_translations.translation), '') IS NULL;

INSERT INTO public.system_lang_key_sources
    (lang_key_id, source_type, source_high, source_low, usage_explanation, last_seen)
SELECT id, 'code', 'frontend/reusable_components/media_library_picker/media_library_picker.js',
       '', creation_spec, CURRENT_DATE
FROM public.system_lang_keys
WHERE lang_key IN ('media_library_choose', 'media_library_close', 'media_library_clear', 'media_library_next', 'media_library_loading', 'media_library_scope', 'media_library_unavailable', 'media_library_empty', 'media_library_selected')
ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE SET last_seen = CURRENT_DATE;
-- END media library language seed.

INSERT INTO public.system_db_version(version,description)
SELECT '9.7.9','Independent media assets with bounded same-dataset reuse'
WHERE NOT EXISTS(SELECT 1 FROM public.system_db_version WHERE version='9.7.9');
