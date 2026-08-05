// notification_triggers.go
// Manages and executes system triggers stored in the system_triggers table.
// Provides HTTP handlers for listing and creating triggers, and engine
// functions for evaluating conditions and inserting rows into target tables.

package dtt_triggers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"

	"github.com/lib/pq"
)

type queryer interface {
	Query(query string, args ...interface{}) (*sql.Rows, error)
	QueryRow(query string, args ...interface{}) *sql.Row
	Exec(query string, args ...interface{}) (sql.Result, error)
}

// GetTriggersHandler lukee kaikki herätteet (GET /api/system_triggers/list)
func GetTriggersHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	tx, ok := dbutils.GetTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction missing")
		return
	}

	triggers, err := fetchAllTriggers(tx)
	if err != nil {
		log.Printf("error fetching triggers: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error fetching triggers")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(triggers); err != nil {
		log.Printf("error encoding response: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error encoding response")
	}
}

// CreateTriggerHandler luo uuden herätteen (POST /api/system_triggers/create)
func CreateTriggerHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	tx, ok := dbutils.GetTx(r.Context())
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "transaction missing")
		return
	}

	trigger, err := decodeTriggerRequest(r)
	if err != nil {
		log.Printf("error decoding data: %v", err)
		httpresponse.RespondWithError(w, http.StatusBadRequest, "invalid data")
		return
	}

	if err := insertTriggerIntoDB(tx, trigger); err != nil {
		log.Printf("error saving trigger: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "error saving trigger")
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Heräte luotu onnistuneesti",
	})
}

// Trigger on struct, jolla vastaanotetaan JSON-dataa (source_table, condition, jne.)
type Trigger struct {
	SourceTable  string `json:"source_dataset"`
	Condition    string `json:"condition"`
	TargetTable  string `json:"target_dataset"`
	ActionValues string `json:"action_values"`
}

// decodeTriggerRequest lukee HTTP-pyynnön rungosta JSONin ja palauttaa Trigger-olion
func decodeTriggerRequest(r *http.Request) (*Trigger, error) {
	var trigger Trigger
	if err := json.NewDecoder(r.Body).Decode(&trigger); err != nil {
		return nil, err
	}
	return &trigger, nil
}

// insertTriggerIntoDB tallettaa uuden herätteen system_triggers -tauluun
func insertTriggerIntoDB(q queryer, trigger *Trigger) error {
	query := `
        INSERT INTO system_triggers (source_table, condition, target_table, action_values)
        VALUES ($1, $2, $3, $4)
    `
	_, err := q.Exec(query, trigger.SourceTable, trigger.Condition, trigger.TargetTable, trigger.ActionValues)
	return err
}

// fetchAllTriggers lukee kaikki system_triggers -taulun rivit
func fetchAllTriggers(q queryer) ([]map[string]interface{}, error) {
	query := `
        SELECT id, source_table, condition, target_table, action_values
        FROM system_triggers
    `
	rows, err := q.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var triggers []map[string]interface{}
	for rows.Next() {
		var id int
		var sourceTable, condition, targetTable, actionValues string

		if err := rows.Scan(&id, &sourceTable, &condition, &targetTable, &actionValues); err != nil {
			return nil, err
		}

		trigger := map[string]interface{}{
			"id":            id,
			"source_table":  sourceTable,
			"condition":     condition,
			"target_table":  targetTable,
			"action_values": actionValues,
		}

		triggers = append(triggers, trigger)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows iteration error in fetchAllTriggers: %w", err)
	}
	return triggers, nil
}

// ---------------------------------------------------------------------
// Seuraavat funktiot liittyvät herätteiden suorittamiseen. Näitä kutsutaan,
// kun tauluun on lisätty uusi rivi, ja halutaan tarkistaa, aktivoituuko jokin heräte
// ---------------------------------------------------------------------

// ExecuteTriggers käy läpi system_triggers -taulusta ne herätteet,
// jotka on määritelty ko. taululle (tableName), ja suorittaa ne jos ehto täyttyy
func ExecuteTriggers(q queryer, tableName string, newRow map[string]interface{}) error {
	log.Printf("Executing triggers for table: %s", tableName)

	available, err := triggerTableAvailable(q)
	if err != nil {
		return fmt.Errorf("check system_triggers availability: %w", err)
	}
	if !available {
		log.Printf("Skipping triggers for table %s: system_triggers is not installed", tableName)
		return nil
	}

	triggers, err := fetchTriggersForTable(q, tableName)
	if err != nil {
		return err
	}

	log.Printf("Found %d triggers for table %s", len(triggers), tableName)

	for _, trigger := range triggers {
		log.Printf("Processing trigger ID: %d, Condition: %s", trigger.ID, trigger.Condition)
		conditionMet, err := evaluateCondition(q, trigger.Condition, newRow)
		if err != nil {
			log.Printf("error evaluating condition for trigger %d: %v", trigger.ID, err)
			continue
		}

		log.Printf("Condition met: %t for trigger ID: %d", conditionMet, trigger.ID)

		if conditionMet {
			err = executeAction(q, trigger.TargetTable, trigger.ActionValues, newRow)
			if err != nil {
				log.Printf("error executing action for trigger %d: %v", trigger.ID, err)
				continue
			}
			log.Printf("Action executed successfully for trigger ID: %d", trigger.ID)
		}
	}
	return nil
}

// triggerTableAvailable checks the optional trigger capability without querying
// the table itself. PostgreSQL's to_regclass returns NULL for a missing table,
// so triggerless public installations stay usable without aborting a transaction.
func triggerTableAvailable(q queryer) (bool, error) {
	var available bool
	if err := q.QueryRow(`SELECT pg_catalog.to_regclass('public.system_triggers') IS NOT NULL`).Scan(&available); err != nil {
		return false, err
	}
	return available, nil
}

// DBTrigger on rakenteena sama kuin system_triggers-taulun rivit (paitsi ID).
type DBTrigger struct {
	ID           int
	Condition    string
	TargetTable  string
	ActionValues string
}

// fetchTriggersForTable hakee system_triggers-taulusta tietyssä taulussa "lähdetauluna" olevat herätteet
func fetchTriggersForTable(q queryer, tableName string) ([]DBTrigger, error) {
	query := `
        SELECT id, condition, target_table, action_values
        FROM system_triggers
        WHERE source_table = $1
    `
	rows, err := q.Query(query, tableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var triggers []DBTrigger
	for rows.Next() {
		var trigger DBTrigger
		if err := rows.Scan(&trigger.ID, &trigger.Condition, &trigger.TargetTable, &trigger.ActionValues); err != nil {
			return nil, err
		}
		triggers = append(triggers, trigger)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows iteration error in fetchTriggersForTable: %w", err)
	}
	return triggers, nil
}

// evaluateCondition pilkkoo "mycolumn = 'foo'" -tyylisen ehdon ja vertailee newRow:n arvoon
func evaluateCondition(q queryer, conditionStr string, row map[string]interface{}) (bool, error) {
	var creationSpec string
	err := q.QueryRow("SHOW myapp.trigger_session_var").Scan(&creationSpec)
	if err == nil && creationSpec == "trigger" {
		// Jos sessiomuuttuja on "trigger", estetään uudelleenkäynnistys
		return false, nil
	}

	column, operator, valueStr, err := parseCondition(conditionStr)
	if err != nil {
		return false, err
	}

	rowValue, exists := row[column]
	if !exists {
		return false, fmt.Errorf("column %s not found in row", column)
	}

	// Poistetaan mahdolliset lainausmerkit valueStr:stä
	valueStr = strings.Trim(valueStr, "'")

	switch operator {
	case "=", "!=", "ILIKE", "NOT ILIKE":
		return compareStringValues(rowValue, valueStr, operator)
	case ">", "<", ">=", "<=":
		return compareNumericValues(rowValue, valueStr, operator)
	default:
		return false, fmt.Errorf("unknown operator %s", operator)
	}
}

// parseCondition pilkkoo esim. "colname = 'foo bar'" -> (colname, =, 'foo bar')
func parseCondition(conditionStr string) (column, operator, valueStr string, err error) {
	parts := strings.Fields(conditionStr)
	if len(parts) < 3 {
		err = fmt.Errorf("invalid condition: %s", conditionStr)
		return
	}
	column = parts[0]
	operator = parts[1]
	valueStr = strings.Join(parts[2:], " ")
	return
}

// compareStringValues vertailee merkkijonomuotoisia arvoja (esim. =, !=, ILIKE, NOT ILIKE)
func compareStringValues(rowValue interface{}, valueStr, operator string) (bool, error) {
	rowValueStr := fmt.Sprintf("%v", rowValue)
	switch operator {
	case "=":
		return rowValueStr == valueStr, nil
	case "!=":
		return rowValueStr != valueStr, nil
	case "ILIKE":
		// toteutetaan "case-insensitive" -vertailu
		return strings.EqualFold(rowValueStr, valueStr), nil
	case "NOT ILIKE":
		return !strings.EqualFold(rowValueStr, valueStr), nil
	default:
		return false, fmt.Errorf("unknown operator %s", operator)
	}
}

// compareNumericValues vertailee numeerisia arvoja (esim. >, <, >=, <=)
func compareNumericValues(rowValue interface{}, valueStr, operator string) (bool, error) {
	rowValueFloat, err := toFloat64(rowValue)
	if err != nil {
		return false, err
	}
	conditionValueFloat, err := strconv.ParseFloat(valueStr, 64)
	if err != nil {
		return false, err
	}
	switch operator {
	case ">":
		return rowValueFloat > conditionValueFloat, nil
	case "<":
		return rowValueFloat < conditionValueFloat, nil
	case ">=":
		return rowValueFloat >= conditionValueFloat, nil
	case "<=":
		return rowValueFloat <= conditionValueFloat, nil
	default:
		return false, fmt.Errorf("unknown operator %s", operator)
	}
}

// toFloat64 auttaa muuntamaan rivin arvon float64-tyyppiin
func toFloat64(value interface{}) (float64, error) {
	switch v := value.(type) {
	case float64:
		return v, nil
	case float32:
		return float64(v), nil
	case int:
		return float64(v), nil
	case int64:
		return float64(v), nil
	case int32:
		return float64(v), nil
	case json.Number:
		return v.Float64()
	case string:
		return strconv.ParseFloat(v, 64)
	default:
		return 0, fmt.Errorf("cannot convert value %v to float64", value)
	}
}

// executeAction rakentaa INSERT-lauseen ja tallettaa actionValues:n targetTableen
func executeAction(q queryer, targetTable, actionValuesStr string, sourceRow map[string]interface{}) error {
	actionValues, err := parseActionValues(actionValuesStr, sourceRow)
	if err != nil {
		return err
	}

	// Varmuuden vuoksi tarkistetaan, onko trigger_session_var jo "trigger"
	var creationSpec string
	err = q.QueryRow("SHOW myapp.trigger_session_var").Scan(&creationSpec)
	if err == nil && creationSpec == "trigger" {
		// Jos jo "trigger", estetään moninkertainen laukeaminen
		return err
	}

	columns, placeholders, values := buildInsertParameters(actionValues)
	insertQuery := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
		pq.QuoteIdentifier(targetTable),
		strings.Join(columns, ", "),
		strings.Join(placeholders, ", "))

	_, execErr := q.Exec(insertQuery, values...)
	return execErr
}

// parseActionValues käy action_values -JSONin läpi ja korvaa {{colName}} -viittaukset newRow:n arvoihin
func parseActionValues(actionValuesStr string, sourceRow map[string]interface{}) (map[string]interface{}, error) {
	var actionValues map[string]interface{}
	err := json.Unmarshal([]byte(actionValuesStr), &actionValues)
	if err != nil {
		return nil, err
	}

	for key, val := range actionValues {
		if strVal, ok := val.(string); ok {
			if strings.HasPrefix(strVal, "{{") && strings.HasSuffix(strVal, "}}") {
				columnName := strings.TrimSuffix(strings.TrimPrefix(strVal, "{{"), "}}")
				if sourceVal, exists := sourceRow[columnName]; exists {
					actionValues[key] = sourceVal
				} else {
					return nil, fmt.Errorf("column %s not found in source row", columnName)
				}
			}
		}
	}
	return actionValues, nil
}

// buildInsertParameters luo listat sarakkeista, placeholdereista ($1, $2, ...) ja arvoista
func buildInsertParameters(actionValues map[string]interface{}) ([]string, []string, []interface{}) {
	var columns []string
	var placeholders []string
	var values []interface{}

	i := 1
	for col, val := range actionValues {
		columns = append(columns, pq.QuoteIdentifier(col))
		placeholders = append(placeholders, fmt.Sprintf("$%d", i))
		values = append(values, val)
		i++
	}
	return columns, placeholders, values
}
