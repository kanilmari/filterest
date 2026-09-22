// embedding_status_report.go
// Reports, per dataset, whether and how completely its rows are embedded, and which model the site uses.
// Bridges the embedding refresh admin page with the stored vectors, the refresh queue and the provider settings.
// Exists because an administrator could refresh embeddings but could not see which datasets were embedded at all.
package ai_features

import (
	"database/sql"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/lib/pq"
)

// unitLengthTolerance decides whether a stored vector counts as unit length.
// OpenAI returns unit-length vectors; Google at 1536 dimensions does not, so
// the length tells the two providers' vectors apart even at equal dimensions.
const unitLengthTolerance = 0.01

// embeddingStatusStatementTimeout keeps one large dataset from holding the
// admin page: the report counts rows and reads every stored vector's length.
const embeddingStatusStatementTimeout = "15s"

// knownOpenAIEmbeddingDimensions lists the vector lengths of the OpenAI
// models whose length is fixed. Other models are checked by vector length only.
var knownOpenAIEmbeddingDimensions = map[string]int{
	"text-embedding-ada-002": 1536,
	"text-embedding-3-small": 1536,
	"text-embedding-3-large": 3072,
}

// EmbeddingProviderStatus is the site's embedding configuration as the running
// server sees it. It names no secret: only whether a key is present.
type EmbeddingProviderStatus struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	// Dimensions is the vector length the model produces; 0 when not known in advance.
	Dimensions int `json:"dimensions"`
	// UnitLength says whether the model's vectors are scaled to length one.
	UnitLength    bool `json:"unit_length"`
	KeyConfigured bool `json:"key_configured"`
	// RefreshQueueAvailable says whether row changes can be queued for re-embedding.
	RefreshQueueAvailable bool `json:"refresh_queue_available"`
}

// EmbeddingLanguageCoverage counts the dataset rows embedded in one language.
type EmbeddingLanguageCoverage struct {
	Language string `json:"language"`
	Rows     int64  `json:"rows"`
}

// EmbeddingDatasetStatus is one dataset's embedding state. Counts that cannot
// be known are null rather than zero: the general embedding keeps no time, so
// neither its age nor whether its row changed afterwards is recorded.
type EmbeddingDatasetStatus struct {
	Dataset               string `json:"dataset"`
	GeneralEmbedding      bool   `json:"general_embedding"`
	MultilingualEmbedding bool   `json:"multilingual_embedding"`
	ProviderSending       bool   `json:"provider_sending_enabled"`
	ApprovedFields        int    `json:"approved_fields"`
	AutomaticRefresh      bool   `json:"automatic_refresh"`
	// AutomaticRefreshBlocker names why rows are not re-embedded on change:
	// no_embedding_storage, provider_sending_disabled, no_approved_fields or
	// queue_unavailable. Empty when automatic refresh is on.
	AutomaticRefreshBlocker string `json:"automatic_refresh_blocker"`

	TotalRows             *int64                      `json:"total_rows"`
	EmbeddedRows          int64                       `json:"embedded_rows"`
	GeneralEmbeddedRows   int64                       `json:"general_embedded_rows"`
	ChangedSinceEmbedding *int64                      `json:"changed_since_embedding"`
	Languages             []EmbeddingLanguageCoverage `json:"languages"`
	VectorDimensions      []int                       `json:"vector_dimensions"`
	// OtherModelEmbeddings counts stored vectors whose length or scale does
	// not match the configured model: search cannot compare them meaningfully.
	OtherModelEmbeddings     int64      `json:"other_model_embeddings"`
	LastRefreshed            *time.Time `json:"last_refreshed"`
	PendingRefreshes         int64      `json:"pending_refreshes"`
	FailingRefreshes         int64      `json:"failing_refreshes"`
	OrphanLanguageEmbeddings int64      `json:"orphan_language_embeddings"`
	// Unavailable is set when this dataset's figures could not be read.
	Unavailable bool `json:"unavailable,omitempty"`
}

// EmbeddingStatusReport is the admin page's whole status answer.
type EmbeddingStatusReport struct {
	Provider EmbeddingProviderStatus  `json:"provider"`
	Datasets []EmbeddingDatasetStatus `json:"datasets"`
}

type embeddingStatusCatalogEntry struct {
	Dataset           string
	TableUID          int64
	General           bool
	Multilingual      bool
	HasUpdatedColumn  bool
	ProviderSending   bool
	InCurrentProject  bool
	HasEmbeddingState bool
}

// embeddingStatusCatalogQuery lists every dataset that stores embeddings or
// may send rows to the provider, plus the current project's datasets so
// the page also shows which of them are not embedded.
const embeddingStatusCatalogQuery = `
	WITH RECURSIVE current_project_folders AS (
		SELECT id FROM system_table_folders WHERE is_current_project = true
		UNION ALL
		SELECT child.id
		FROM system_table_folders child
		JOIN current_project_folders parent ON child.parent_id = parent.id
	), datasets AS (
		SELECT sdt.table_name,
		       sdt.table_uid,
		       to_regclass(format('public.%I', sdt.table_name)) AS relation,
		       COALESCE(sdt.multi_lang_embeddings, false)
		           AND to_regclass(format('public.%I', sdt.table_name || '_lang_embeddings')) IS NOT NULL AS multilingual,
		       COALESCE(sdt.external_embedding_enabled, false) AS provider_sending,
		       sdt.folder_id IN (SELECT id FROM current_project_folders) AS in_current_project
		FROM system_db_tables sdt
		WHERE COALESCE(NULLIF(sdt.schema_name, ''), 'public') = 'public'
	)
	SELECT d.table_name,
	       d.table_uid,
	       EXISTS (SELECT 1 FROM pg_attribute a
	               WHERE a.attrelid = d.relation AND a.attname = 'embedding_vector'
	                 AND a.attnum > 0 AND NOT a.attisdropped) AS general,
	       d.multilingual,
	       EXISTS (SELECT 1 FROM pg_attribute a
	               WHERE a.attrelid = d.relation AND a.attname = 'updated'
	                 AND a.attnum > 0 AND NOT a.attisdropped) AS has_updated,
	       d.provider_sending,
	       COALESCE(d.in_current_project, false)
	FROM datasets d
	WHERE d.relation IS NOT NULL
	ORDER BY d.table_name`

// BuildEmbeddingStatusReport reads the embedding state of every relevant
// dataset. It only reads. Each dataset is measured inside its own savepoint,
// so one unreadable dataset is reported as unavailable instead of failing the
// whole page.
func BuildEmbeddingStatusReport(tx *sql.Tx) (EmbeddingStatusReport, error) {
	provider := currentEmbeddingProviderStatus(tx)
	report := EmbeddingStatusReport{Provider: provider, Datasets: []EmbeddingDatasetStatus{}}

	if _, err := tx.Exec(fmt.Sprintf("SET LOCAL statement_timeout = '%s'", embeddingStatusStatementTimeout)); err != nil {
		return report, fmt.Errorf("limit status query time: %w", err)
	}
	catalog, err := readEmbeddingStatusCatalog(tx)
	if err != nil {
		return report, err
	}
	queue, err := readEmbeddingRefreshQueueCounts(tx, provider.RefreshQueueAvailable)
	if err != nil {
		return report, err
	}

	for _, entry := range catalog {
		if !entry.HasEmbeddingState && !entry.InCurrentProject {
			continue
		}
		status := EmbeddingDatasetStatus{
			Dataset:               entry.Dataset,
			GeneralEmbedding:      entry.General,
			MultilingualEmbedding: entry.Multilingual,
			ProviderSending:       entry.ProviderSending,
			Languages:             []EmbeddingLanguageCoverage{},
			VectorDimensions:      []int{},
		}
		counts := queue[entry.TableUID]
		status.PendingRefreshes = counts.pending
		status.FailingRefreshes = counts.failing

		if _, err := tx.Exec(`SAVEPOINT embedding_status_dataset`); err != nil {
			return report, fmt.Errorf("status savepoint: %w", err)
		}
		if err := measureEmbeddingDataset(tx, entry, provider, &status); err != nil {
			if _, rollbackErr := tx.Exec(`ROLLBACK TO SAVEPOINT embedding_status_dataset; RELEASE SAVEPOINT embedding_status_dataset`); rollbackErr != nil {
				return report, fmt.Errorf("status savepoint rollback: %w", rollbackErr)
			}
			status.Unavailable = true
		} else if _, err := tx.Exec(`RELEASE SAVEPOINT embedding_status_dataset`); err != nil {
			return report, fmt.Errorf("status savepoint release: %w", err)
		}
		status.AutomaticRefreshBlocker = automaticRefreshBlocker(entry, status.ApprovedFields, provider.RefreshQueueAvailable)
		status.AutomaticRefresh = status.AutomaticRefreshBlocker == ""
		report.Datasets = append(report.Datasets, status)
	}
	return report, nil
}

func currentEmbeddingProviderStatus(q embeddingPolicyQueryer) EmbeddingProviderStatus {
	provider := configuredEmbeddingProvider()
	model := configuredEmbeddingModel(provider)
	status := EmbeddingProviderStatus{Provider: provider, Model: model}
	if provider == embeddingProviderGoogle {
		status.Dimensions = googleEmbeddingDimensions
		status.KeyConfigured = strings.TrimSpace(os.Getenv("GOOGLE_API_KEY")) != ""
	} else {
		status.Dimensions = knownOpenAIEmbeddingDimensions[model]
		status.UnitLength = true
		status.KeyConfigured = strings.TrimSpace(os.Getenv("OPENAI_API_KEY")) != ""
	}
	_ = q.QueryRow(`SELECT to_regclass('public.system_embedding_refresh_jobs') IS NOT NULL`).
		Scan(&status.RefreshQueueAvailable)
	return status
}

func readEmbeddingStatusCatalog(tx *sql.Tx) ([]embeddingStatusCatalogEntry, error) {
	rows, err := tx.Query(embeddingStatusCatalogQuery)
	if err != nil {
		return nil, fmt.Errorf("embedding status catalog: %w", err)
	}
	defer rows.Close()
	catalog := []embeddingStatusCatalogEntry{}
	for rows.Next() {
		var entry embeddingStatusCatalogEntry
		if err := rows.Scan(
			&entry.Dataset,
			&entry.TableUID,
			&entry.General,
			&entry.Multilingual,
			&entry.HasUpdatedColumn,
			&entry.ProviderSending,
			&entry.InCurrentProject,
		); err != nil {
			return nil, fmt.Errorf("embedding status catalog row: %w", err)
		}
		entry.HasEmbeddingState = entry.General || entry.Multilingual || entry.ProviderSending
		catalog = append(catalog, entry)
	}
	return catalog, rows.Err()
}

type embeddingRefreshQueueCount struct {
	pending int64
	failing int64
}

// readEmbeddingRefreshQueueCounts counts, per dataset, the rows waiting to be
// re-embedded and those whose last attempt failed, in one query.
func readEmbeddingRefreshQueueCounts(tx *sql.Tx, queueAvailable bool) (map[int64]embeddingRefreshQueueCount, error) {
	counts := map[int64]embeddingRefreshQueueCount{}
	if !queueAvailable {
		return counts, nil
	}
	rows, err := tx.Query(`
		SELECT table_uid, count(*), count(*) FILTER (WHERE last_error_code <> '')
		FROM system_embedding_refresh_jobs
		GROUP BY table_uid`)
	if err != nil {
		return nil, fmt.Errorf("embedding refresh queue: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var tableUID int64
		var count embeddingRefreshQueueCount
		if err := rows.Scan(&tableUID, &count.pending, &count.failing); err != nil {
			return nil, fmt.Errorf("embedding refresh queue row: %w", err)
		}
		counts[tableUID] = count
	}
	return counts, rows.Err()
}

// measureEmbeddingDataset fills the row counts, languages, vector shapes and
// approved fields of one dataset. A dataset without embedding storage is not
// counted: every row of it is unembedded, and counting it would cost a scan.
func measureEmbeddingDataset(tx *sql.Tx, entry embeddingStatusCatalogEntry, provider EmbeddingProviderStatus, status *EmbeddingDatasetStatus) error {
	if entry.ProviderSending {
		_, approved, err := ResolveExternalEmbeddingSourceColumns(tx, entry.Dataset)
		if err != nil {
			return err
		}
		status.ApprovedFields = len(approved)
	}
	if !entry.General && !entry.Multilingual {
		return nil
	}
	if err := readEmbeddingRowCounts(tx, entry, status); err != nil {
		return err
	}
	if entry.Multilingual {
		if err := readEmbeddingLanguageCoverage(tx, entry, status); err != nil {
			return err
		}
	}
	return readEmbeddingVectorShapes(tx, entry, provider, status)
}

func readEmbeddingRowCounts(tx *sql.Tx, entry embeddingStatusCatalogEntry, status *EmbeddingDatasetStatus) error {
	quotedTable := pq.QuoteIdentifier(entry.Dataset)
	generalPresent := "false"
	if entry.General {
		generalPresent = "dataset_row.embedding_vector IS NOT NULL"
	}
	languageJoin := ""
	languagePresent := "false"
	changedSince := "NULL::bigint"
	lastRefreshed := "NULL::timestamptz"
	if entry.Multilingual {
		languageJoin = fmt.Sprintf(`
			LEFT JOIN (
				SELECT host_row_id, max(updated) AS embedded_at
				FROM %s
				WHERE embedding IS NOT NULL
				GROUP BY host_row_id
			) AS language_embedding ON language_embedding.host_row_id = dataset_row.id`,
			pq.QuoteIdentifier(entry.Dataset+"_lang_embeddings"))
		languagePresent = "language_embedding.host_row_id IS NOT NULL"
		lastRefreshed = "max(language_embedding.embedded_at)::timestamptz"
		if entry.HasUpdatedColumn {
			// A row edited after its newest language embedding may no longer
			// match what that embedding describes.
			changedSince = "count(*) FILTER (WHERE language_embedding.embedded_at < dataset_row.updated)"
		}
	}

	var total int64
	var changed sql.NullInt64
	var refreshed sql.NullTime
	err := tx.QueryRow(fmt.Sprintf(`
		SELECT count(*),
		       count(*) FILTER (WHERE %[2]s OR %[3]s),
		       count(*) FILTER (WHERE %[2]s),
		       %[4]s,
		       %[5]s
		FROM %[1]s AS dataset_row%[6]s`,
		quotedTable, generalPresent, languagePresent, changedSince, lastRefreshed, languageJoin,
	)).Scan(&total, &status.EmbeddedRows, &status.GeneralEmbeddedRows, &changed, &refreshed)
	if err != nil {
		return fmt.Errorf("embedding row counts for %s: %w", entry.Dataset, err)
	}
	status.TotalRows = &total
	if changed.Valid {
		status.ChangedSinceEmbedding = &changed.Int64
	}
	if refreshed.Valid {
		status.LastRefreshed = &refreshed.Time
	}
	return nil
}

// readEmbeddingLanguageCoverage counts live rows per language and the
// language embeddings left behind by rows that no longer exist.
func readEmbeddingLanguageCoverage(tx *sql.Tx, entry embeddingStatusCatalogEntry, status *EmbeddingDatasetStatus) error {
	rows, err := tx.Query(fmt.Sprintf(`
		SELECT COALESCE(language_embedding.language_code, ''),
		       count(DISTINCT language_embedding.host_row_id)
		           FILTER (WHERE live_row.id IS NOT NULL AND language_embedding.embedding IS NOT NULL),
		       count(*) FILTER (WHERE live_row.id IS NULL)
		FROM %[1]s AS language_embedding
		LEFT JOIN %[2]s AS live_row ON live_row.id = language_embedding.host_row_id
		GROUP BY 1
		ORDER BY 1`,
		pq.QuoteIdentifier(entry.Dataset+"_lang_embeddings"),
		pq.QuoteIdentifier(entry.Dataset),
	))
	if err != nil {
		return fmt.Errorf("embedding languages for %s: %w", entry.Dataset, err)
	}
	defer rows.Close()
	for rows.Next() {
		var language string
		var live, orphaned int64
		if err := rows.Scan(&language, &live, &orphaned); err != nil {
			return err
		}
		status.OrphanLanguageEmbeddings += orphaned
		if live > 0 && language != "" {
			status.Languages = append(status.Languages, EmbeddingLanguageCoverage{Language: language, Rows: live})
		}
	}
	return rows.Err()
}

// readEmbeddingVectorShapes groups the live rows' stored vectors by length and
// by whether they are unit length, and counts those the configured model could
// not have made.
func readEmbeddingVectorShapes(tx *sql.Tx, entry embeddingStatusCatalogEntry, provider EmbeddingProviderStatus, status *EmbeddingDatasetStatus) error {
	quotedTable := pq.QuoteIdentifier(entry.Dataset)
	vectors := make([]string, 0, 2)
	if entry.General {
		vectors = append(vectors, fmt.Sprintf(
			`SELECT embedding_vector AS vector FROM %s WHERE embedding_vector IS NOT NULL`, quotedTable))
	}
	if entry.Multilingual {
		vectors = append(vectors, fmt.Sprintf(`
			SELECT language_embedding.embedding
			FROM %s AS language_embedding
			JOIN %s AS live_row ON live_row.id = language_embedding.host_row_id
			WHERE language_embedding.embedding IS NOT NULL`,
			pq.QuoteIdentifier(entry.Dataset+"_lang_embeddings"), quotedTable))
	}
	rows, err := tx.Query(fmt.Sprintf(`
		SELECT vector_dims(stored.vector),
		       abs(vector_norm(stored.vector) - 1) < %g,
		       count(*)
		FROM (%s) AS stored
		GROUP BY 1, 2`,
		unitLengthTolerance, strings.Join(vectors, " UNION ALL ")))
	if err != nil {
		return fmt.Errorf("embedding vector shapes for %s: %w", entry.Dataset, err)
	}
	defer rows.Close()
	dimensions := map[int]bool{}
	for rows.Next() {
		var dims int
		var unitLength bool
		var count int64
		if err := rows.Scan(&dims, &unitLength, &count); err != nil {
			return err
		}
		dimensions[dims] = true
		if !vectorShapeMatchesProvider(provider, dims, unitLength) {
			status.OtherModelEmbeddings += count
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for dims := range dimensions {
		status.VectorDimensions = append(status.VectorDimensions, dims)
	}
	sort.Ints(status.VectorDimensions)
	return nil
}

// vectorShapeMatchesProvider tells whether the configured model could have
// produced a vector of this length and scale. It cannot tell two models of the
// same provider and shape apart; it does catch the common case of vectors made
// before the site switched between OpenAI and Google.
func vectorShapeMatchesProvider(provider EmbeddingProviderStatus, dims int, unitLength bool) bool {
	if provider.Dimensions > 0 && dims != provider.Dimensions {
		return false
	}
	return unitLength == provider.UnitLength
}

func automaticRefreshBlocker(entry embeddingStatusCatalogEntry, approvedFields int, queueAvailable bool) string {
	switch {
	case !entry.General && !entry.Multilingual:
		return "no_embedding_storage"
	case !entry.ProviderSending:
		return "provider_sending_disabled"
	case approvedFields == 0:
		return "no_approved_fields"
	case !queueAvailable:
		return "queue_unavailable"
	default:
		return ""
	}
}
