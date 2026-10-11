// kind_schema_reader.go
// Reads dataset-scoped MVCC-consistent evidence without application rows.
// Connects requested identities and related contracts to PostgreSQL catalogues.
// Live types, keys and triggers prove support without installation-wide work.
package dataset_kinds

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/lib/pq"
)

type schemaQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

// to_jsonb keeps a pre-migration registry readable. Only new kind metadata has
// compatibility defaults; declared version-one intent is never downgraded.
const schemaSnapshotQuery = `
WITH registrations AS (
 SELECT table_uid, COALESCE(NULLIF(schema_name,''),'public') AS schema_name, table_name,
        COALESCE(to_jsonb(t)->>'table_kind','ordinary') AS table_kind,
        COALESCE((to_jsonb(t)->>'kind_version')::integer,0) AS kind_version,
        COALESCE(to_jsonb(t)->'kind_config','{}'::jsonb) AS kind_config,
        COALESCE(multi_lang_embeddings,false) AS multi_lang_embeddings
 FROM public.system_db_tables t WHERE table_uid IS NOT NULL AND table_name IS NOT NULL
 AND (table_uid = ANY($1::bigint[])
   OR (table_name = ANY($2::text[]) AND (schema_name = $3
     OR ($3 = 'public' AND (schema_name IS NULL OR schema_name = '')))))
), hosts AS (
 SELECT to_regclass(format('%I.%I',schema_name,table_name))::oid AS oid FROM registrations
 UNION
 -- Explicit children remain dependencies even after their FK disappears.
 -- Cast only bounded integer text so malformed configuration is classified
 -- rather than failing the evidence query; table_uid lookup remains indexed.
 SELECT to_regclass(format('%I.%I',COALESCE(NULLIF(t.schema_name,''),'public'),t.table_name))::oid
 FROM registrations r CROSS JOIN LATERAL
   (VALUES(r.kind_config#>>'{embeddings,table_uid}'),(r.kind_config#>>'{locations,table_uid}')) child(uid)
 JOIN public.system_db_tables t ON t.table_uid=CASE WHEN child.uid ~ '^-?[0-9]{1,10}$' THEN child.uid::bigint END
), dependencies AS (
 SELECT oid FROM hosts
 UNION
 -- pg_depend's referenced-object index avoids scanning every foreign key.
 SELECT k.conrelid FROM hosts h JOIN pg_catalog.pg_depend d
   ON d.refclassid='pg_class'::regclass AND d.refobjid=h.oid AND d.classid='pg_constraint'::regclass
 JOIN pg_catalog.pg_constraint k ON k.oid=d.objid AND k.contype='f' AND k.confrelid=h.oid
 UNION
 SELECT k.confrelid FROM hosts h JOIN pg_catalog.pg_constraint k ON k.conrelid=h.oid AND k.contype='f'
), relation_oids AS (
 SELECT oid FROM dependencies
 UNION
 SELECT k.confrelid FROM dependencies d JOIN pg_catalog.pg_constraint k ON k.conrelid=d.oid AND k.contype='f'
), relations AS (
 SELECT c.oid, n.nspname AS schema_name, c.relname AS table_name, n.nspname||'.'||c.relname AS name
 FROM relation_oids r JOIN pg_catalog.pg_class c ON c.oid=r.oid
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p','v','m')
), evidence_registrations AS (
 SELECT * FROM registrations
 UNION
 SELECT t.table_uid, COALESCE(NULLIF(t.schema_name,''),'public'), t.table_name,
   COALESCE(to_jsonb(t)->>'table_kind','ordinary'),
   COALESCE((to_jsonb(t)->>'kind_version')::integer,0),
   COALESCE(to_jsonb(t)->'kind_config','{}'::jsonb), COALESCE(t.multi_lang_embeddings,false)
 FROM relations r JOIN public.system_db_tables t
   ON t.table_name=r.table_name AND (t.schema_name=r.schema_name
     OR (r.schema_name='public' AND (t.schema_name IS NULL OR t.schema_name='')))
 WHERE t.table_uid IS NOT NULL
), shapes AS (
 SELECT r.name,
 COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'name',a.attname,'type',t.typname,'sql_type',pg_catalog.format_type(a.atttypid,a.atttypmod),
   'not_null',a.attnotnull,'identity',a.attidentity,
   'default',COALESCE(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'')) ORDER BY a.attnum)
   FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type t ON t.oid=a.atttypid
   LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb) AS columns,
 COALESCE((SELECT to_jsonb(ARRAY(SELECT a.attname FROM unnest(k.conkey) WITH ORDINALITY u(num,ord)
   JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid AND a.attnum=u.num ORDER BY u.ord))
   FROM pg_catalog.pg_constraint k WHERE k.conrelid=r.oid AND k.contype='p'),'[]'::jsonb) AS primary_key,
 COALESCE((SELECT jsonb_agg(to_jsonb(ARRAY(SELECT a.attname FROM unnest(i.indkey::smallint[]) WITH ORDINALITY u(num,ord)
   JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid AND a.attnum=u.num WHERE u.ord<=i.indnkeyatts ORDER BY u.ord)) ORDER BY i.indexrelid)
   FROM pg_catalog.pg_index i WHERE i.indrelid=r.oid AND i.indisunique AND i.indisvalid AND i.indisready
     AND i.indpred IS NULL AND i.indexprs IS NULL),'[]'::jsonb) AS unique_keys,
 COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'columns',ARRAY(SELECT a.attname FROM unnest(k.conkey) WITH ORDINALITY u(num,ord)
     JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid AND a.attnum=u.num ORDER BY u.ord),
   'target',n.nspname||'.'||c.relname,
   'target_columns',ARRAY(SELECT a.attname FROM unnest(k.confkey) WITH ORDINALITY u(num,ord)
     JOIN pg_catalog.pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=u.num ORDER BY u.ord),
   'on_delete',k.confdeltype) ORDER BY k.oid)
   FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.confrelid
   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE k.conrelid=r.oid AND k.contype='f' AND k.convalidated),'[]'::jsonb) AS foreign_keys,
 COALESCE((SELECT jsonb_agg(pg_catalog.pg_get_functiondef(t.tgfoid) ORDER BY t.oid)
   FROM pg_catalog.pg_trigger t WHERE t.tgrelid=r.oid AND NOT t.tgisinternal
     AND t.tgenabled IN ('O','A') AND (t.tgtype::integer & 19)=19 AND t.tgqual IS NULL
     AND cardinality(t.tgattr::smallint[])=0),'[]'::jsonb) AS update_triggers
 FROM relations r
)
SELECT jsonb_build_object(
 'registrations',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'table_uid',table_uid,'name',schema_name||'.'||table_name,'table_kind',table_kind,
   'kind_version',kind_version,'kind_config',kind_config,'multi_lang_embeddings',multi_lang_embeddings) ORDER BY table_uid)
   FROM evidence_registrations),'[]'::jsonb),
 'shapes',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY name) FROM shapes s),'[]'::jsonb))`

// ReadSnapshot reads only requested UIDs and their structural dependencies.
// Evidence follows the schema metadata TTL and after-commit invalidation;
// an empty request reads no catalogue evidence. Returned slices belong to callers.
func ReadSnapshot(ctx context.Context, q schemaQuerier, uids ...int64) (Snapshot, error) {
	if len(uids) == 0 {
		return Snapshot{}, nil
	}
	return evidenceCache.readUIDs(ctx, q, uids)
}

func readSnapshot(ctx context.Context, q schemaQuerier, uids []int64, names []string, schema string) (Snapshot, error) {
	var raw []byte
	// Contract (11 October 2026): cache scoped evidence and its fingerprint for
	// five minutes, like dtt_1_row_read's schema metadata. Application changes
	// clear both through InvalidateSchemaCache/InvalidateAll after commit, never
	// rollback; external DDL appears within the same TTL as column metadata.
	// Cold related datasets share one deduplicated snapshot query per request.
	if err := q.QueryRowContext(ctx, schemaSnapshotQuery, pq.Array(uids), pq.Array(names), schema).Scan(&raw); err != nil {
		return Snapshot{}, fmt.Errorf("read dataset kind evidence: %w", err)
	}
	var snapshot Snapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return Snapshot{}, fmt.Errorf("decode dataset kind evidence: %w", err)
	}
	return snapshot, nil
}

func ReadForName(ctx context.Context, q schemaQuerier, name string) (Capabilities, error) {
	schema, table := "public", name
	if before, after, qualified := strings.Cut(name, "."); qualified {
		schema, table = before, after
	}
	snapshot, err := evidenceCache.readName(ctx, q, schema, table)
	if err != nil {
		return Capabilities{}, err
	}
	for _, reg := range snapshot.Registrations {
		if reg.Name == schema+"."+table {
			return ResolveCached(snapshot, reg.UID), nil
		}
	}
	return Capabilities{Kind: Ordinary, Issues: []string{"unregistered"}, Views: append([]string{}, catalogue[Ordinary][0].Views...)}, nil
}

// ResolveCached shares dataset-local memoization across ordinary and related reads.
// Reader snapshots resolve their immutable stored evidence and fingerprint;
// use Resolve for deliberately edited evidence. Public slices remain caller-owned.
// Authorization belongs to the caller; the cache never grants access.
func ResolveCached(snapshot Snapshot, uid int64) Capabilities {
	if entry := snapshot.cachedEvidence[uid]; entry != nil {
		return capabilityCache.resolveFingerprinted(entry.snapshot, uid, entry.fingerprint)
	}
	return capabilityCache.Resolve(snapshot, uid)
}
