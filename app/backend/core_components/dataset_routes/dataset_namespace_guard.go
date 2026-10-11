// dataset_namespace_guard.go
// Uses the migration-owned namespace lock and validation on every naming write.
// Connects create/rename/alias services with stable database refusal reasons.
// Keeps race protection in PostgreSQL, including writes outside these services.
package dataset_routes

import (
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"errors"
	"net/http"

	"github.com/lib/pq"
)

const NamespaceConflictKey = "dataset_namespace_conflict"
const NamespaceInvalidKey = "dataset_namespace_invalid"
const NamespaceRetryKey = "dataset_namespace_retry"

// LockDatasetNamespace must run in the writer's transaction, before reading any
// target or locking registry rows. A separate statement gives READ COMMITTED
// waiters a fresh validation snapshot. The DB witness rejects stale RR writers.
func LockDatasetNamespace(q dbutils.Querier) error {
	_, err := q.Exec(`SELECT public.app_lock_dataset_namespace()`)
	return NamespaceError(err)
}

// NamespaceError also maps persistence-trigger refusals and the active-name
// index backstop, so generic and dedicated handlers return the same reason.
func NamespaceError(err error) error {
	var pg *pq.Error
	if !errors.As(err, &pg) {
		return err
	}
	if pg.Code == "40001" {
		return &httpresponse.Refusal{Status: http.StatusConflict, LangKey: NamespaceRetryKey,
			Message: "Dataset names changed during this operation. Please retry."}
	}
	if pg.Code == "P0001" && pg.Message == NamespaceConflictKey || pg.Code == "23505" && pg.Constraint == "idx_system_db_table_aliases_active_name" {
		return &RouteConflictError{Segment: pg.Detail, Reason: NamespaceConflictKey}
	}
	if pg.Code == "P0001" && pg.Message == NamespaceInvalidKey {
		return &AliasValidationError{Message: "Choose a valid dataset name or alias."}
	}
	return err
}

// RespondNamespaceRefusal preserves the standard translated refusal contract.
// The language key is the stable application error code; code stays HTTP status.
func RespondNamespaceRefusal(w http.ResponseWriter, err error) bool {
	err = NamespaceError(err)
	var refusal *httpresponse.Refusal
	if errors.As(err, &refusal) {
		httpresponse.RespondWithRefusal(w, refusal)
		return true
	}
	var conflict *RouteConflictError
	var invalid *AliasValidationError
	if errors.As(err, &conflict) {
		httpresponse.RespondWithRefusal(w, &httpresponse.Refusal{Status: http.StatusConflict,
			LangKey: NamespaceConflictKey, Message: "This name already belongs to another dataset or a reserved route. Choose another name."})
		return true
	}
	if errors.As(err, &invalid) {
		httpresponse.RespondWithRefusal(w, &httpresponse.Refusal{Status: http.StatusBadRequest,
			LangKey: NamespaceInvalidKey, Message: "Choose a valid dataset name or alias."})
		return true
	}
	return false
}
