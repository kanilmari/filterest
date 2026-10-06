// row_value_conversion.go
// Converts inline update values to the dataset's existing PostgreSQL types.
// Connects JSON input with bound values used by the generic update handler.
// Keeps conversion separate from transaction and permission orchestration.
package dtt_1_row_update

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// convertValue muuntaa pyynnön arvon sarakkeen data_type:n perusteella
func convertValue(value interface{}, dataType string) (interface{}, error) {
	// Keep NULL as a bound SQL parameter. PostgreSQL still enforces NOT NULL,
	// foreign keys and other constraints through the existing authorized UPDATE.
	if value == nil {
		return nil, nil
	}
	normalizedDataType := strings.ToLower(strings.TrimSpace(dataType))
	switch {
	case strings.Contains(normalizedDataType, "integer"), strings.Contains(normalizedDataType, "bigint"), strings.Contains(normalizedDataType, "smallint"):
		// Sallitaan float64 ja string
		var intValue int64
		switch v := value.(type) {
		case float64:
			intValue = int64(v)
		case string:
			trimmed := strings.TrimSpace(v)
			if trimmed == "" {
				intValue = 0
			} else {
				parsedInt, err := strconv.ParseInt(trimmed, 10, 64)
				if err != nil {
					return nil, fmt.Errorf("invalid integer value")
				}
				intValue = parsedInt
			}
		default:
			return nil, fmt.Errorf("invalid integer value")
		}
		return intValue, nil

	case strings.Contains(normalizedDataType, "boolean"):
		boolValue, ok := value.(bool)
		if !ok {
			return nil, fmt.Errorf("invalid boolean value")
		}
		return boolValue, nil

	case strings.Contains(normalizedDataType, "character varying"), strings.Contains(normalizedDataType, "text"):
		strValue, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("invalid string value")
		}
		return strValue, nil

	case normalizedDataType == "date":
		strValue, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("invalid date value")
		}
		strValue = strings.ReplaceAll(strings.TrimSpace(strValue), "/", "-")
		parsedDate, err := time.Parse("2006-01-02", strValue)
		if err != nil {
			return nil, fmt.Errorf("invalid date format")
		}
		return parsedDate.Format("2006-01-02"), nil

	case strings.Contains(normalizedDataType, "timestamp with time zone"), strings.Contains(normalizedDataType, "timestamptz"):
		strValue, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("invalid timestamp with time zone value")
		}
		normalizedValue := strings.TrimSpace(strValue)
		if len(normalizedValue) > 10 && normalizedValue[10] == ' ' {
			normalizedValue = normalizedValue[:10] + "T" + normalizedValue[11:]
		}
		parsedInstant, err := time.Parse(time.RFC3339Nano, normalizedValue)
		if err != nil {
			return nil, fmt.Errorf("timestamp with time zone requires an explicit RFC3339 offset")
		}
		return parsedInstant.UTC(), nil

	case strings.Contains(normalizedDataType, "timestamp"):
		strValue, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("invalid timestamp value")
		}
		normalizedValue := strings.ReplaceAll(strings.TrimSpace(strValue), "/", "-")
		layouts := []string{
			"2006-01-02",
			"2006-01-02 15:04",
			"2006-01-02 15:04:05.999999999",
			"2006-01-02T15:04",
			"2006-01-02T15:04:05.999999999",
		}
		for _, layout := range layouts {
			if parsedTimestamp, err := time.Parse(layout, normalizedValue); err == nil {
				return parsedTimestamp.Format("2006-01-02 15:04:05.999999999"), nil
			}
		}
		return nil, fmt.Errorf("invalid timestamp format")

	case strings.Contains(normalizedDataType, "numeric"), strings.Contains(normalizedDataType, "decimal"):
		var floatValue float64
		switch v := value.(type) {
		case float64:
			floatValue = v
		case string:
			parsedFloat, err := strconv.ParseFloat(v, 64)
			if err != nil {
				return nil, fmt.Errorf("invalid numeric value")
			}
			floatValue = parsedFloat
		default:
			return nil, fmt.Errorf("invalid numeric value")
		}
		return floatValue, nil

	default:
		// Jos ei osuta mihinkään, palautetaan sellaisenaan
		return value, nil
	}
}
