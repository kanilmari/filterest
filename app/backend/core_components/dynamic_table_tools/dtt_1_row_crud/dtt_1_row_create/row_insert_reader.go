// row_insert_reader.go
// Reads metadata needed during row insertion: user identity, table UIDs, and column types.
// Bridges the session, system_db_tables, and the add-row insertion logic.
// Exists to pre-load context (user, table UID, date/int classification) before INSERT execution.
package dtt_1_row_create

import (
	"strconv"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	e_sessions "easelect/backend/core_components/sessions"
)

// getTableUID hakee table_uid-arvon system_db_tables-taulusta
// Between: AddRowMultipartHandler -> Database
// Why: Retrieves the table UID for a given table name.
func getTableUID(tableName string, q rowQueryer) (string, error) {
	var foundUID string
	query := `SELECT table_uid FROM system_db_tables WHERE table_name = $1`
	err := q.QueryRow(query, tableName).Scan(&foundUID)
	if err != nil {
		return "", err
	}
	return foundUID, nil
}

// getTableNameFromUID returns table_name from system_db_tables for the given UID.
// Between: AddRowMultipartHandlerWrapper -> Database
// Why: Retrieves the table name for a given table UID.
func getTableNameFromUID(tableUID string, q rowQueryer) (string, error) {
	var name string
	query := `SELECT table_name FROM system_db_tables WHERE table_uid = $1`
	if err := q.QueryRow(query, tableUID).Scan(&name); err != nil {
		return "", err
	}
	return name, nil
}

// isDateLikeType tarkistaa, onko sarakkeen tietotyyppi date/timestamp
// Between: insertDataAccordingToPayload -> Logic
// Why: Helper to identify date/timestamp columns.
func isDateLikeType(dataType string) bool {
	dataType = strings.ToLower(dataType)
	return strings.Contains(dataType, "date") ||
		strings.Contains(dataType, "timestamp")
}

// isIntegerType on apu-funktio integer-tyypin tunnistamiseen
// Between: insertDataAccordingToPayload -> Logic
// Why: Helper to identify integer columns.
func isIntegerType(dataType string) bool {
	dataType = strings.ToLower(dataType)
	return strings.Contains(dataType, "int")
}

// isDecimalType recognises the exact-decimal columns, which a form sends as
// text like an integer does but which strconv.Atoi cannot parse.
// Between: insertDataAccordingToPayload -> Logic
// Why: A price of 22.39 is not an integer and is not text either.
func isDecimalType(dataType string) bool {
	dataType = strings.ToLower(strings.TrimSpace(dataType))
	return strings.HasPrefix(dataType, "numeric") ||
		strings.HasPrefix(dataType, "decimal") ||
		dataType == "real" ||
		strings.HasPrefix(dataType, "double")
}

// normalizeDecimalInsertValue prepares one value for an exact-decimal column.
// An empty form field is missing data, exactly as it is for a date, a JSON
// value or an integer; the database refuses the empty text it would otherwise
// receive. A column that forbids NULL keeps the zero its integer sibling uses.
// Between: insertDataAccordingToPayload -> Database
// Why: Keeps an empty price an understood absence rather than a 500.
func normalizeDecimalInsertValue(value interface{}, nullable bool) (interface{}, error) {
	text, isText := value.(string)
	if !isText {
		return value, nil
	}
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		if nullable {
			return nil, nil
		}
		return "0", nil
	}
	// The database does the conversion; this only refuses what it would refuse
	// anyway, so the person is told which column rather than reading pq's text.
	if _, err := strconv.ParseFloat(strings.Replace(trimmed, ",", ".", 1), 64); err != nil {
		return nil, fmt.Errorf("the value is not a number")
	}
	return strings.Replace(trimmed, ",", ".", 1), nil
}

// isJSONType tunnistaa json/jsonb-sarakkeet
// Between: insertDataAccordingToPayload -> Logic
// Why: Helper to identify JSON columns, whose form values arrive as text.
func isJSONType(dataType string) bool {
	dataType = strings.ToLower(strings.TrimSpace(dataType))
	return dataType == "json" || dataType == "jsonb"
}

// normalizeJSONInsertValue prepares one value for a JSON column. An empty form
// field is missing data, so a nullable column keeps NULL instead of storing the
// empty text the database refuses. Structured values are encoded as JSON text,
// and text that is not JSON is reported by column name instead of failing the
// whole insert with a database-level message.
// Between: insertDataAccordingToPayload -> Database
// Why: Keeps a JSON column's bad value an understandable request error.
func normalizeJSONInsertValue(value interface{}, nullable bool) (interface{}, error) {
	switch typed := value.(type) {
	case nil:
		return nil, nil
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			if nullable {
				return nil, nil
			}
			return nil, fmt.Errorf("a JSON value is required")
		}
		if !json.Valid([]byte(trimmed)) {
			return nil, fmt.Errorf("the value is not JSON")
		}
		return trimmed, nil
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return nil, fmt.Errorf("the value is not JSON")
		}
		return string(encoded), nil
	}
}

// getCurrentUserID hakee sessiosta user_id:n (int) tai virheen
// Between: insertDataAccordingToPayload -> Session
// Why: Retrieves the current user's ID from the session.
func getCurrentUserID(r *http.Request) (int, error) {
	session, err := e_sessions.GetOrCreateSession(nil, r)
	if err != nil {
		fmt.Printf("\033[31merror: session get error: %s\033[0m\n", err.Error())
		return 0, fmt.Errorf("session get error: %v", err)
	}
	rawUserID, ok := session.Values["user_id"]
	if !ok {
		fmt.Printf("\033[31merror: user ID missing from session\033[0m\n")
		return 0, fmt.Errorf("user ID missing from session")
	}
	userID, ok := rawUserID.(int)
	if !ok {
		fmt.Printf("\033[31merror: user ID invalid type in session\033[0m\n")
		return 0, fmt.Errorf("user ID invalid type in session")
	}
	return userID, nil
}

// getCurrentUsername hakee sessiosta "username"-arvon (string) tai virheen
// Between: insertDataAccordingToPayload -> Session
// Why: Retrieves the current user's username from the session.
func getCurrentUsername(r *http.Request) (string, error) {
	session, err := e_sessions.GetOrCreateSession(nil, r)
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		return "", fmt.Errorf("session get error: %v", err)
	}
	rawUsername, ok := session.Values["username"]
	if !ok {
		fmt.Printf("\033[31merror: username missing from session\033[0m\n")
		return "", fmt.Errorf("username missing from session")
	}
	username, ok := rawUsername.(string)
	if !ok {
		fmt.Printf("\033[31merror: username invalid type in session\033[0m\n")
		return "", fmt.Errorf("username invalid type in session")
	}
	return username, nil
}

// mustJSON marshals an interface to JSON bytes, ignoring errors (for internal use).
func mustJSON(v interface{}) []byte {
	b, _ := json.Marshal(v)
	return b
}
