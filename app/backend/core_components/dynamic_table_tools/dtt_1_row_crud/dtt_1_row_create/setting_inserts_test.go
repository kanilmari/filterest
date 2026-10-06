// setting_inserts_test.go
// Refuses invalid settings before the main or owned-child INSERT can be reached.
// Connects the existing add-row orchestration and low-level insert boundaries.
// Exists to preserve 400 responses and prove refusal writes nothing.
package dtt_1_row_create

import (
	"context"
	"database/sql/driver"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/core_components/httpresponse"
)

func TestSettingInsertRefusalBeforeAnySQL(t *testing.T) {
	payload := map[string]interface{}{"key": "absolute_sign_in_limit", "value_type": 5, "json_value": `{"limit_enabled":true,"limit_unit":"unknown","limit_amount":1}`}
	rec := httptest.NewRecorder()
	_, _, err := insertDataAccordingToPayload(rec, httptest.NewRequest("POST", "/", nil), "system_config", "1", payload, nil)
	if err == nil || rec.Code != 400 || !strings.Contains(rec.Body.String(), `"error_lang_key":"error_setting_duration_invalid"`) {
		t.Fatalf("%v: %d %s", err, rec.Code, rec.Body)
	}
	_, err = insertMainRow(context.Background(), nil, "system_config", payload, nil)
	var refusal *httpresponse.Refusal
	if !errors.As(err, &refusal) {
		t.Fatalf("main insert: %v", err)
	}
	_, err = insertSingleChildRow(nil, 1, ChildRowPayload{MainReferencedColumn: "id", TableName: "system_config", ReferencingColumn: "int_value", Data: payload}, nil)
	if !errors.As(err, &refusal) {
		t.Fatalf("child insert: %v", err)
	}
	rec = httptest.NewRecorder()
	respondToTriggerExecutionError(rec, "notes", err)
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), refusal.LangKey) {
		t.Fatalf("wrapped trigger: %d %s", rec.Code, rec.Body)
	}
}

func TestConfiguredCacheCannotWriteInvalidSetting(t *testing.T) {
	t.Cleanup(resetQueues)
	db := newTestDB(t)
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	specs := buildFileUploadSpecs("filename", []map[string]string{{"table": "system_config", "column": "json_value"}})
	pushQuery(queuedQuery{cols: []string{"target_insert_specs", "target_table_name", "target_column_name"}, rows: [][]driver.Value{{specs, "system_config", "id"}}})
	pushQuery(queuedQuery{cols: []string{"config"}, rows: [][]driver.Value{{[]byte(`{"key":"absolute_sign_in_limit","value_type":5,"json_value":{"limit_enabled":true,"limit_unit":"days","limit_amount":30}}`)}}})
	err = updateCacheTargets(tx, "pictures", "parent_id", map[string]interface{}{"filename": "invalid.json", "parent_id": int64(1)})
	var refusal *httpresponse.Refusal
	if !errors.As(err, &refusal) || refusal.Status != 400 {
		t.Fatalf("cache write: %v", err)
	}
}
