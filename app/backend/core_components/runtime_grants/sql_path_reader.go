// sql_path_reader.go
// Refuses unreviewed SQL code before deriving grants for SQL side effects.
// Uses exact reviewed source/catalogue body fingerprints and identifiers only.
// Never returns definitions; unknown bodies require review, never guessed grants.
package runtime_grants

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

// These invoker bodies come from the public bootstrap/migrations, runtime dataset
// timestamp builder, or the cited legacy Easelect catalogue. Changed bodies need
// fresh review; legacy additions below change only their own row's timestamps.
// SECURITY DEFINER paths remain subject to the audit's separate blocker pass.
var reviewedTriggerBodies = map[string]bool{
	"044a14f89b990b7028633526552b3b96": true, // public.protect_dev_agent_workline_report_history
	"06bcf30ac3d0a7f279a54cbf228a7bec": true, // Easelect db-7.0.21:3974, set_transaction_log_updated_at_timestamp; NEW.updated_at only.
	"0d84d8457df6fe58001e6cdbe8f803ff": true, // public.protect_dev_agent_release_goal_contracts
	"12c33d570d627277da6dbcbf75c15f94": true, // public.protect_dev_agent_handover_report_history
	"1a55728c1558ee7a641163442e85b778": true, // Easelect db-7.0.21:244, compact legacy timestamp body; NEW.updated only.
	"208bee89df640e17b668dd57770c7ab4": true, // public.set_dev_agent_worklines_updated_timestamp
	"28fc983f648f71b12afcfa1e472b318b": true, // public.app_owner_only_writes
	"2a7543d6368d1c702ece3cf81945a45b": true, // public.protect_row_owner_setting
	"3d8115c610a9f36994460b0fa2ea9452": true, // public.set_dev_agent_task_todos_timestamps
	"37c0cc2d0e0371408f4d1d00b21513a9": true, // Easelect db-7.0.21:4223, update_updated_column (20260323 bee_messages migration); NEW.updated only.
	"6e074e2bfb1447e098d87a6582f3fc8e": true, // public.protect_row_owner_setting
	"91571b19859da1a84444d75ceb9d8423": true, // public.protect_dev_agent_release_goal_lock
	"aa05ff614a5b400f35158a3386e154d3": true, // set_system_comments_updated_timestamp
	"b4a59323ba3f187f7568362d1677ddf0": true, // public.protect_dev_agent_release_goal_lock
	"b4df7df511a068397e6c82026386c5c8": true, // public.protect_dev_agent_workline_report_history
	"bd0a0b3593213d52cad42ba53ae32e5c": true, // runtime dataset timestamp
	"c7b9f9abddbfc58e3ea93767648b5819": true, // public.protect_row_creator
	"d4e282848e8376bc7e93ef8eebb04b6b": true, // public.protect_dev_agent_handover_report_history
	"f16592e7081f6c48fb819b9c68338d62": true, // public.validate_dev_agent_task_todo_parent
	"f41702490e4a6d4ed93da9aeeaaaaf3f": true, // public.protect_dev_agent_release_goal_contracts
}

type definerFunctionIdentity struct {
	Schema        string `json:"schema"`
	Name          string `json:"name"`
	ArgumentTypes string `json:"argument_types"`
	SearchPath    string `json:"search_path"` // Exact reviewed pg_proc.proconfig entry.
}

// A reviewed SECURITY DEFINER body is fixed by a product migration, reads only,
// and calls no function that could write. Identity and catalogue settings must
// also match; a changed body or identity requires a fresh review.
var reviewedDefinerBodies = map[string]definerFunctionIdentity{
	"8c5a769a59dfaa06a4c1ce947ff562b9": {
		Schema: "public", Name: "resolve_effective_row_access",
		ArgumentTypes: "text, bigint, bigint, text, boolean, boolean",
		SearchPath:    "search_path=pg_catalog, public",
	},
}

func reviewedDefinerBodiesJSON() []byte {
	encoded, _ := json.Marshal(reviewedDefinerBodies)
	return encoded
}

// Both audit passes bind the reviewed list as reviewed_definer_bodies. SQL
// STABLE/IMMUTABLE excludes direct modifying statements, not nested volatile
// calls. Pin the reviewed lookup path too, so unqualified calls cannot be shadowed.
const reviewedDefinerFunctionsSQL = `SELECT p.oid
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 JOIN reviewed_definer_bodies b ON b.body_md5=md5(p.prosrc)
 WHERE p.prosecdef AND n.nspname=b.identity->>'schema' AND p.proname=b.identity->>'name'
 AND oidvectortypes(p.proargtypes)=b.identity->>'argument_types'
 AND l.lanname='sql' AND p.provolatile IN ('s','i')
 AND (SELECT array_agg(setting) FROM unnest(p.proconfig) setting WHERE setting LIKE 'search_path=%')
     = ARRAY[b.identity->>'search_path']`

func readTriggerDependencies(ctx context.Context, tx *sql.Tx, snapshot *GrantSnapshot) (err error) {
	defer func() {
		if err != nil {
			err = metadataReaderError("readTriggerDependencies", err, snapshot.Roles)
		}
	}()
	return readRows(ctx, tx, `SELECT t.oid,t.tgrelid,md5(p.prosrc),p.prosecdef
  FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE NOT t.tgisinternal AND t.tgenabled <> 'D' AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')`, nil, func(rows *sql.Rows) error {
		var oid, source int64
		var digest string
		var definer bool
		if err := rows.Scan(&oid, &source, &digest, &definer); err != nil {
			return err
		}
		object, ok := snapshot.Objects[source]
		if !ok {
			snapshot.Blockers = append(snapshot.Blockers, Finding{Role: "policy", Kind: "trigger", ObjectOID: oid, Object: "pg_catalog.pg_trigger", Finding: "blocker", Reason: fmt.Sprintf("pg_trigger row OID %d: missing tgrelid=%d", oid, source)})
			return nil
		}
		if !definer && reviewedTriggerBodies[digest] {
			return nil
		}
		snapshot.Blockers = append(snapshot.Blockers, Finding{Role: "policy", Kind: "trigger", ObjectOID: oid, Object: object.Identifier(), Finding: "blocker", Reason: "unreviewed trigger SQL side effects"})
		return nil
	})
}

// The request-actor default reads transaction context only (WL58); compare its
// exact shipped body before treating a default function as side-effect-free.
const reviewedActorDefaultBody = "98854647c6ff3a72f2e7eabfbdf7b379"

func readDefaultFunctionDependencies(ctx context.Context, tx *sql.Tx, snapshot *GrantSnapshot) (err error) {
	defer func() {
		if err != nil {
			err = metadataReaderError("readDefaultFunctionDependencies", err, snapshot.Roles)
		}
	}()
	return readRows(ctx, tx, `SELECT a.oid,a.adrelid,att.attname,p.oid,n.nspname,p.proname,p.prosecdef,md5(p.prosrc)
 FROM pg_attrdef a JOIN pg_attribute att ON att.attrelid=a.adrelid AND att.attnum=a.adnum
 JOIN pg_depend d ON d.classid='pg_attrdef'::regclass AND d.objid=a.oid AND d.refclassid='pg_proc'::regclass
 JOIN pg_proc p ON p.oid=d.refobjid JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
 AND EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE c.oid=a.adrelid AND ns.nspname !~ '^pg_' AND ns.nspname<>'information_schema')
 AND NOT EXISTS(SELECT 1 FROM pg_depend extension WHERE extension.classid='pg_proc'::regclass AND extension.objid=p.oid AND extension.deptype='e')`, nil, func(rows *sql.Rows) error {
		var id, source, oid int64
		var column, schema, name, digest string
		var definer bool
		if err := rows.Scan(&id, &source, &column, &oid, &schema, &name, &definer, &digest); err != nil {
			return err
		}
		object, ok := snapshot.Objects[source]
		if !ok {
			snapshot.Blockers = append(snapshot.Blockers, Finding{Role: "policy", Kind: "column", ObjectOID: source, Object: "pg_catalog.pg_attrdef", Column: column, Finding: "blocker", Reason: fmt.Sprintf("pg_attrdef row OID %d: missing adrelid=%d", id, source)})
			return nil
		}
		if schema == "public" && name == "app_request_actor_id" && !definer && digest == reviewedActorDefaultBody {
			return nil
		}
		snapshot.Blockers = append(snapshot.Blockers, Finding{Role: "policy", Kind: "column", ObjectOID: source, Object: object.Identifier(), Column: column, Finding: "blocker", Reason: fmt.Sprintf("unreviewed default SQL function OID %d", oid)})
		return nil
	})
}
