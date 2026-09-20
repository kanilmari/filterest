// dataset_interface_label_creator.go
// Creates readable language-key values from newly created dataset and column names.
// Bridges dynamic schema creation with both legacy and normalized translation stores.
// Exists so a dataset is readable immediately without depending on an AI translation request.
package lang

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"unicode"

	"easelect/backend/core_components/lang_key_naming"

	"github.com/lib/pq"
)

type interfaceLabelExecer interface {
	Exec(query string, args ...interface{}) (sql.Result, error)
}

type datasetInterfaceLabel struct {
	LangKey          string
	Finnish          string
	English          string
	SourceType       string
	SourceHigh       string
	SourceLow        string
	UsageExplanation string
}

// EnsureDatasetInterfaceLabels creates the labels a newly created dataset and
// its initial columns can render before any optional AI-generated copy exists.
func EnsureDatasetInterfaceLabels(
	execer interfaceLabelExecer,
	datasetName string,
	columnNames []string,
) error {
	labels := datasetInterfaceLabels(datasetName)
	labels = append(labels, columnInterfaceLabels(datasetName, columnNames)...)
	return persistDerivedInterfaceLabels(execer, labels)
}

// EnsureColumnInterfaceLabels creates labels for columns added after the
// dataset itself was created.
func EnsureColumnInterfaceLabels(
	execer interfaceLabelExecer,
	datasetName string,
	columnNames []string,
) error {
	return persistDerivedInterfaceLabels(
		execer,
		columnInterfaceLabels(datasetName, columnNames),
	)
}

func datasetInterfaceLabels(datasetName string) []datasetInterfaceLabel {
	datasetName = strings.TrimSpace(datasetName)
	if datasetName == "" {
		return nil
	}
	readableName := readableDatasetName(datasetName)
	byKey := map[string]datasetInterfaceLabel{
		datasetName: newDerivedInterfaceLabel(
			datasetName,
			readableName,
			readableName,
			"table",
			datasetName,
			datasetName,
			fmt.Sprintf("Readable dataset label derived from %q.", datasetName),
		),
	}

	for _, langKey := range lang_key_naming.DatasetOwnedKeyNames(datasetName) {
		finnish := readableName
		english := readableName
		switch {
		case strings.HasPrefix(langKey, "add_row_"):
			finnish = "Lisää rivi: " + readableName
			english = "Add row: " + readableName
		case strings.HasPrefix(langKey, "search_for_"):
			finnish = "Etsi: " + readableName
			english = "Search: " + readableName
		case strings.HasPrefix(langKey, "search_slogan_"):
			finnish = "Selaa aineistoa " + readableName + "."
			english = "Browse " + readableName + "."
		}
		byKey[langKey] = newDerivedInterfaceLabel(
			langKey,
			finnish,
			english,
			"table",
			datasetName,
			datasetName,
			fmt.Sprintf("Dataset interface text derived from %q.", datasetName),
		)
	}
	return sortedInterfaceLabels(byKey)
}

func columnInterfaceLabels(datasetName string, columnNames []string) []datasetInterfaceLabel {
	datasetName = strings.TrimSpace(datasetName)
	byKey := make(map[string]datasetInterfaceLabel)
	for _, columnName := range columnNames {
		columnName = strings.TrimSpace(columnName)
		if columnName == "" {
			continue
		}
		readableName := readableSchemaName(columnName)
		labels := []datasetInterfaceLabel{
			newDerivedInterfaceLabel(
				columnName,
				readableName,
				readableName,
				"column",
				datasetName,
				columnName,
				fmt.Sprintf("Readable label for column %q in dataset %q.", columnName, datasetName),
			),
			newDerivedInterfaceLabel(
				lang_key_naming.SearchPlaceholderKey(columnName),
				"Etsi: "+readableName,
				"Search: "+readableName,
				"column",
				datasetName,
				columnName,
				fmt.Sprintf("Search placeholder for column %q in dataset %q.", columnName, datasetName),
			),
			newDerivedInterfaceLabel(
				columnName+"_asc",
				readableName+", nouseva",
				readableName+", ascending",
				"column",
				datasetName,
				columnName,
				fmt.Sprintf("Ascending sort option for column %q in dataset %q.", columnName, datasetName),
			),
			newDerivedInterfaceLabel(
				columnName+"_desc",
				readableName+", laskeva",
				readableName+", descending",
				"column",
				datasetName,
				columnName,
				fmt.Sprintf("Descending sort option for column %q in dataset %q.", columnName, datasetName),
			),
		}
		for _, label := range labels {
			byKey[label.LangKey] = label
		}
	}
	return sortedInterfaceLabels(byKey)
}

func newDerivedInterfaceLabel(
	langKey string,
	finnish string,
	english string,
	sourceType string,
	sourceHigh string,
	sourceLow string,
	usageExplanation string,
) datasetInterfaceLabel {
	return datasetInterfaceLabel{
		LangKey:          langKey,
		Finnish:          finnish,
		English:          english,
		SourceType:       sourceType,
		SourceHigh:       sourceHigh,
		SourceLow:        sourceLow,
		UsageExplanation: usageExplanation,
	}
}

func sortedInterfaceLabels(byKey map[string]datasetInterfaceLabel) []datasetInterfaceLabel {
	keys := make([]string, 0, len(byKey))
	for key := range byKey {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	labels := make([]datasetInterfaceLabel, 0, len(keys))
	for _, key := range keys {
		labels = append(labels, byKey[key])
	}
	return labels
}

func readableDatasetName(datasetName string) string {
	withoutTechnicalPrefix := strings.TrimPrefix(datasetName, "app_")
	withoutTechnicalPrefix = strings.TrimPrefix(withoutTechnicalPrefix, "system_")
	withoutTechnicalPrefix = strings.TrimPrefix(withoutTechnicalPrefix, "dev_")
	return readableSchemaName(withoutTechnicalPrefix)
}

func readableSchemaName(schemaName string) string {
	words := strings.Fields(strings.NewReplacer("_", " ", "-", " ").Replace(strings.TrimSpace(schemaName)))
	for index, word := range words {
		switch strings.ToLower(word) {
		case "id":
			words[index] = "ID"
		case "api":
			words[index] = "API"
		case "url":
			words[index] = "URL"
		}
	}
	readable := strings.Join(words, " ")
	if readable == "" {
		return ""
	}
	runes := []rune(readable)
	runes[0] = unicode.ToUpper(runes[0])
	return string(runes)
}

func persistDerivedInterfaceLabels(
	execer interfaceLabelExecer,
	labels []datasetInterfaceLabel,
) error {
	if len(labels) == 0 {
		return nil
	}

	langKeys := make([]string, 0, len(labels))
	finnishValues := make([]string, 0, len(labels))
	englishValues := make([]string, 0, len(labels))
	sourceTypes := make([]string, 0, len(labels))
	sourceHighs := make([]string, 0, len(labels))
	sourceLows := make([]string, 0, len(labels))
	usageExplanations := make([]string, 0, len(labels))
	for _, label := range labels {
		langKeys = append(langKeys, label.LangKey)
		finnishValues = append(finnishValues, label.Finnish)
		englishValues = append(englishValues, label.English)
		sourceTypes = append(sourceTypes, label.SourceType)
		sourceHighs = append(sourceHighs, label.SourceHigh)
		sourceLows = append(sourceLows, label.SourceLow)
		usageExplanations = append(usageExplanations, label.UsageExplanation)
	}

	_, err := execer.Exec(`
		WITH requested AS (
			SELECT *
			FROM unnest(
				$1::text[], $2::text[], $3::text[], $4::text[],
				$5::text[], $6::text[], $7::text[]
			) AS requested_values(
				lang_key, fi, en, source_type,
				source_high, source_low, usage_explanation
			)
		), upserted_keys AS (
			INSERT INTO system_lang_keys (lang_key, fi, en, creation_spec, updated)
			SELECT requested.lang_key,
			       CASE WHEN EXISTS (
			           SELECT 1 FROM system_languages
			           WHERE language_code = 'fi' AND is_enabled
			       ) THEN requested.fi END,
			       CASE WHEN EXISTS (
			           SELECT 1 FROM system_languages
			           WHERE language_code = 'en' AND is_enabled
			       ) THEN requested.en END,
			       'Interface label derived from dataset schema names.',
			       NOW()
			FROM requested
			ON CONFLICT (lang_key) DO UPDATE
			SET fi = CASE
			        WHEN EXCLUDED.fi IS NOT NULL
			         AND NULLIF(BTRIM(system_lang_keys.fi), '') IS NULL
			        THEN COALESCE((
			            SELECT translations.translation
			            FROM system_lang_key_translations AS translations
			            WHERE translations.lang_key_id = system_lang_keys.id
			              AND translations.language_code = 'fi'
			        ), EXCLUDED.fi)
			        ELSE system_lang_keys.fi
			    END,
			    en = CASE
			        WHEN EXCLUDED.en IS NOT NULL
			         AND NULLIF(BTRIM(system_lang_keys.en), '') IS NULL
			        THEN COALESCE((
			            SELECT translations.translation
			            FROM system_lang_key_translations AS translations
			            WHERE translations.lang_key_id = system_lang_keys.id
			              AND translations.language_code = 'en'
			        ), EXCLUDED.en)
			        ELSE system_lang_keys.en
			    END,
			    creation_spec = CASE
			        WHEN NULLIF(BTRIM(system_lang_keys.creation_spec), '') IS NULL
			        THEN EXCLUDED.creation_spec
			        ELSE system_lang_keys.creation_spec
			    END,
			    updated = NOW()
			RETURNING id, lang_key, fi, en
		), upserted_translations AS (
			INSERT INTO system_lang_key_translations (
				lang_key_id, language_code, translation, source_kind, review_status
			)
			SELECT keys.id,
			       translated.language_code,
			       translated.translation,
			       'import',
			       'unreviewed'
			FROM upserted_keys AS keys
			CROSS JOIN LATERAL (
				VALUES ('fi', keys.fi), ('en', keys.en)
			) AS translated(language_code, translation)
			JOIN system_languages AS languages
			  ON languages.language_code = translated.language_code
			 AND languages.is_enabled
			WHERE NULLIF(BTRIM(translated.translation), '') IS NOT NULL
			ON CONFLICT (lang_key_id, language_code) DO UPDATE
			SET translation = CASE
			        WHEN system_lang_key_translations.source_kind = 'import'
			         AND system_lang_key_translations.review_status = 'unreviewed'
			        THEN EXCLUDED.translation
			        ELSE system_lang_key_translations.translation
			    END,
			    updated = CASE
			        WHEN system_lang_key_translations.source_kind = 'import'
			         AND system_lang_key_translations.review_status = 'unreviewed'
			        THEN NOW()
			        ELSE system_lang_key_translations.updated
			    END
			RETURNING lang_key_id
		)
		INSERT INTO system_lang_key_sources (
			lang_key_id, source_type, source_high, source_low,
			usage_explanation, last_seen
		)
		SELECT keys.id,
		       requested.source_type,
		       requested.source_high,
		       requested.source_low,
		       requested.usage_explanation,
		       CURRENT_DATE
		FROM requested
		JOIN upserted_keys AS keys USING (lang_key)
		ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
		SET source_low = EXCLUDED.source_low,
		    usage_explanation = CASE
		        WHEN NULLIF(BTRIM(system_lang_key_sources.usage_explanation), '') IS NULL
		        THEN EXCLUDED.usage_explanation
		        ELSE system_lang_key_sources.usage_explanation
		    END,
		    last_seen = CURRENT_DATE
	`, pq.Array(langKeys), pq.Array(finnishValues), pq.Array(englishValues),
		pq.Array(sourceTypes), pq.Array(sourceHighs), pq.Array(sourceLows),
		pq.Array(usageExplanations))
	if err != nil {
		return fmt.Errorf("create derived dataset interface labels: %w", err)
	}
	return nil
}
