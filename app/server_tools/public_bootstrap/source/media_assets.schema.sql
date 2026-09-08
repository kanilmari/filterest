-- media_assets.schema.sql
-- Includes reviewed public feature metadata in a fresh installation.
-- Mirrors the corresponding incremental migration without importing runtime data.
-- Keeps clean installs and upgraded databases on the same feature contract.

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
-- BEGIN exact media registry role policy.
REVOKE ALL ON public.system_media_assets, public.system_media_asset_usages FROM PUBLIC;
DO $$
DECLARE role_name TEXT;
BEGIN
 FOR role_name IN SELECT rolname FROM pg_roles
  WHERE rolname IN ('admin_user','basic_user','confidential_user','readonly_user','readeronly','guest_user') LOOP
  -- Default ACLs may have granted direct CRUD before this explicit table policy.
  EXECUTE format('REVOKE ALL ON public.system_media_assets, public.system_media_asset_usages FROM %I', role_name);
  EXECUTE format('GRANT SELECT ON public.system_media_assets, public.system_media_asset_usages TO %I', role_name);
  IF role_name IN ('admin_user','basic_user','confidential_user') THEN
   EXECUTE format('GRANT INSERT, DELETE ON public.system_media_assets, public.system_media_asset_usages TO %I', role_name);
  END IF;
 END LOOP;
END $$;
-- END exact media registry role policy.
