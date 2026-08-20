// add_row_multilingual.go
// Validates multilingual values before dynamic add-row inserts are assembled.
// Bridges column language metadata and untrusted main, child, and relation-row payloads.
// Exists so multilingual columns cannot silently receive legacy scalar content.

package dtt_1_row_create

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	dtt_models "easelect/backend/core_components/dynamic_table_tools/dtt_models"
)

var errInvalidMultilingualCreateValue = errors.New("invalid multilingual create value")

// normalizeMultilingualCreatePayload replaces accepted language maps with a
// canonical JSON string and rejects scalar or incomplete multilingual values.
// Active languages come from the same registry-backed metadata contract that
// rendered the add-row form; no translation is generated or inferred here.
func normalizeMultilingualCreatePayload(
	payload map[string]interface{},
	columns []dtt_models.AddRowColumnInfo,
) error {
	if payload == nil {
		return nil
	}
	for _, column := range columns {
		if !column.IsMultilingual {
			continue
		}
		rawValue, exists := payload[column.ColumnName]
		if !exists && (!isAddRowColumnUserInsertable(column) ||
			strings.TrimSpace(column.ColumnDefault) != "" ||
			strings.TrimSpace(column.GenerationExpression) != "" ||
			strings.EqualFold(strings.TrimSpace(column.IsIdentity), "YES")) {
			continue
		}
		if !supportsMultilingualCreateType(column.DataType) {
			return fmt.Errorf(
				"%w: %s uses unsupported data type %s",
				errInvalidMultilingualCreateValue,
				column.ColumnName,
				column.DataType,
			)
		}
		if len(column.MultilingualLanguages) == 0 {
			return fmt.Errorf("%w: no active languages configured for %s", errInvalidMultilingualCreateValue, column.ColumnName)
		}

		if !exists || rawValue == nil || isBlankString(rawValue) {
			if strings.EqualFold(strings.TrimSpace(column.IsNullable), "YES") {
				payload[column.ColumnName] = nil
				continue
			}
			return fmt.Errorf("%w: %s is required in every active language", errInvalidMultilingualCreateValue, column.ColumnName)
		}

		languageMap, err := parseMultilingualCreateMap(rawValue)
		if err != nil {
			return fmt.Errorf("%w: %s must be a language map", errInvalidMultilingualCreateValue, column.ColumnName)
		}
		allowedLanguages := make(map[string]bool, len(column.MultilingualLanguages))
		for _, language := range column.MultilingualLanguages {
			allowedLanguages[language.LanguageCode] = true
			value, present := languageMap[language.LanguageCode]
			if !present || strings.TrimSpace(value) == "" {
				return fmt.Errorf(
					"%w: %s is missing language %s",
					errInvalidMultilingualCreateValue,
					column.ColumnName,
					language.LanguageCode,
				)
			}
		}
		for languageCode := range languageMap {
			if !allowedLanguages[languageCode] {
				return fmt.Errorf(
					"%w: %s contains unknown language %s",
					errInvalidMultilingualCreateValue,
					column.ColumnName,
					languageCode,
				)
			}
		}

		serialized, err := json.Marshal(languageMap)
		if err != nil {
			return fmt.Errorf("%w: encode %s", errInvalidMultilingualCreateValue, column.ColumnName)
		}
		payload[column.ColumnName] = string(serialized)
	}
	return nil
}

func supportsMultilingualCreateType(dataType string) bool {
	normalized := strings.ToLower(strings.TrimSpace(dataType))
	return normalized == "text" ||
		normalized == "json" ||
		normalized == "jsonb" ||
		strings.Contains(normalized, "character") ||
		strings.Contains(normalized, "varchar")
}

func isBlankString(value interface{}) bool {
	text, ok := value.(string)
	return ok && strings.TrimSpace(text) == ""
}

func parseMultilingualCreateMap(value interface{}) (map[string]string, error) {
	var rawMap map[string]interface{}
	switch typed := value.(type) {
	case string:
		if err := json.Unmarshal([]byte(typed), &rawMap); err != nil {
			return nil, err
		}
	case map[string]interface{}:
		rawMap = typed
	default:
		return nil, errInvalidMultilingualCreateValue
	}
	if rawMap == nil {
		return nil, errInvalidMultilingualCreateValue
	}

	languageMap := make(map[string]string, len(rawMap))
	for languageCode, rawText := range rawMap {
		text, ok := rawText.(string)
		if !ok || strings.TrimSpace(languageCode) == "" {
			return nil, errInvalidMultilingualCreateValue
		}
		languageMap[languageCode] = text
	}
	return languageMap, nil
}
