// embedding_source_policy.go
// Resolves the explicit field-level consent boundary for externally generated row embeddings.
// Bridges stable column metadata, dynamic row reads, and every provider-facing embedding path.
// Exists so missing or stale metadata always fails closed instead of sending every text field.
package ai_features

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"easelect/backend/core_components/security"

	"github.com/lib/pq"
)

var embeddingLanguages = []string{"en", "fi"}

// ExternalEmbeddingSourceColumn describes one physical text column and its explicit consent state.
type ExternalEmbeddingSourceColumn struct {
	ColumnUID      int64  `json:"column_uid"`
	ColumnName     string `json:"column_name"`
	DataType       string `json:"data_type"`
	IsMultilingual bool   `json:"is_multilingual"`
	Allowed        bool   `json:"allowed"`
}

// ExternalEmbeddingSourcePolicy is the admin-facing field selection for one dataset.
type ExternalEmbeddingSourcePolicy struct {
	Dataset    string                          `json:"dataset"`
	TableUID   int64                           `json:"table_uid"`
	Provider   string                          `json:"provider"`
	Enabled    bool                            `json:"enabled"`
	Configured bool                            `json:"configured"`
	Columns    []ExternalEmbeddingSourceColumn `json:"columns"`
}

// ExternalEmbeddingDatasetPolicy is the table-level outbound-processing switch.
// Configured distinguishes a deliberate field selection from the untouched
// first-use default where every technically eligible field is preselected.
type ExternalEmbeddingDatasetPolicy struct {
	TableUID   int64
	Enabled    bool
	Configured bool
}

// AuthorizedEmbeddingSource contains only content selected by the fail-closed policy.
type AuthorizedEmbeddingSource struct {
	General     string
	ByLanguage  map[string]string
	Fingerprint string
}

type embeddingPolicyQueryer interface {
	Query(query string, args ...interface{}) (*sql.Rows, error)
	QueryRow(query string, args ...interface{}) *sql.Row
}

// LoadExternalEmbeddingDatasetPolicy resolves the table-level switch. The
// public-schema predicate is a hard technical boundary: confidential tables in
// the restricted schema can never become embedding candidates through this API.
func LoadExternalEmbeddingDatasetPolicy(q embeddingPolicyQueryer, tableName string) (ExternalEmbeddingDatasetPolicy, error) {
	sanitized, err := security.SanitizeIdentifier(tableName)
	if err != nil {
		return ExternalEmbeddingDatasetPolicy{}, err
	}

	var policy ExternalEmbeddingDatasetPolicy
	if err := q.QueryRow(`
		SELECT
			table_uid,
			COALESCE(external_embedding_enabled, false),
			COALESCE(external_embedding_policy_configured, false)
		FROM system_db_tables
		WHERE table_name = $1
		  AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'`, sanitized).Scan(
		&policy.TableUID,
		&policy.Enabled,
		&policy.Configured,
	); err != nil {
		return ExternalEmbeddingDatasetPolicy{}, fmt.Errorf("resolve external embedding dataset policy: %w", err)
	}
	return policy, nil
}

// ListExternalEmbeddingSourceColumns lists current physical text columns and their consent state.
func ListExternalEmbeddingSourceColumns(q embeddingPolicyQueryer, tableName string) (int64, []ExternalEmbeddingSourceColumn, error) {
	sanitized, err := security.SanitizeIdentifier(tableName)
	if err != nil {
		return 0, nil, err
	}

	rows, err := q.Query(`
		SELECT
			sdt.table_uid,
			scd.column_uid,
			scd.column_name,
			isc.data_type,
			COALESCE(scd.is_multilingual, false),
			COALESCE(scd.external_embedding_allowed, false)
		FROM system_db_tables sdt
		JOIN system_column_details scd ON scd.table_uid = sdt.table_uid
		JOIN information_schema.columns isc
		  ON isc.table_schema = COALESCE(NULLIF(sdt.schema_name, ''), 'public')
		 AND isc.table_name = sdt.table_name
		 AND isc.column_name = scd.column_name
		WHERE sdt.table_name = $1
		  AND COALESCE(NULLIF(sdt.schema_name, ''), 'public') = 'public'
		  AND isc.data_type IN ('text', 'character varying')
		ORDER BY isc.ordinal_position`, sanitized)
	if err != nil {
		return 0, nil, fmt.Errorf("list external embedding source columns: %w", err)
	}
	defer rows.Close()

	var tableUID int64
	columns := make([]ExternalEmbeddingSourceColumn, 0)
	for rows.Next() {
		var column ExternalEmbeddingSourceColumn
		if err := rows.Scan(
			&tableUID,
			&column.ColumnUID,
			&column.ColumnName,
			&column.DataType,
			&column.IsMultilingual,
			&column.Allowed,
		); err != nil {
			return 0, nil, fmt.Errorf("scan external embedding source column: %w", err)
		}
		columns = append(columns, column)
	}
	if err := rows.Err(); err != nil {
		return 0, nil, fmt.Errorf("iterate external embedding source columns: %w", err)
	}
	if tableUID == 0 {
		if err := q.QueryRow(`
			SELECT table_uid
			FROM system_db_tables
			WHERE table_name = $1
			  AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'`, sanitized).Scan(&tableUID); err != nil {
			return 0, nil, fmt.Errorf("resolve external embedding dataset: %w", err)
		}
	}
	return tableUID, columns, nil
}

// ResolveExternalEmbeddingSourceColumns returns only explicitly allowed current text columns.
func ResolveExternalEmbeddingSourceColumns(q embeddingPolicyQueryer, tableName string) (int64, []ExternalEmbeddingSourceColumn, error) {
	datasetPolicy, err := LoadExternalEmbeddingDatasetPolicy(q, tableName)
	if err != nil {
		return 0, nil, err
	}
	tableUID, columns, err := ListExternalEmbeddingSourceColumns(q, tableName)
	if err != nil {
		return 0, nil, err
	}
	return tableUID, effectiveExternalEmbeddingSourceColumns(
		datasetPolicy.Enabled,
		datasetPolicy.Configured,
		columns,
	), nil
}

// effectiveExternalEmbeddingSourceColumns applies the two-level policy without
// mutating the metadata slice returned by the database. Enabling a table for
// the first time selects every technically eligible field; after the first save
// the administrator's explicit field choices are authoritative.
func effectiveExternalEmbeddingSourceColumns(enabled, configured bool, columns []ExternalEmbeddingSourceColumn) []ExternalEmbeddingSourceColumn {
	if !enabled {
		return []ExternalEmbeddingSourceColumn{}
	}
	allowed := make([]ExternalEmbeddingSourceColumn, 0, len(columns))
	for _, column := range columns {
		if !configured {
			column.Allowed = true
		}
		if column.Allowed {
			allowed = append(allowed, column)
		}
	}
	return allowed
}

// LoadAuthorizedEmbeddingSource reads only policy-approved columns for one row.
func LoadAuthorizedEmbeddingSource(q embeddingPolicyQueryer, tableName string, rowID int64, forUpdate bool) (AuthorizedEmbeddingSource, error) {
	sanitized, err := security.SanitizeIdentifier(tableName)
	if err != nil {
		return AuthorizedEmbeddingSource{}, err
	}
	_, columns, err := ResolveExternalEmbeddingSourceColumns(q, sanitized)
	if err != nil {
		return AuthorizedEmbeddingSource{}, err
	}

	selectColumns := []string{pq.QuoteIdentifier("id")}
	for _, column := range columns {
		selectColumns = append(selectColumns, pq.QuoteIdentifier(column.ColumnName))
	}
	query := fmt.Sprintf(
		"SELECT %s FROM %s WHERE id=$1",
		strings.Join(selectColumns, ", "),
		pq.QuoteIdentifier(sanitized),
	)
	if forUpdate {
		query += " FOR UPDATE"
	}

	values := make([]interface{}, len(columns)+1)
	pointers := make([]interface{}, len(values))
	for index := range values {
		pointers[index] = &values[index]
	}
	if err := q.QueryRow(query, rowID).Scan(pointers...); err != nil {
		return AuthorizedEmbeddingSource{}, err
	}

	rowValues := make(map[string]interface{}, len(columns))
	for index, column := range columns {
		rowValues[column.ColumnName] = values[index+1]
	}
	return ComposeAuthorizedEmbeddingSource(columns, rowValues), nil
}

// ComposeAuthorizedEmbeddingSource builds deterministic provider input from approved columns only.
func ComposeAuthorizedEmbeddingSource(columns []ExternalEmbeddingSourceColumn, rowValues map[string]interface{}) AuthorizedEmbeddingSource {
	generalParts := make([]string, 0, len(columns))
	languageParts := map[string][]string{}
	for _, language := range embeddingLanguages {
		languageParts[language] = []string{}
	}

	for _, column := range columns {
		if !column.Allowed {
			continue
		}
		rawValue, exists := rowValues[column.ColumnName]
		if !exists || rawValue == nil {
			continue
		}
		textValue := strings.TrimSpace(fmt.Sprintf("%v", rawValue))
		if textValue == "" {
			continue
		}

		if column.IsMultilingual {
			translations := map[string]string{}
			if json.Unmarshal([]byte(textValue), &translations) == nil {
				for _, language := range embeddingLanguages {
					translated := strings.TrimSpace(translations[language])
					if translated == "" {
						continue
					}
					generalParts = append(generalParts, translated)
					languageParts[language] = append(languageParts[language], translated)
				}
				continue
			}
		}

		generalParts = append(generalParts, textValue)
		language := detectLanguage(textValue)
		languageParts[language] = append(languageParts[language], textValue)
	}

	source := AuthorizedEmbeddingSource{
		General:    strings.Join(generalParts, " / "),
		ByLanguage: make(map[string]string, len(languageParts)),
	}
	for _, language := range embeddingLanguages {
		source.ByLanguage[language] = strings.Join(languageParts[language], " / ")
	}
	source.Fingerprint = fingerprintAuthorizedEmbeddingSource(source)
	return source
}

func fingerprintAuthorizedEmbeddingSource(source AuthorizedEmbeddingSource) string {
	parts := []string{"general=" + source.General}
	languages := make([]string, 0, len(source.ByLanguage))
	for language := range source.ByLanguage {
		languages = append(languages, language)
	}
	sort.Strings(languages)
	for _, language := range languages {
		parts = append(parts, language+"="+source.ByLanguage[language])
	}
	digest := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(digest[:])
}
