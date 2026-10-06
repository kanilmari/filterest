// snapshot_reader.go
// Reads catalogue and permission metadata without touching application rows or ACLs.
// Uses the caller's transaction; the audit supplies one repeatable READ ONLY snapshot.
// Reuses the stage-1/2a role preconditions and protected-object dependency closure.
package runtime_grants

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

// LoadGrantSnapshot performs SELECTs only. Callers must supply repeatable-read
// isolation or the future policy mutation barrier to keep metadata consistent.
func LoadGrantSnapshot(ctx context.Context, tx *sql.Tx, config RoleConfiguration) (snapshot GrantSnapshot, err error) {
	defer func() {
		if err != nil {
			roles := append([]Role{}, snapshot.Roles...)
			for label, name := range config.Names {
				roles = append(roles, Role{Label: label, Name: name})
			}
			for _, name := range config.ProtectedNames {
				roles = append(roles, Role{Label: "protected", Name: name})
			}
			err = metadataReaderError("LoadGrantSnapshot", err, roles)
		}
	}()
	snapshot = GrantSnapshot{Objects: map[int64]Object{}, Functions: map[int64]Function{}, Groups: map[int64]bool{}, GuestGroups: map[int64]bool{}, AdminRecovery: config.AdminRecovery}
	if tx == nil {
		return snapshot, fmt.Errorf("snapshot transaction is required")
	}
	if err := loadRuntimeRoleIdentities(ctx, tx, config, &snapshot); err != nil {
		return snapshot, err
	}
	if err := readRows(ctx, tx, objectsSQL, nil, func(rows *sql.Rows) error {
		var object Object
		if err := rows.Scan(&object.OID, &object.Schema, &object.Name, &object.Kind, &object.Protected, &object.Extension); err != nil {
			return err
		}
		if _, duplicate := snapshot.Objects[object.OID]; duplicate {
			return fmt.Errorf("ambiguous catalogue identity")
		}
		snapshot.Objects[object.OID] = object
		return nil
	}); err != nil {
		return snapshot, fmt.Errorf("read object catalogue failed: %w", err)
	}
	if err := readRows(ctx, tx, `SELECT a.attrelid,a.attname,t.typname IN ('text','varchar'),a.attidentity <> '' FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE a.attnum>0 AND NOT a.attisdropped AND c.relkind IN ('r','p','v','m','f','S') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema' ORDER BY a.attrelid,a.attnum`, nil, func(rows *sql.Rows) error {
		var oid int64
		var column Column
		if err := rows.Scan(&oid, &column.Name, &column.Text, &column.Identity); err != nil {
			return err
		}
		if object, ok := snapshot.Objects[oid]; ok {
			object.Columns = append(object.Columns, column)
			snapshot.Objects[oid] = object
		} else {
			snapshot.Blockers = append(snapshot.Blockers, Finding{Role: "policy", Kind: "column", Object: "pg_catalog.pg_attribute", Column: column.Name, Finding: "blocker", Reason: fmt.Sprintf("row (attrelid=%d, attname=%s): missing snapshot table OID %d", oid, column.Name, oid)})
		}
		return nil
	}); err != nil {
		return snapshot, fmt.Errorf("read column catalogue failed: %w", err)
	}
	var required bool
	if err := tx.QueryRowContext(ctx, `SELECT to_regclass('public.system_db_tables') IS NOT NULL AND to_regclass('public.system_users') IS NOT NULL AND to_regclass('public.system_functions') IS NOT NULL AND to_regclass('public.system_user_groups') IS NOT NULL AND to_regclass('public.system_group_table_func_rights') IS NOT NULL AND to_regclass('public.system_user_group_memberships') IS NOT NULL`).Scan(&required); err != nil {
		return snapshot, fmt.Errorf("read required permission registries: %w", err)
	}
	if !required {
		return snapshot, fmt.Errorf("required permission registry is missing")
	}
	// The route checker resolves datasets by table_uid; a registry row without
	// it cannot authorize a dataset path (route_table_checker.go). Read it anyway
	// to report the row rather than silently filtering it out of the snapshot.
	if err := readRows(ctx, tx, `SELECT d.id,d.table_uid,COALESCE(NULLIF(d.schema_name,''),'public'),d.table_name,COALESCE(d.cached_oid,0),COALESCE(d.fk_display_column,'') FROM public.system_db_tables d ORDER BY d.id`, nil, func(rows *sql.Rows) error {
		var id, cached int64
		var uid sql.NullInt64
		var name sql.NullString
		var schema, display string
		if err := rows.Scan(&id, &uid, &schema, &name, &cached, &display); err != nil {
			return err
		}
		row := fmt.Sprintf("id %d", id)
		if !uid.Valid {
			metadataFinding(&snapshot, "system_db_tables", row, "preserved_outside_scope", "no table identity (NULL table_uid); no dataset dependency or grant follows")
			return nil
		}
		if !name.Valid || name.String == "" {
			metadataFinding(&snapshot, "system_db_tables", row, "blocker", fmt.Sprintf("table_uid=%d has no catalogue table name", uid.Int64))
			return nil
		}
		for oid, object := range snapshot.Objects {
			if object.Kind == "table" && object.Schema == schema && object.Name == name.String {
				if uid.Int64 <= 0 || object.DatasetUID != 0 || oidByUID(&snapshot, uid.Int64) != 0 || cached != 0 && cached != oid {
					metadataFinding(&snapshot, "system_db_tables", row, "blocker", fmt.Sprintf("invalid or duplicate table_uid=%d or cached_oid=%d for %s (catalogue OID %d)", uid.Int64, cached, object.Identifier(), oid))
					return nil
				}
				object.DatasetUID, object.DisplayColumn = uid.Int64, display
				snapshot.Objects[oid] = object
				return nil
			}
		}
		metadataFinding(&snapshot, "system_db_tables", row, "blocker", fmt.Sprintf("missing snapshot identity table_uid=%d (%s)", uid.Int64, (Object{Schema: schema, Name: name.String}).Identifier()))
		return nil
	}); err != nil {
		return snapshot, fmt.Errorf("read dataset registry: %w", err)
	}
	if err := readRows(ctx, tx, `SELECT id,COALESCE(url_route_endpoint,''),disabled,COALESCE(ui_only,false),COALESCE(specific_table_related,true) FROM public.system_functions ORDER BY id`, nil, func(rows *sql.Rows) error {
		var function Function
		var disabled sql.NullBool
		if err := rows.Scan(&function.ID, &function.Route, &disabled, &function.UIOnly, &function.TableRelated); err != nil {
			return err
		}
		if disabled.Valid {
			value := disabled.Bool
			function.Disabled = &value
		}
		snapshot.Functions[function.ID] = function
		return nil
	}); err != nil {
		return snapshot, fmt.Errorf("read function metadata failed: %w", err)
	}
	snapshot.Blockers = append(snapshot.Blockers, unclassifiedRouteFindings(snapshot)...)
	// Creation resolves name='guests' (create_table_registration.go); bootstrap
	// IDs are not a site contract. Authorization also uses actual memberships.
	guestGroupCount := 0
	if err := readRows(ctx, tx, `SELECT id,name FROM public.system_user_groups`, nil, func(rows *sql.Rows) error {
		var id int64
		var name sql.NullString
		if err := rows.Scan(&id, &name); err != nil {
			return err
		}
		snapshot.Groups[id] = true
		if name.Valid && name.String == "guests" {
			snapshot.GuestGroups[id] = true
			snapshot.GuestGroupID = id
			guestGroupCount++
		}
		return nil
	}); err != nil {
		return snapshot, fmt.Errorf("read group metadata failed: %w", err)
	}
	if !snapshot.Groups[1] || guestGroupCount != 1 {
		snapshot.Blockers = append(snapshot.Blockers, Finding{Role: "policy", Finding: "blocker", Reason: "administrator group or uniquely named guests group is missing"})
	}
	// Authorization rejects IDs <= 0; only seeded guest identity 1 contributes.
	if err := readRows(ctx, tx, `SELECT id,group_id FROM public.system_user_group_memberships WHERE user_id=1`, nil, func(rows *sql.Rows) error {
		var id int64
		var group sql.NullInt64
		if err := rows.Scan(&id, &group); err != nil {
			return err
		}
		row := fmt.Sprintf("id %d", id)
		// Authorization joins memberships on group_id, so NULL cannot add a
		// guest capability. Do not output the membership's personal identity.
		if !group.Valid {
			metadataFinding(&snapshot, "system_user_group_memberships", row, "preserved_outside_scope", "no group identity (NULL group_id); no grant follows")
		} else if !snapshot.Groups[group.Int64] {
			metadataFinding(&snapshot, "system_user_group_memberships", row, "blocker", fmt.Sprintf("missing group_id=%d", group.Int64))
		} else {
			snapshot.GuestGroups[group.Int64] = true
		}
		return nil
	}); err != nil {
		return snapshot, fmt.Errorf("read guest capability metadata failed: %w", err)
	}
	if err := readRows(ctx, tx, `SELECT id,user_group_id,function_id,target_table_uid FROM public.system_group_table_func_rights`, nil, func(rows *sql.Rows) error {
		var id int64
		var group, function, uid sql.NullInt64
		if err := rows.Scan(&id, &group, &function, &uid); err != nil {
			return err
		}
		row := fmt.Sprintf("id %d", id)
		// The route checker joins group/function IDs. NULL table_uid is its
		// intentional table-independent scope, which grants no dataset operation.
		if !group.Valid || !function.Valid {
			metadataFinding(&snapshot, "system_group_table_func_rights", row, "preserved_outside_scope", "no group or function identity; no grant follows")
			return nil
		}
		_, functionKnown := snapshot.Functions[function.Int64]
		if !snapshot.Groups[group.Int64] || !functionKnown {
			metadataFinding(&snapshot, "system_group_table_func_rights", row, "blocker", fmt.Sprintf("missing user_group_id=%d or function_id=%d", group.Int64, function.Int64))
			return nil
		}
		if uid.Valid && oidByUID(&snapshot, uid.Int64) == 0 {
			metadataFinding(&snapshot, "system_group_table_func_rights", row, "blocker", fmt.Sprintf("missing target_table_uid=%d", uid.Int64))
			return nil
		}
		snapshot.Rights = append(snapshot.Rights, Right{GroupID: group.Int64, FunctionID: function.Int64, DatasetUID: uid.Int64})
		return nil
	}); err != nil {
		return snapshot, fmt.Errorf("read declared rights failed: %w", err)
	}
	if err := readRows(ctx, tx, sequencesSQL, nil, func(rows *sql.Rows) error {
		var rowID int64
		var use SequenceUse
		var defaultReferenced bool
		if err := rows.Scan(&rowID, &use.TableOID, &use.SequenceOID, &use.Column, &use.NextValue, &defaultReferenced); err != nil {
			return err
		}
		if _, ok := snapshot.Objects[use.TableOID]; !ok {
			snapshot.Blockers = append(snapshot.Blockers, Finding{Role: "policy", Kind: "column", Object: "pg_catalog.pg_attrdef/pg_depend", ObjectOID: use.TableOID, Column: use.Column, Finding: "blocker", Reason: fmt.Sprintf("sequence dependency row OID %d: missing table OID %d", rowID, use.TableOID)})
			return nil
		}
		if _, ok := snapshot.Objects[use.SequenceOID]; !ok {
			snapshot.Blockers = append(snapshot.Blockers, Finding{Role: "policy", Kind: "sequence", Object: "pg_catalog.pg_attrdef/pg_depend", ObjectOID: use.SequenceOID, Finding: "blocker", Reason: fmt.Sprintf("sequence dependency row OID %d: missing sequence OID %d", rowID, use.SequenceOID)})
			return nil
		}
		if defaultReferenced && !use.NextValue {
			snapshot.Blockers = append(snapshot.Blockers, Finding{Role: "policy", Kind: "column", ObjectOID: use.TableOID, Object: snapshot.Objects[use.TableOID].Identifier(), Column: use.Column, Finding: "blocker", Reason: "unreviewed sequence default requirement"})
		}
		snapshot.Sequences = append(snapshot.Sequences, use)
		if snapshot.Objects[use.TableOID].Protected || accountTables[snapshot.Objects[use.TableOID].Name] {
			object := snapshot.Objects[use.SequenceOID]
			object.Protected = true
			snapshot.Objects[use.SequenceOID] = object
		}
		return nil
	}); err != nil {
		return snapshot, fmt.Errorf("read sequence dependencies failed: %w", err)
	}
	if err := loadDependencies(ctx, tx, &snapshot); err != nil {
		return snapshot, err
	}
	if err := readTriggerDependencies(ctx, tx, &snapshot); err != nil {
		return snapshot, fmt.Errorf("read trigger dependency metadata failed: %w", err)
	}
	if err := readDefaultFunctionDependencies(ctx, tx, &snapshot); err != nil {
		return snapshot, fmt.Errorf("read default dependency metadata failed: %w", err)
	}
	if err := readRows(ctx, tx, sqlPathReviewSQL, []any{string(roleJSON(snapshot.Roles)), string(reviewedDefinerBodiesJSON())}, func(rows *sql.Rows) error {
		var finding Finding
		if err := rows.Scan(&finding.Role, &finding.Kind, &finding.ObjectOID, &finding.Object, &finding.Reason); err != nil {
			return err
		}
		finding.Finding = "blocker"
		if finding.Kind == "function" {
			finding.Privilege = "EXECUTE"
		}
		snapshot.Blockers = append(snapshot.Blockers, finding)
		return nil
	}); err != nil {
		return snapshot, fmt.Errorf("read owner-run SQL dependency metadata failed: %w", err)
	}
	return snapshot, nil
}

func readRows(ctx context.Context, tx *sql.Tx, query string, args []any, scan func(*sql.Rows) error) error {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := scan(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}

func oidByUID(snapshot *GrantSnapshot, uid int64) int64 {
	for oid, object := range snapshot.Objects {
		if object.DatasetUID == uid && uid > 0 {
			return oid
		}
	}
	return 0
}

func oidByName(snapshot *GrantSnapshot, name string) int64 {
	for oid, object := range snapshot.Objects {
		if object.Schema == "public" && object.Name == name && object.Kind == "table" {
			return oid
		}
	}
	return 0
}

func roleJSON(roles []Role) []byte {
	values := []map[string]any{}
	for _, role := range roles {
		values = append(values, map[string]any{"label": role.Label, "role_oid": role.OID})
	}
	encoded, _ := json.Marshal(values)
	return encoded
}

// The account closure and both sequence dependency forms are the stage-2a
// catalogue contract (accountTableTargets), without its mutation statements.
const objectsSQL = `WITH RECURSIVE protected(oid) AS (
 SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('system_users','system_user_groups','system_user_group_memberships','system_group_table_func_rights','system_functions')
 UNION
 SELECT r.ev_class FROM protected p JOIN pg_depend d ON d.refclassid='pg_class'::regclass AND d.refobjid=p.oid AND d.classid='pg_rewrite'::regclass JOIN pg_rewrite r ON r.oid=d.objid JOIN pg_class v ON v.oid=r.ev_class AND v.relkind IN ('v','m') WHERE r.ev_class<>p.oid
)
SELECT c.oid,n.nspname,c.relname,CASE WHEN c.relkind='S' THEN 'sequence' ELSE 'table' END,
 c.oid IN (SELECT oid FROM protected) OR c.relname LIKE 'systemview\_%' OR (c.relkind='v' AND EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=c.oid AND NOT t.tgisinternal AND p.prosecdef)),
 EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f','S') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
UNION ALL
SELECT oid,'',nspname,'schema',false,false FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname<>'information_schema'`

const sequencesSQL = `SELECT a.oid,a.adrelid,d.refobjid,att.attname,pg_get_expr(a.adbin,a.adrelid) ~ '^(pg_catalog\.)?nextval\(',true
 FROM pg_attrdef a JOIN pg_depend d ON d.classid='pg_attrdef'::regclass AND d.objid=a.oid AND d.refclassid='pg_class'::regclass JOIN pg_class seq ON seq.oid=d.refobjid AND seq.relkind='S' JOIN pg_attribute att ON att.attrelid=a.adrelid AND att.attnum=a.adnum JOIN pg_namespace n ON n.oid=seq.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
 UNION
 SELECT seq.oid,d.refobjid,seq.oid,att.attname,att.attidentity='' AND EXISTS (
 SELECT 1 FROM pg_attrdef a JOIN pg_depend used ON used.classid='pg_attrdef'::regclass AND used.objid=a.oid AND used.refclassid='pg_class'::regclass AND used.refobjid=seq.oid
 WHERE a.adrelid=d.refobjid AND a.adnum=d.refobjsubid AND pg_get_expr(a.adbin,a.adrelid) ~ '^(pg_catalog\.)?nextval\('),false
 FROM pg_depend d JOIN pg_class seq ON seq.oid=d.objid AND seq.relkind='S' JOIN pg_attribute att ON att.attrelid=d.refobjid AND att.attnum=d.refobjsubid JOIN pg_namespace n ON n.oid=seq.relnamespace WHERE d.classid='pg_class'::regclass AND d.refclassid='pg_class'::regclass AND d.deptype IN ('a','i') AND n.nspname !~ '^pg_' AND n.nspname<>'information_schema'`
