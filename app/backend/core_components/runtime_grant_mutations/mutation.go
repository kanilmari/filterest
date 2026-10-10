// mutation.go
// Connects HTTP grant-changing operations to the handler-free runtime policy.
// Owns no transaction: locks, old metadata and reconciliation use the request tx.
// Provides the same completion boundary for rights, creation and generic writes.
package runtime_grant_mutations

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"os"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/runtime_grants"
	"easelect/backend/core_components/update_capability"
)

type Mutation struct {
	Tx                *sql.Tx
	before            runtime_grants.GrantSnapshot
	roles             runtime_grants.RoleConfiguration
	targets           []int64
	refuseNewBlockers bool
	updateGuard       *update_capability.WriteGuard
}

// ReadsPolicyMetadata identifies the registries read by LoadGrantSnapshot and
// its dependency readers. Ordinary content requests retain today's recorder.
func ReadsPolicyMetadata(table string) bool {
	switch table {
	case "system_group_table_func_rights", "system_functions", "system_user_groups", "system_user_group_memberships", "system_db_tables", "system_foreign_key_relations_1_m", "system_foreign_key_relations_m_m", "system_triggers", "system_column_details", "system_row_actor_columns":
		return true
	}
	return false
}

func Begin(ctx context.Context, w http.ResponseWriter) (*Mutation, error) {
	if err := httpresponse.EnableCommitBuffer(w); err != nil {
		return nil, err
	}
	tx, err := dbutils.RequireTxWithError(ctx)
	if err != nil {
		return nil, err
	}
	mutation, err := BeginTx(ctx, tx)
	if mutation != nil {
		mutation.refuseNewBlockers = true
	}
	return mutation, err
}

// BeginTx is also used by transaction-only CSV callers. Call before their first
// row/reference/DDL lock; HTTP callers must enable response buffering separately.
func BeginTx(ctx context.Context, tx *sql.Tx) (*Mutation, error) {
	if err := runtime_grants.LockRuntimeGrantPolicy(ctx, tx); err != nil {
		return nil, err
	}
	roles := runtime_grants.ConfiguredRoles(os.Getenv)
	before, err := runtime_grants.LoadMutationSnapshot(ctx, tx, roles)
	if err != nil {
		return nil, err
	}
	guard, err := update_capability.Capture(ctx, tx)
	if err != nil {
		return nil, err
	}
	return &Mutation{Tx: tx, before: before, roles: roles, updateGuard: guard}, nil
}

// BeginGeneric opens the ordinary tx too, but selects the grant boundary only
// for policy metadata. Nil mutation is an intentional ordinary-data request.
func BeginGeneric(ctx context.Context, w http.ResponseWriter, table string) (*sql.Tx, *Mutation, error) {
	if ReadsPolicyMetadata(table) {
		mutation, err := Begin(ctx, w)
		if err != nil {
			return nil, nil, err
		}
		return mutation.Tx, mutation, nil
	}
	if table == "systemview_role_table_privileges" || table == "systemview_role_column_privileges" {
		if err := httpresponse.EnableCommitBuffer(w); err != nil {
			return nil, nil, err
		}
		tx, err := dbutils.RequireTxWithError(ctx)
		if err != nil {
			return nil, nil, err
		}
		// These views may still edit unrelated roles. Serialize their REVOKEs
		// without reconciling an application-policy snapshot for those roles.
		return tx, nil, runtime_grants.LockRuntimeGrantPolicy(ctx, tx)
	}
	tx, err := dbutils.RequireTxWithError(ctx)
	return tx, nil, err
}

// Finish must precede every success response. Explicit dataset UIDs cover a
// no-op or empty replacement too; changed metadata includes removed targets.
func (m *Mutation) Finish(ctx context.Context, datasetUIDs ...int64) error {
	if m == nil {
		return nil
	}
	if err := m.updateGuard.Check(ctx, m.Tx); err != nil {
		_ = m.Tx.Rollback()
		return err
	}
	datasetUIDs = append(datasetUIDs, m.targets...)
	scope := make([]int64, 0, len(datasetUIDs))
	for _, uid := range datasetUIDs {
		for oid, object := range m.before.Objects {
			if uid > 0 && object.DatasetUID == uid {
				scope = append(scope, oid)
			}
		}
		// New datasets did not exist in before; resolve inside this same tx.
		var oid int64
		if uid > 0 {
			if err := m.Tx.QueryRowContext(ctx, `SELECT COALESCE(to_regclass(format('%I.%I',COALESCE(NULLIF(schema_name,''),'public'),table_name))::oid,0) FROM public.system_db_tables WHERE table_uid=$1`, uid).Scan(&oid); err != nil && err != sql.ErrNoRows {
				return err
			}
			if oid != 0 {
				scope = append(scope, oid)
			} else {
				// A request explicitly targeting missing metadata must still
				// refuse its own dangling row without adopting its whole registry.
				scope = append(scope, runtime_grants.DatasetScopeIdentity(m.before, uid))
			}
		}
	}
	reconcile := runtime_grants.ReconcileRuntimeGrantsScoped
	if m.refuseNewBlockers {
		reconcile = runtime_grants.ReconcileHTTPRuntimeGrantsScoped
	}
	result, err := reconcile(ctx, m.Tx, m.roles, &m.before, scope)
	logMutationFindings(result)
	if err != nil {
		// A transaction-only caller must also be unable to commit a partially
		// applied policy after accidentally ignoring the returned error.
		_ = m.Tx.Rollback()
	}
	return err
}

func RespondError(w http.ResponseWriter, err error) {
	var refusal *httpresponse.Refusal
	if errors.As(err, &refusal) {
		httpresponse.RespondWithRefusal(w, refusal)
		return
	}
	var blocked *runtime_grants.ScopeBlocker
	if errors.As(err, &blocked) {
		httpresponse.RespondWithRefusal(w, &httpresponse.Refusal{Status: http.StatusConflict, LangKey: "error_runtime_grant_policy_blocked", Message: "Permissions could not be saved because a dataset or its dependencies need a permission-policy review."})
		return
	}
	log.Printf("runtime grant mutation failed: %v", err)
	httpresponse.RespondWithError(w, http.StatusInternalServerError, "permissions could not be saved")
}

// RefuseManagedPrivilegeRole prevents privilege views from becoming a second
// editor for the pools provisioned by the application policy.
func RefuseManagedPrivilegeRole(role string) error {
	roles := runtime_grants.ConfiguredRoles(os.Getenv)
	for _, label := range []string{"basic", "guest", "readonly", "confidential"} {
		if role != "" && role == roles.Names[label] {
			return &httpresponse.Refusal{Status: http.StatusConflict, LangKey: "error_runtime_grant_privilege_managed", Message: "Change this runtime role's permissions through group and dataset rights."}
		}
	}
	return nil
}

// KeepImportBlockerScope is the explicit CSV/restore exemption. Import policy
// remains scoped; cold full-database restores instead stop and reconcile at boot.
func (m *Mutation) KeepImportBlockerScope() {
	if m != nil {
		m.refuseNewBlockers = false
	}
}
