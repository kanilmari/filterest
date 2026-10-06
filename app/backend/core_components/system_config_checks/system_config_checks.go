// system_config_checks.go
// Owns per-key checks for every generic writer of the settings table.
// Connects transaction-local row candidates to shared duration validation.
// Exists to refuse unusable settings before a writer changes any data.
package system_config_checks

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"

	"easelect/backend/core_components/httpresponse"
	"easelect/backend/reusable_components/setting_duration"
	"easelect/frontend/shared/setting_durations"
	"github.com/lib/pq"
)

const InvalidValueLangKey = "error_setting_duration_invalid"
const SignInLimitKey = "absolute_sign_in_limit"

type check func(map[string]interface{}) error

var durations = setting_durations.Definitions()
var checks = durationChecks()

func durationChecks() map[string]check {
	registry := make(map[string]check, len(durations))
	for key, definition := range durations {
		registry[key] = func(row map[string]interface{}) error {
			if fmt.Sprint(row["value_type"]) != "5" {
				return fmt.Errorf("duration settings require JSON value type 5")
			}
			_, err := setting_duration.Parse(row["json_value"], definition)
			return err
		}
	}
	return registry
}

// DurationDefinition is the same definition the registry and browser use.
func DurationDefinition(key string) (setting_duration.Definition, bool) {
	definition, found := setting_durations.Definitions()[key]
	return definition, found
}

// ValidateRow leaves other tables and unregistered keys unchanged.
func ValidateRow(table string, row map[string]interface{}) error {
	if table != "system_config" {
		return nil
	}
	key, _ := row["key"].(string)
	validate, registered := checks[key]
	if !registered {
		return nil
	}
	if err := validate(row); err != nil {
		return &httpresponse.Refusal{Status: 400, LangKey: InvalidValueLangKey,
			Message: fmt.Sprintf("invalid setting %s: %v", key, err)}
	}
	return nil
}

// RowQuerier must be the writer's transaction, so the lock and write are atomic.
type RowQuerier interface {
	QueryRow(string, ...interface{}) *sql.Row
}

// ValidateUpdate locks and checks the complete resulting row, including a key
// change, before any field is written. It also serves partial CSV upserts.
func ValidateUpdate(q RowQuerier, table string, id int64, changes map[string]interface{}) error {
	if table != "system_config" {
		return nil
	}
	var raw []byte
	err := q.QueryRow(`SELECT to_jsonb(config) FROM public.system_config AS config WHERE id = $1 FOR UPDATE`, id).Scan(&raw)
	if err == sql.ErrNoRows {
		return ValidateRow(table, changes)
	}
	if err != nil {
		return err
	}
	var row map[string]interface{}
	if err := json.Unmarshal(raw, &row); err != nil {
		return err
	}
	for column, value := range changes {
		row[column] = value
	}
	return ValidateRow(table, row)
}

// ValidateInsert checks a full insert or the merged result of an id-based upsert.
func ValidateInsert(q RowQuerier, table string, row map[string]interface{}) error {
	if table != "system_config" {
		return nil
	}
	if rawID, found := row["id"]; found {
		id, err := strconv.ParseInt(fmt.Sprint(rawID), 10, 64)
		if err == nil {
			return ValidateUpdate(q, table, id, row)
		}
	}
	return ValidateRow(table, row)
}

// ValidateMatchingUpdate checks all cache targets inside the writer's transaction.
// A configured cache column can name a setting key or value, so it uses the same
// complete-row check as a direct edit, with locks retained until the caller commits.
func ValidateMatchingUpdate(q interface {
	Query(string, ...interface{}) (*sql.Rows, error)
}, table, referenceColumn string, reference interface{}, changes map[string]interface{}) error {
	if table != "system_config" {
		return nil
	}
	query := fmt.Sprintf(`SELECT to_jsonb(config) FROM public.system_config AS config WHERE %s = $1 ORDER BY id FOR UPDATE`, pq.QuoteIdentifier(referenceColumn))
	rows, err := q.Query(query, reference)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return err
		}
		var row map[string]interface{}
		if err := json.Unmarshal(raw, &row); err != nil {
			return err
		}
		for column, value := range changes {
			row[column] = value
		}
		if err := ValidateRow(table, row); err != nil {
			return err
		}
	}
	return rows.Err()
}
