-- schema_drift_export.sql
-- Export physical schema contracts and identifier-only dataset metadata read-only.
-- Connect the existing ./db JSON interface to the offline schema drift reporter.
-- Never read application row content or sequence counters; require no new privileges.
WITH
-- Pin deparser qualification locally; this changes session configuration only.
-- MATERIALIZED and the dependency below ensure definitions use one search path.
settings AS MATERIALIZED (
    SELECT pg_catalog.set_config('search_path', 'pg_catalog', true)
),
namespaces AS MATERIALIZED (
    SELECT n.* FROM pg_catalog.pg_namespace n CROSS JOIN settings
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_(toast|temp)'
),
members AS MATERIALIZED (
    SELECT d.classid, d.objid, e.extname AS extension
    FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_extension e ON e.oid = d.refobjid
    WHERE d.refclassid = 'pg_catalog.pg_extension'::regclass AND d.deptype = 'e'
),
relations AS MATERIALIZED (
    SELECT c.*, pg_catalog.format('%I.%I', n.nspname, c.relname) AS name, n.nspname,
           m.extension
    FROM pg_catalog.pg_class c JOIN namespaces n ON n.oid = c.relnamespace
    LEFT JOIN members m ON m.classid = 'pg_catalog.pg_class'::regclass AND m.objid = c.oid
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
),
procedures AS MATERIALIZED (
    SELECT p.*, pg_catalog.format('%I.%I(%s)', n.nspname, p.proname,
           pg_catalog.pg_get_function_identity_arguments(p.oid)) AS name, m.extension
    FROM pg_catalog.pg_proc p JOIN namespaces n ON n.oid = p.pronamespace
    LEFT JOIN members m ON m.classid = 'pg_catalog.pg_proc'::regclass AND m.objid = p.oid
    WHERE p.prokind IN ('f', 'p', 'w')
),
acl_sources AS (
    SELECT 'relation:' || c.oid AS key, COALESCE(c.relacl, pg_catalog.acldefault(
           CASE WHEN c.relkind = 'S' THEN 's'::"char" ELSE 'r'::"char" END, c.relowner)) AS acl
    FROM relations c
    UNION ALL
    SELECT 'column:' || a.attrelid || ':' || a.attnum, COALESCE(a.attacl, '{}'::aclitem[])
    FROM pg_catalog.pg_attribute a JOIN relations c ON c.oid = a.attrelid
    WHERE a.attnum > 0 AND NOT a.attisdropped
    UNION ALL
    SELECT 'function:' || p.oid, COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner)) FROM procedures p
    UNION ALL
    SELECT 'schema:' || n.oid, COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner)) FROM namespaces n
    UNION ALL
    SELECT 'default:' || d.oid, d.defaclacl FROM pg_catalog.pg_default_acl d
),
acls AS MATERIALIZED (
    SELECT a.key, COALESCE(jsonb_agg(jsonb_build_object(
        'grantee', CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END,
        'grantor', grantor.rolname, 'privilege', x.privilege_type, 'grantable', x.is_grantable)
        ORDER BY x.grantee, x.grantor, x.privilege_type) FILTER (WHERE x.grantee IS NOT NULL), '[]'::jsonb) AS privileges
    -- Empty column/default ACLs have no dimension. Pass NULL instead of that
    -- array; do not substitute default grants for an explicitly empty ACL.
    FROM acl_sources a LEFT JOIN LATERAL pg_catalog.aclexplode(
        CASE WHEN pg_catalog.cardinality(a.acl) > 0 THEN a.acl END) x ON true
    LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = x.grantee
    LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid = x.grantor
    GROUP BY a.key
),
function_attachments AS (
    SELECT t.tgfoid AS function_oid, t.tgrelid AS table_oid FROM pg_catalog.pg_trigger t WHERE NOT t.tgisinternal
    UNION
    SELECT d.refobjid, a.adrelid FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_attrdef a ON d.classid = 'pg_catalog.pg_attrdef'::regclass AND d.objid = a.oid
    WHERE d.refclassid = 'pg_catalog.pg_proc'::regclass
    UNION
    SELECT d.refobjid, c.conrelid FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_constraint c ON d.classid = 'pg_catalog.pg_constraint'::regclass AND d.objid = c.oid
    WHERE d.refclassid = 'pg_catalog.pg_proc'::regclass AND c.conrelid <> 0
),
table_facts AS (
    SELECT c.name, jsonb_build_object(
        'name', c.name, 'kind', c.relkind, 'owner', owner.rolname, 'extension', c.extension,
        'rls_enabled', c.relrowsecurity, 'rls_forced', c.relforcerowsecurity,
        'replica_identity', c.relreplident, 'privileges', acl.privileges,
        'definition', CASE WHEN c.relkind IN ('v', 'm') THEN pg_catalog.pg_get_viewdef(c.oid, false) END,
        'partition_key', CASE WHEN c.relkind = 'p' THEN pg_catalog.pg_get_partkeydef(c.oid) END,
        'partition_bound', pg_catalog.pg_get_expr(c.relpartbound, c.oid, false),
        'parents', COALESCE((SELECT jsonb_agg(pg_catalog.format('%I.%I', pn.nspname, pc.relname) ORDER BY i.inhseqno)
            FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class pc ON pc.oid = i.inhparent
            JOIN pg_catalog.pg_namespace pn ON pn.oid = pc.relnamespace WHERE i.inhrelid = c.oid), '[]'::jsonb),
        'columns', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'name', a.attname, 'position', a.attnum, 'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
            'not_null', a.attnotnull, 'identity', a.attidentity, 'generated', a.attgenerated,
            'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid, false), 'privileges', ca.privileges,
            'collation', CASE WHEN a.attcollation <> 0 THEN pg_catalog.format('%I.%I', cn.nspname, co.collname) END
        ) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a
            LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            LEFT JOIN pg_catalog.pg_collation co ON co.oid = a.attcollation
            LEFT JOIN pg_catalog.pg_namespace cn ON cn.oid = co.collnamespace
            JOIN acls ca ON ca.key = 'column:' || a.attrelid || ':' || a.attnum
            WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped), '[]'::jsonb),
        'constraints', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'name', k.conname, 'definition', pg_catalog.pg_get_constraintdef(k.oid, false),
            'validated', k.convalidated) ORDER BY k.conname)
            FROM pg_catalog.pg_constraint k WHERE k.conrelid = c.oid), '[]'::jsonb),
        'indexes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'name', pg_catalog.format('%I.%I', ni.nspname, ci.relname),
            'definition', pg_catalog.pg_get_indexdef(i.indexrelid), 'valid', i.indisvalid,
            'ready', i.indisready, 'clustered', i.indisclustered, 'replica_identity', i.indisreplident
        ) ORDER BY ci.relname) FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ci ON ci.oid = i.indexrelid
            JOIN pg_catalog.pg_namespace ni ON ni.oid = ci.relnamespace WHERE i.indrelid = c.oid), '[]'::jsonb),
        'triggers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'name', t.tgname, 'definition', pg_catalog.pg_get_triggerdef(t.oid, false),
            'enabled', t.tgenabled, 'function', pg_catalog.format('%I.%I(%s)', fn.nspname, fp.proname,
                pg_catalog.pg_get_function_identity_arguments(fp.oid))) ORDER BY t.tgname)
            FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc fp ON fp.oid = t.tgfoid
            JOIN pg_catalog.pg_namespace fn ON fn.oid = fp.pronamespace
            WHERE t.tgrelid = c.oid AND NOT t.tgisinternal), '[]'::jsonb),
        'policies', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'name', p.polname, 'command', p.polcmd, 'permissive', p.polpermissive,
            'roles', (SELECT jsonb_agg(CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE r.rolname END ORDER BY role_oid)
                      FROM unnest(p.polroles) role_oid LEFT JOIN pg_catalog.pg_roles r ON r.oid = role_oid),
            'using', pg_catalog.pg_get_expr(p.polqual, p.polrelid, false),
            'check', pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, false)) ORDER BY p.polname)
            FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid), '[]'::jsonb)
    ) AS facts
    FROM relations c JOIN pg_catalog.pg_roles owner ON owner.oid = c.relowner
    JOIN acls acl ON acl.key = 'relation:' || c.oid WHERE c.relkind <> 'S'
),
sequence_facts AS (
    SELECT c.name, jsonb_build_object(
        'name', c.name, 'owner', owner.rolname, 'extension', c.extension,
        'table', parent.name, 'column', a.attname, 'type', pg_catalog.format_type(s.seqtypid, NULL),
        'start', s.seqstart, 'increment', s.seqincrement, 'minimum', s.seqmin,
        'maximum', s.seqmax, 'cache', s.seqcache, 'cycle', s.seqcycle, 'privileges', acl.privileges
    ) AS facts
    FROM relations c JOIN pg_catalog.pg_sequence s ON s.seqrelid = c.oid
    JOIN pg_catalog.pg_roles owner ON owner.oid = c.relowner
    JOIN acls acl ON acl.key = 'relation:' || c.oid
    LEFT JOIN pg_catalog.pg_depend d ON d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid
        AND d.refclassid = 'pg_catalog.pg_class'::regclass AND d.deptype IN ('a', 'i') AND d.refobjsubid > 0
    LEFT JOIN relations parent ON parent.oid = d.refobjid
    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
),
function_facts AS (
    SELECT p.name, jsonb_build_object(
        'name', p.name, 'owner', owner.rolname, 'extension', p.extension,
        'definition', pg_catalog.pg_get_functiondef(p.oid), 'privileges', acl.privileges,
        'tables', COALESCE((SELECT jsonb_agg(DISTINCT c.name ORDER BY c.name)
            FROM function_attachments a JOIN relations c ON c.oid = a.table_oid
            WHERE a.function_oid = p.oid), '[]'::jsonb)
    ) AS facts FROM procedures p JOIN pg_catalog.pg_roles owner ON owner.oid = p.proowner
    JOIN acls acl ON acl.key = 'function:' || p.oid
),
dataset_ids AS (
    SELECT pg_catalog.format('%I.%I', COALESCE(NULLIF(d.schema_name, ''), 'public'), d.table_name) AS name,
           d.table_uid FROM public.system_db_tables d
)
SELECT jsonb_build_object(
    'format_version', 1, 'export_type', 'filterest_schema_catalogue',
    'captured_at', statement_timestamp(),
    'database', current_database(), 'server_version', current_setting('server_version_num'),
    'db_version', (SELECT version FROM public.system_db_version ORDER BY id DESC LIMIT 1),
    'tables', COALESCE((SELECT jsonb_agg(facts ORDER BY name) FROM table_facts), '[]'::jsonb),
    'sequences', COALESCE((SELECT jsonb_agg(facts ORDER BY name) FROM sequence_facts), '[]'::jsonb),
    'functions', COALESCE((SELECT jsonb_agg(facts ORDER BY name) FROM function_facts), '[]'::jsonb),
    'schemas', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', n.nspname, 'owner', r.rolname,
        'privileges', a.privileges) ORDER BY n.nspname) FROM namespaces n
        JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner JOIN acls a ON a.key = 'schema:' || n.oid), '[]'::jsonb),
    'default_privileges', COALESCE((SELECT jsonb_agg(jsonb_build_object('owner', r.rolname,
        'schema', COALESCE(n.nspname, '*'), 'kind', d.defaclobjtype, 'privileges', a.privileges)
        ORDER BY r.rolname, n.nspname, d.defaclobjtype) FROM pg_catalog.pg_default_acl d
        JOIN pg_catalog.pg_roles r ON r.oid = d.defaclrole
        LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
        JOIN acls a ON a.key = 'default:' || d.oid), '[]'::jsonb),
    'extensions', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', e.extname,
        'schema', n.nspname, 'version', e.extversion) ORDER BY e.extname)
        FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace), '[]'::jsonb),
    'extension_objects', COALESCE((SELECT jsonb_agg(jsonb_build_object('extension', m.extension,
        'type', i.type, 'identity', i.identity) ORDER BY m.extension, i.identity)
        FROM members m CROSS JOIN LATERAL pg_catalog.pg_identify_object(m.classid, m.objid, 0) i), '[]'::jsonb),
    -- Only identifiers and column ordering are exported: no labels, defaults,
    -- user ids, credentials, dataset content, or mutable metadata values.
    'metadata', jsonb_build_object(
        'datasets', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'table_uid', table_uid)
            ORDER BY name) FROM dataset_ids), '[]'::jsonb),
        'columns', COALESCE((SELECT jsonb_agg(jsonb_build_object('table_uid', table_uid,
            'column_name', column_name, 'co_number', co_number) ORDER BY table_uid, column_name)
            FROM public.system_column_details), '[]'::jsonb),
        'aliases', COALESCE((SELECT jsonb_agg(jsonb_build_object('table_uid', table_uid,
            'alias_slug', alias_slug) ORDER BY table_uid, alias_slug)
            FROM public.system_db_table_aliases), '[]'::jsonb),
        'relations_1_m', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'source_table_uid', source_table_uid, 'target_table_uid', target_table_uid,
            'source_column_name', source_column_name, 'target_column_name', target_column_name)
            ORDER BY source_table_uid, target_table_uid) FROM public.system_foreign_key_relations_1_m), '[]'::jsonb),
        'relations_m_m', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'table_a_uid', table_a_uid, 'table_b_uid', table_b_uid, 'bridging_table_uid', bridging_table_uid,
            'bridging_table_name', bridging_table_name, 'bridging_col_a', bridging_col_a, 'bridging_col_b', bridging_col_b)
            ORDER BY table_a_uid, table_b_uid) FROM public.system_foreign_key_relations_m_m), '[]'::jsonb)
    ),
    'ledger', COALESCE((SELECT jsonb_agg(jsonb_build_object('filename', m.filename,
        'content_sha256', to_jsonb(m)->>'content_sha256', 'outcome', to_jsonb(m)->>'outcome',
        'provenance', to_jsonb(m)->>'provenance') ORDER BY m.filename)
        FROM public.system_schema_migrations m), '[]'::jsonb)
) AS schema_catalogue
FROM settings;
