-- 20261009000078_enforce_dataset_name_namespace.sql
-- Serializes dataset names and all active aliases in one global namespace.
-- Connects registry/alias persistence and the administrator naming endpoints.
-- Keeps real names on upgrade; conflicting aliases retain their rows and timestamps.
-- VERSION_DB: 9.11.0
-- VERSION_DB_OWNER: 20261009000099_record_database_release_9_11_0.sql
-- COMPLETION_MARKER: wl159_dataset_namespace

-- Only the small metadata tables are changed/locked, never dataset contents.
CREATE TABLE IF NOT EXISTS public.system_dataset_namespace_lock (
    id integer PRIMARY KEY CHECK (id = 1),
    revision bigint NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.system_dataset_namespace_lock IS
    'Internal serialization witness; not a dataset. Updating it rejects stale repeatable-read snapshots.';
REVOKE ALL ON public.system_dataset_namespace_lock FROM PUBLIC;
INSERT INTO public.system_dataset_namespace_lock (id)
SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM public.system_dataset_namespace_lock WHERE id = 1);

ALTER TABLE public.system_db_table_aliases
    ADD COLUMN IF NOT EXISTS disabled_reason text,
    ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
COMMENT ON COLUMN public.system_db_table_aliases.disabled_reason IS
    'Stable translated reason key from the namespace audit; NULL for an unaudited alias.';

-- Use the same ASCII case fold as dataset lookup. Non-ASCII legacy names are
-- left intact; newly authored identifiers and alias slugs are ASCII-only.
CREATE OR REPLACE FUNCTION public.app_dataset_name_key(value text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT translate(btrim(value), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')
$$;

CREATE OR REPLACE FUNCTION public.app_lock_dataset_namespace()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_catalog.pg_advisory_xact_lock(159, 284);
    -- An advisory lock alone cannot refresh a REPEATABLE READ snapshot. This
    -- write makes such a waiter fail with 40001 instead of accepting stale names.
    UPDATE public.system_dataset_namespace_lock SET revision = revision + 1 WHERE id = 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'dataset namespace lock is missing'; END IF;
END;
$$;

-- Acquire before reading/validating in a separate statement at application
-- boundaries. Statement triggers also protect writes which bypass those APIs.
CREATE OR REPLACE FUNCTION public.app_lock_dataset_namespace_statement()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM public.app_lock_dataset_namespace();
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.app_assert_dataset_namespace_available(segment text, owner_uid integer)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE name_key text := public.app_dataset_name_key(segment);
BEGIN
    IF name_key IS NULL OR name_key = '' THEN RETURN; END IF;
    IF name_key = ANY (ARRAY['admin','api','apps','datasets','frontend','health','login','storage'])
       OR EXISTS (SELECT 1 FROM public.system_db_tables t
                  WHERE public.app_dataset_name_key(t.table_name) = name_key
                    AND t.table_uid IS DISTINCT FROM owner_uid)
       OR EXISTS (SELECT 1 FROM public.system_db_table_aliases a
                  WHERE a.is_active IS TRUE AND public.app_dataset_name_key(a.alias_slug) = name_key
                    AND a.table_uid IS DISTINCT FROM owner_uid)
       OR EXISTS (SELECT 1 FROM public.system_db_tables t
                  WHERE public.app_dataset_name_key(t.table_name) = 'app_' || name_key
                    AND t.table_uid IS DISTINCT FROM owner_uid) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'dataset_namespace_conflict', DETAIL = segment;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.app_validate_dataset_name(dataset_name text, metadata_id integer)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE owner_uid integer; old_name text; name_key text := public.app_dataset_name_key(dataset_name);
BEGIN
    SELECT t.table_uid, t.table_name INTO owner_uid, old_name
    FROM public.system_db_tables t WHERE t.id = metadata_id;
    -- Preserve legacy schema-specific real names, including a no-op rename.
    IF old_name = dataset_name THEN RETURN; END IF;
    PERFORM public.app_assert_dataset_namespace_available(dataset_name, owner_uid);
    IF left(name_key, 4) = 'app_' AND length(name_key) > 4 THEN
        PERFORM public.app_assert_dataset_namespace_available(substr(name_key, 5), owner_uid);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.app_validate_dataset_alias(dataset_name text, alias_name text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE owner_uid integer;
BEGIN
    SELECT t.table_uid INTO STRICT owner_uid FROM public.system_db_tables t
    WHERE t.table_name = dataset_name AND COALESCE(NULLIF(t.schema_name, ''), 'public') = 'public';
    PERFORM public.app_assert_dataset_namespace_available(alias_name, owner_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.app_guard_dataset_name()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE name_key text := public.app_dataset_name_key(NEW.table_name);
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.table_uid IS DISTINCT FROM OLD.table_uid THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'dataset_namespace_invalid';
        END IF;
        IF NEW.table_name IS NOT DISTINCT FROM OLD.table_name THEN RETURN NEW; END IF;
    END IF;
    PERFORM public.app_assert_dataset_namespace_available(NEW.table_name, NEW.table_uid);
    IF left(name_key, 4) = 'app_' AND length(name_key) > 4 THEN
        PERFORM public.app_assert_dataset_namespace_available(substr(name_key, 5), NEW.table_uid);
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.app_guard_dataset_alias()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.is_active IS TRUE THEN
        IF NEW.alias_slug !~ '^[a-z0-9][a-z0-9_-]*$' OR EXISTS (
            SELECT 1 FROM public.system_db_tables t WHERE t.table_uid = NEW.table_uid
            AND public.app_dataset_name_key(t.table_name) = public.app_dataset_name_key(NEW.alias_slug)
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'dataset_namespace_invalid';
        END IF;
        PERFORM public.app_assert_dataset_namespace_available(NEW.alias_slug, NEW.table_uid);
        NEW.disabled_reason := NULL;
        NEW.disabled_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;

-- Audit before enabling guards. Replace the timestamp function on bootstrap
-- origins; legacy origins without its trigger retain their timestamp behaviour.
CREATE OR REPLACE FUNCTION public.set_system_db_table_aliases_updated_timestamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.disabled_reason IS DISTINCT FROM OLD.disabled_reason AND NEW.disabled_reason IS NOT NULL THEN
        NEW.updated := OLD.updated;
    ELSE
        NEW.updated := now();
    END IF;
    RETURN NEW;
END;
$$;

SELECT public.app_lock_dataset_namespace();
-- Replay removes only our guards, inside this transaction, while the lock and
-- metadata DDL locks exclude concurrent writers. Audit fields are never reset.
DROP TRIGGER IF EXISTS dataset_namespace_alias_guard ON public.system_db_table_aliases;
WITH conflicts AS (
    SELECT a.id, CASE
        WHEN EXISTS (SELECT 1 FROM public.system_db_tables t
            WHERE public.app_dataset_name_key(t.table_name) = public.app_dataset_name_key(a.alias_slug)
              AND t.table_uid <> a.table_uid) THEN 'dataset_namespace_real_name_conflict'
        WHEN EXISTS (SELECT 1 FROM public.system_db_tables t
            WHERE public.app_dataset_name_key(t.table_name) = 'app_' || public.app_dataset_name_key(a.alias_slug)
              AND t.table_uid <> a.table_uid) THEN 'dataset_namespace_automatic_conflict'
        WHEN EXISTS (SELECT 1 FROM public.system_db_table_aliases other
            WHERE other.id <> a.id AND other.is_active IS TRUE
              AND public.app_dataset_name_key(other.alias_slug) = public.app_dataset_name_key(a.alias_slug))
            THEN 'dataset_namespace_alias_conflict'
        ELSE 'dataset_namespace_invalid' END AS reason
    FROM public.system_db_table_aliases a WHERE a.is_active IS TRUE AND (
        a.alias_slug !~ '^[a-z0-9][a-z0-9_-]*$'
        OR public.app_dataset_name_key(a.alias_slug) = ANY (ARRAY['admin','api','apps','datasets','frontend','health','login','storage'])
        OR EXISTS (SELECT 1 FROM public.system_db_tables t
            WHERE public.app_dataset_name_key(t.table_name) = public.app_dataset_name_key(a.alias_slug))
        OR EXISTS (SELECT 1 FROM public.system_db_tables t
            WHERE public.app_dataset_name_key(t.table_name) = 'app_' || public.app_dataset_name_key(a.alias_slug)
              AND t.table_uid <> a.table_uid)
        OR EXISTS (SELECT 1 FROM public.system_db_table_aliases other
            WHERE other.id <> a.id AND other.is_active IS TRUE
              AND public.app_dataset_name_key(other.alias_slug) = public.app_dataset_name_key(a.alias_slug))
    )
)
UPDATE public.system_db_table_aliases a SET is_active = false, is_primary = false, disabled_reason = c.reason, disabled_at = now()
FROM conflicts c WHERE a.id = c.id;

-- Legacy installations used a standalone index; public bootstrap used a
-- constraint of the same name. Inactive audit rows must not prevent reuse.
ALTER TABLE public.system_db_table_aliases DROP CONSTRAINT IF EXISTS system_db_table_aliases_alias_slug_key;
DROP INDEX IF EXISTS public.system_db_table_aliases_alias_slug_key;
DROP INDEX IF EXISTS public.system_db_table_aliases_one_primary_per_table_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_db_table_aliases_active_name
    ON public.system_db_table_aliases (public.app_dataset_name_key(alias_slug)) WHERE is_active IS TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_db_table_aliases_one_primary_alias_per_table
    ON public.system_db_table_aliases (table_uid) WHERE is_primary IS TRUE AND is_active IS TRUE;

DROP TRIGGER IF EXISTS dataset_namespace_table_lock ON public.system_db_tables;
CREATE TRIGGER dataset_namespace_table_lock BEFORE INSERT OR UPDATE OR DELETE ON public.system_db_tables
FOR EACH STATEMENT EXECUTE FUNCTION public.app_lock_dataset_namespace_statement();
DROP TRIGGER IF EXISTS dataset_namespace_alias_lock ON public.system_db_table_aliases;
CREATE TRIGGER dataset_namespace_alias_lock BEFORE INSERT OR UPDATE OR DELETE ON public.system_db_table_aliases
FOR EACH STATEMENT EXECUTE FUNCTION public.app_lock_dataset_namespace_statement();
DROP TRIGGER IF EXISTS dataset_namespace_table_guard ON public.system_db_tables;
CREATE TRIGGER dataset_namespace_table_guard BEFORE INSERT OR UPDATE OF table_name, table_uid ON public.system_db_tables
FOR EACH ROW EXECUTE FUNCTION public.app_guard_dataset_name();
CREATE TRIGGER dataset_namespace_alias_guard BEFORE INSERT OR UPDATE ON public.system_db_table_aliases
FOR EACH ROW EXECUTE FUNCTION public.app_guard_dataset_alias();

INSERT INTO public.system_data_repair_records (migration, action, detail)
SELECT 'wl159_dataset_namespace', 'completed', jsonb_build_object(
    'file', '20261009000078_enforce_dataset_name_namespace.sql',
    'disabled_aliases', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'reason', disabled_reason)), '[]'::jsonb)
                        FROM public.system_db_table_aliases WHERE disabled_reason IS NOT NULL))
WHERE NOT EXISTS (SELECT 1 FROM public.system_data_repair_records
    WHERE migration = 'wl159_dataset_namespace' AND action = 'completed');

-- BOOTSTRAP_LANGUAGE_SEED
-- Schema above is imported before registry seeds. This copy follows the
-- language seeds; upgrades run the complete migration in one transaction.
WITH authored(lang_key,fi,en,ch,yue) AS (VALUES
 ('dataset_namespace_conflict', 'Nimi kuuluu jo toiselle aineistolle tai varatulle osoitteelle. Valitse toinen nimi.', 'This name already belongs to another dataset or a reserved route. Choose another name.', '此名称已属于其他数据集或保留网址。请选择其他名称。', '呢個名稱已屬於另一個資料集或保留網址。請揀另一個名稱。'),
 ('dataset_namespace_invalid', 'Valitse kelvollinen aineiston nimi tai alias.', 'Choose a valid dataset name or alias.', '请选择有效的数据集名称或别名。', '請揀有效嘅資料集名稱或別名。'),
 ('dataset_namespace_retry', 'Aineistojen nimet muuttuivat toiminnon aikana. Yritä uudelleen.', 'Dataset names changed during this operation. Please retry.', '操作期间数据集名称发生了变化。请重试。', '操作期間資料集名稱有變。請再試。'),
 ('dataset_namespace_real_name_conflict', 'Alias on poistettu käytöstä, koska nimi kuuluu varsinaiselle aineistolle. Aliastiedot on säilytetty.', 'This alias was disabled because a real dataset owns the name. The alias record was preserved.', '此别名因名称属于真实数据集而被停用。别名记录已保留。', '呢個別名因名稱屬於真實資料集而停用。別名記錄已保留。'),
 ('dataset_namespace_automatic_conflict', 'Alias on poistettu käytöstä, koska nimi kuuluu toisen aineiston automaattiselle aliakselle. Aliastiedot on säilytetty.', 'This alias was disabled because another dataset reserves the automatic name. The alias record was preserved.', '此别名因名称被另一数据集自动保留而被停用。记录已保留。', '呢個別名因名稱被另一資料集自動保留而停用。記錄已保留。'),
 ('dataset_namespace_alias_conflict', 'Alias on poistettu käytöstä, koska useampi aliastieto käyttää samaa nimeä. Aliastiedot on säilytetty.', 'This alias was disabled because several alias records use the same name. The records were preserved.', '此别名因多条别名记录使用同一名称而被停用。记录已保留。', '呢個別名因多條別名記錄用同一名稱而停用。記錄已保留。'),
 ('dataset_alias_saved', 'Aineiston alias tallennettu.', 'Dataset alias saved', '数据集别名已保存。', '資料集別名已儲存。'),
 ('dataset_alias_cleared', 'Aineiston alias poistettu.', 'Dataset alias cleared', '数据集别名已清除。', '資料集別名已清除。')
), written AS (
 INSERT INTO public.system_lang_keys AS existing(lang_key,fi,en,ch,yue,creation_spec)
 SELECT lang_key,fi,en,ch,yue,'Dataset namespace refusals and preserved collision-audit notices.' FROM authored
 ON CONFLICT(lang_key) DO UPDATE SET
 fi=COALESCE(NULLIF(existing.fi,''),EXCLUDED.fi),en=COALESCE(NULLIF(existing.en,''),EXCLUDED.en),
 ch=COALESCE(NULLIF(existing.ch,''),EXCLUDED.ch),yue=COALESCE(NULLIF(existing.yue,''),EXCLUDED.yue)
 RETURNING id,lang_key,fi,en,ch,yue
), served AS (
 SELECT * FROM written UNION ALL
 SELECT k.id,k.lang_key,k.fi,k.en,k.ch,k.yue FROM public.system_lang_keys k JOIN authored USING(lang_key)
 WHERE k.lang_key NOT IN(SELECT lang_key FROM written)
)
INSERT INTO public.system_lang_key_translations AS existing(lang_key_id,language_code,translation,source_kind,review_status)
SELECT s.id,c.language_code,c.translation,'manual','approved' FROM served s
CROSS JOIN LATERAL(VALUES('fi',s.fi),('en',s.en),('ch',s.ch),('yue',s.yue)) c(language_code,translation)
JOIN public.system_languages l ON l.language_code=c.language_code
ON CONFLICT(lang_key_id,language_code) DO UPDATE SET
 translation=COALESCE(NULLIF(existing.translation,''),EXCLUDED.translation);
