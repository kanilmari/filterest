-- legacy_trigger_bodies.sql
-- Exact legacy trigger bodies for offline checks and disposable PostgreSQL.
-- Comments outside dollar quotes identify reviewed origin without changing md5.
-- Contains no application data and is never loaded by runtime code.

-- Easelect schema_snapshots/db-7.0.21.sql:4223; 20260323_create_bee_messages uses this legacy helper.
CREATE FUNCTION public.update_updated_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

-- Easelect schema_snapshots/db-7.0.21.sql:244; compact legacy dataset timestamp function.
CREATE FUNCTION public.set_auth_user_group_memberships_updated_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$BEGIN NEW.updated = NOW(); RETURN NEW; END;$$;

-- Easelect schema_snapshots/db-7.0.21.sql:3974; legacy transaction-log timestamp function.
CREATE FUNCTION public.set_transaction_log_updated_at_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- Easelect migrations/20260225_create_app_service_locations.sql:83; writes the parent catalog.
CREATE FUNCTION public.tg_location_touch_parent() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Päivitetään vain parent-rivi (ei koko MV:tä!)
  UPDATE app_service_catalog
     SET updated = NOW()          -- laukaisee toisen triggerin
   WHERE id = NEW.service_id;
  RETURN NULL;
END;
$$;

-- Easelect migrations/20260301_add_fk_cache_invalidation_triggers.sql:78; writes cached_username.
CREATE FUNCTION public.fn_sync_cached_username() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Only fire if username actually changed
    IF OLD.username IS NOT DISTINCT FROM NEW.username THEN
        RETURN NULL;
    END IF;

    -- Propagate to app_service_catalog
    UPDATE app_service_catalog
       SET cached_username = NEW.username
     WHERE user_id = OLD.id;

    -- Future tables with cached_username can be added here.
    -- The admin tool can also register additional UPDATE statements
    -- by extending this function via ALTER/REPLACE.

    RETURN NULL;  -- AFTER trigger, return value ignored
END;
$$;

-- Easelect schema_snapshots/db-7.0.21.sql:4116; SECURITY DEFINER GRANT/REVOKE.
CREATE FUNCTION public.systemview_role_table_privileges_upd() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        EXECUTE format('GRANT %I ON %I.%I TO %I',
                       NEW.privilege,
                       NEW.table_schema,
                       NEW.table_name,
                       NEW.role_name);
        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        EXECUTE format('REVOKE %I ON %I.%I FROM %I',
                       OLD.privilege,
                       OLD.table_schema,
                       OLD.table_name,
                       OLD.role_name);
        RETURN OLD;

    ELSIF TG_OP = 'UPDATE' THEN
        -- ensin vanha pois, sitten uusi tilalle
        EXECUTE format('REVOKE %I ON %I.%I FROM %I',
                       OLD.privilege,
                       OLD.table_schema,
                       OLD.table_name,
                       OLD.role_name);

        EXECUTE format('GRANT %I ON %I.%I TO %I',
                       NEW.privilege,
                       NEW.table_schema,
                       NEW.table_name,
                       NEW.role_name);
        RETURN NEW;
    END IF;
END;
$$;

