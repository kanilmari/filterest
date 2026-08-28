// embedding_source_policy_handler.go
// Exposes the admin-only field consent contract for external row embeddings.
// Bridges stable column UIDs, the fail-closed policy resolver, and full-table refresh scheduling.
// Exists so administrators can review outbound fields without editing database metadata directly.
package ai_features

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/security"

	"github.com/lib/pq"
)

type saveExternalEmbeddingSourcePolicyRequest struct {
	Dataset           string  `json:"dataset"`
	Enabled           *bool   `json:"enabled"`
	AllowedColumnUIDs []int64 `json:"allowed_column_uids"`
}

type saveExternalEmbeddingSourcePolicyResponse struct {
	Policy     ExternalEmbeddingSourcePolicy `json:"policy"`
	QueuedRows int64                         `json:"queued_rows"`
}

// ExternalEmbeddingSourcePolicyHandler reads or replaces one dataset's explicit outbound field set.
func ExternalEmbeddingSourcePolicyHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		getExternalEmbeddingSourcePolicy(w, r)
	case http.MethodPost:
		saveExternalEmbeddingSourcePolicy(w, r)
	default:
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only GET and POST allowed")
	}
}

func getExternalEmbeddingSourcePolicy(w http.ResponseWriter, r *http.Request) {
	dataset, err := security.SanitizeIdentifier(strings.TrimSpace(r.URL.Query().Get("dataset")))
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid dataset")
		return
	}
	tx, ok := dbutils.GetTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction missing")
		return
	}
	policy, err := loadExternalEmbeddingSourcePolicy(tx, dataset)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "embedding field policy unavailable")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(policy)
}

func saveExternalEmbeddingSourcePolicy(w http.ResponseWriter, r *http.Request) {
	var request saveExternalEmbeddingSourcePolicyRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid request")
		return
	}
	dataset, err := security.SanitizeIdentifier(strings.TrimSpace(request.Dataset))
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid dataset")
		return
	}
	tx, ok := dbutils.GetTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction missing")
		return
	}

	datasetPolicy, err := LoadExternalEmbeddingDatasetPolicy(tx, dataset)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "embedding dataset policy unavailable")
		return
	}
	tableUID, columns, err := ListExternalEmbeddingSourceColumns(tx, dataset)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "embedding field policy unavailable")
		return
	}
	allowedUIDs, err := validateExternalEmbeddingColumnUIDs(columns, request.AllowedColumnUIDs)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	eligibleUIDs := make([]int64, 0, len(columns))
	for _, column := range columns {
		eligibleUIDs = append(eligibleUIDs, column.ColumnUID)
	}
	if _, err := tx.Exec(`
		UPDATE system_column_details
		SET external_embedding_allowed = (column_uid = ANY($2::bigint[])),
		    updated = now()
		WHERE table_uid = $1
		  AND column_uid = ANY($3::bigint[])`, tableUID, pq.Array(allowedUIDs), pq.Array(eligibleUIDs)); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "embedding field policy save failed")
		return
	}
	requestedEnabled := true
	if request.Enabled != nil {
		requestedEnabled = *request.Enabled
	}
	if _, err := tx.Exec(`
		UPDATE system_db_tables
		SET external_embedding_enabled = $2,
		    external_embedding_policy_configured = true,
		    updated = now()
		WHERE table_uid = $1`, datasetPolicy.TableUID, requestedEnabled); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "embedding dataset policy save failed")
		return
	}

	var queuedRows int64
	if requestedEnabled {
		queuedRows, err = EnqueueAllEmbeddingRefreshJobs(tx, dataset, tableUID)
		if err != nil {
			httpresponse.RespondWithError(w, http.StatusInternalServerError, "embedding refresh scheduling failed")
			return
		}
	} else if _, err := tx.Exec(`
		DELETE FROM system_embedding_refresh_jobs
		WHERE table_uid = $1`, tableUID); err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "embedding refresh queue cleanup failed")
		return
	}
	policy, err := loadExternalEmbeddingSourcePolicy(tx, dataset)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "embedding field policy reload failed")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(saveExternalEmbeddingSourcePolicyResponse{
		Policy:     policy,
		QueuedRows: queuedRows,
	})
}

func loadExternalEmbeddingSourcePolicy(q embeddingPolicyQueryer, dataset string) (ExternalEmbeddingSourcePolicy, error) {
	datasetPolicy, err := LoadExternalEmbeddingDatasetPolicy(q, dataset)
	if err != nil {
		return ExternalEmbeddingSourcePolicy{}, err
	}
	tableUID, columns, err := ListExternalEmbeddingSourceColumns(q, dataset)
	if err != nil {
		return ExternalEmbeddingSourcePolicy{}, err
	}
	if !datasetPolicy.Configured {
		columns = defaultExternalEmbeddingSourceColumns(columns)
	}
	provider := strings.TrimSpace(strings.ToLower(os.Getenv("EMBEDDING_PROVIDER")))
	if provider == "" {
		provider = "openai"
	}
	return ExternalEmbeddingSourcePolicy{
		Dataset:    dataset,
		TableUID:   tableUID,
		Provider:   provider,
		Enabled:    datasetPolicy.Enabled,
		Configured: datasetPolicy.Configured,
		Columns:    columns,
	}, nil
}

func defaultExternalEmbeddingSourceColumns(columns []ExternalEmbeddingSourceColumn) []ExternalEmbeddingSourceColumn {
	defaults := make([]ExternalEmbeddingSourceColumn, len(columns))
	copy(defaults, columns)
	for index := range defaults {
		defaults[index].Allowed = true
	}
	return defaults
}

func validateExternalEmbeddingColumnUIDs(columns []ExternalEmbeddingSourceColumn, requested []int64) ([]int64, error) {
	eligible := make(map[int64]bool, len(columns))
	for _, column := range columns {
		eligible[column.ColumnUID] = true
	}
	unique := make(map[int64]bool, len(requested))
	allowed := make([]int64, 0, len(requested))
	for _, columnUID := range requested {
		if !eligible[columnUID] {
			return nil, fmt.Errorf("column_uid %d is not an eligible text field", columnUID)
		}
		if !unique[columnUID] {
			unique[columnUID] = true
			allowed = append(allowed, columnUID)
		}
	}
	sort.Slice(allowed, func(i, j int) bool { return allowed[i] < allowed[j] })
	return allowed, nil
}
