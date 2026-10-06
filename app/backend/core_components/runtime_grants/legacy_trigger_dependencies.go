// legacy_trigger_dependencies.go
// Records reviewed private legacy trigger identities and their operation requirements.
// Connects exact existing fixture fingerprints to the shared dependency policy.
// Private SQL bodies stay out of runtime code and public bootstrap sources.
package runtime_grants

import (
	"context"
	"database/sql"
	"github.com/lib/pq"
)

type legacyTriggerIdentity struct {
	name, table string
	definer     bool
}

// These bodies match the pinned testdata bytes and the defining private
// migrations (20260225, 20260301) / db-9.7.13 snapshot, reviewed 2026-10-06.
// The parent's timestamp body is already reviewed (bd0a0b...). Its search-vector
// helper is also reviewed recursively, but contributes reads only if attached.
var reviewedLegacyTriggers = map[string]legacyTriggerIdentity{
	"3dca2b659502c2291c1a908db58f9b38": {"tg_location_touch_parent", "app_service_locations", false},
	"82e78c911a285ee6eb9d81ee00a96206": {"fn_sync_cached_username", "system_users", false},
	"9a87d4938809ea845f63e034ddffc75a": {"systemview_role_table_privileges_upd", "systemview_role_table_privileges", true},
	"fd6c8fb19384174612fa2d2431b34683": {"tg_upd_service_searchvec", "app_service_catalog", false},
}

// A trigger-returning function cannot be called as an ordinary SQL function.
// This definer is accepted only on its protected view, under that view's owner,
// with the original absence of a search_path override. No limited-role writes
// are granted to the view; moving it or changing its owner/path fails review.
const reviewedLegacyDefinerSQL = `p.prorettype='trigger'::regtype
 AND l.lanname='plpgsql' AND p.provolatile='v' AND p.pronargs=0
 AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) setting WHERE setting LIKE 'search_path=%')
 AND EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
   WHERE t.tgfoid=p.oid AND NOT t.tgisinternal AND ns.nspname='public'
   AND c.relname='systemview_role_table_privileges' AND c.relkind='v' AND c.relowner=p.proowner)
 AND NOT EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
   WHERE t.tgfoid=p.oid AND (ns.nspname<>'public' OR c.relname<>'systemview_role_table_privileges' OR c.relowner<>p.proowner))`

// Invokers need an immutable reviewed body, not the table's particular owner.
// MEMBER includes transitive membership even without automatic inheritance:
// a runtime identity must not be able to assume the function's owner and alter it.
const reviewedInvokerSafetySQL = `NOT p.prosecdef
 AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) setting WHERE setting LIKE 'search_path=%')
 AND NOT EXISTS (SELECT 1 FROM runtime_roles r WHERE pg_has_role(r.role_oid,p.proowner,'MEMBER'))`

func readReviewedInvokerTrigger(ctx context.Context, tx *sql.Tx, snapshot *GrantSnapshot, oid int64, digest string) (bool, error) {
	var accepted bool
	err := tx.QueryRowContext(ctx, `SELECT EXISTS(WITH runtime_roles AS
 (SELECT role_oid FROM jsonb_to_recordset($3::jsonb) AS r(role_oid oid))
 SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
 WHERE t.oid=$1 AND md5(p.prosrc)=$2 AND `+reviewedInvokerSafetySQL+`)`, oid, digest, string(roleJSON(snapshot.Roles))).Scan(&accepted)
	return accepted, err
}

func readReviewedLegacyTrigger(ctx context.Context, tx *sql.Tx, snapshot *GrantSnapshot, oid, source int64, digest string, definer bool) (bool, error) {
	identity, ok := reviewedLegacyTriggers[digest]
	if !ok || identity.definer != definer {
		return false, nil
	}
	object := snapshot.Objects[source]
	if object.Schema != "public" || object.Name != identity.table {
		return false, nil
	}
	var accepted bool
	query := `SELECT EXISTS(WITH runtime_roles AS
 (SELECT role_oid FROM jsonb_to_recordset($5::jsonb) AS r(role_oid oid))
 SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
 JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE t.oid=$1 AND n.nspname='public' AND p.proname=$2 AND p.pronargs=0
 AND p.prorettype='trigger'::regtype AND l.lanname='plpgsql' AND md5(p.prosrc)=$3 AND p.prosecdef=$4
 AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) setting WHERE setting LIKE 'search_path=%')`
	if definer {
		query += " AND " + reviewedLegacyDefinerSQL
	} else {
		query += " AND " + reviewedInvokerSafetySQL
	}
	query += ")"
	if err := tx.QueryRowContext(ctx, query, oid, identity.name, digest, definer, string(roleJSON(snapshot.Roles))).Scan(&accepted); err != nil {
		return false, err
	}
	if !accepted {
		return false, nil
	}
	var eventFlags int
	var updateColumns pq.StringArray
	if err := tx.QueryRowContext(ctx, `SELECT t.tgtype,ARRAY(SELECT a.attname FROM unnest(t.tgattr::smallint[]) col
	 JOIN pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=col ORDER BY a.attnum)
	 FROM pg_trigger t WHERE t.oid=$1`, oid).Scan(&eventFlags, &updateColumns); err != nil {
		return false, err
	}
	var events Operation
	if eventFlags&4 != 0 {
		events |= Insert
	}
	if eventFlags&16 != 0 {
		events |= Update
	}
	if eventFlags&8 != 0 {
		events |= Delete
	}
	if identity.name == "tg_location_touch_parent" && events&(Insert|Update|Delete) != 0 {
		snapshot.Dependencies = append(snapshot.Dependencies, Dependency{SourceOID: source, TargetOID: publicObjectOID(snapshot, "app_service_catalog"), Kind: "trigger_update", When: events & (Insert | Update | Delete), SourceUpdateColumns: updateColumns, Columns: []string{"updated"}, ReadColumns: []string{"id"}})
	}
	if identity.name == "tg_upd_service_searchvec" && events&(Insert|Update) != 0 {
		snapshot.Dependencies = append(snapshot.Dependencies, Dependency{SourceOID: source, TargetOID: publicObjectOID(snapshot, "app_service_locations"), Kind: "trigger_read", When: events & (Insert | Update), SourceUpdateColumns: updateColumns, Columns: []string{"service_id", "title", "street", "city", "state"}})
	}
	// Account writes remain denied, so username synchronization needs no pool grants.
	return true, nil
}

func publicObjectOID(snapshot *GrantSnapshot, name string) int64 {
	for oid, object := range snapshot.Objects {
		if object.Schema == "public" && object.Name == name && object.Kind == "table" {
			return oid
		}
	}
	return 0
}

// Physical trigger reachability includes auxiliary writes, independently of
// application callbacks. Iterate only these reviewed physical dependencies.
func addLegacyTriggerGrants(snapshot GrantSnapshot, entries map[string]Grant, add func(string, int64, string, string, string) error) error {
	active := map[int64]Operation{}
	updates := map[int64]map[string]bool{}
	addUpdate := func(oid int64, column string) bool {
		if updates[oid] == nil {
			updates[oid] = map[string]bool{}
		}
		if updates[oid][column] {
			return false
		}
		updates[oid][column] = true
		return true
	}
	for _, grant := range entries {
		if grant.Role != "basic" {
			continue
		}
		switch grant.Privilege {
		case "INSERT":
			active[grant.ObjectOID] |= Insert
		case "UPDATE":
			active[grant.ObjectOID] |= Update
			addUpdate(grant.ObjectOID, grant.Column)
		case "DELETE":
			active[grant.ObjectOID] |= Delete
		}
	}
	for changed := true; changed; {
		changed = false
		for _, dep := range snapshot.Dependencies {
			if dep.Kind != "trigger_update" && dep.Kind != "trigger_read" || !legacyTriggerReachable(dep, active[dep.SourceOID], updates[dep.SourceOID]) {
				continue
			}
			privilege := "SELECT"
			if dep.Kind == "trigger_update" {
				privilege = "UPDATE"
			}
			for _, column := range dep.Columns {
				if err := add("basic", dep.TargetOID, column, privilege, "reviewed legacy trigger"); err != nil {
					return err
				}
			}
			for _, column := range dep.ReadColumns {
				if err := add("basic", dep.TargetOID, column, "SELECT", "reviewed legacy trigger predicate"); err != nil {
					return err
				}
			}
			if privilege == "UPDATE" {
				active[dep.TargetOID] |= Update
				for _, column := range dep.Columns {
					changed = addUpdate(dep.TargetOID, column) || changed
				}
			}
		}
	}
	return nil
}

// UPDATE OF fires on mentioned columns, including SET x=x. Narrow auxiliary
// writes therefore reach it only through columns they can actually mention.
func legacyTriggerReachable(dep Dependency, active Operation, updates map[string]bool) bool {
	if active&dep.When&(Insert|Delete) != 0 {
		return true
	}
	if active&dep.When&Update == 0 {
		return false
	}
	if len(dep.SourceUpdateColumns) == 0 || updates[""] {
		return true
	}
	for _, column := range dep.SourceUpdateColumns {
		if updates[column] {
			return true
		}
	}
	return false
}
