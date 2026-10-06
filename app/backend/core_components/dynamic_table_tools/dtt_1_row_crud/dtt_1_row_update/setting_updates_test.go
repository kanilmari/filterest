// setting_updates_test.go
// Refuses invalid and renamed setting candidates through the real update handler.
// Reuses the existing SQL queue and signed-in request builders.
// Exists to prove a later field cannot bypass the preflight or lose its refusal key.
package dtt_1_row_update

import (
	"database/sql/driver"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/core_components/dbutils"
)

func TestSettingUpdateHandlerRefusesCompleteCandidateBeforeWriting(t *testing.T) {
	for _, body := range []string{
		`{"id":4,"column":"json_value","value":{"limit_enabled":true,"limit_amount":2,"limit_unit":"unknown"}}`,
		`{"id":4,"updates":[{"column":"text_value","value":"must not write"},{"column":"json_value","value":null}]}`,
		`{"id":4,"column":"key","value":"absolute_sign_in_limit"}`,
	} {
		tx := openUpdRowTx(t, []queuedQuery{
			{cols: []string{"id"}, rows: [][]driver.Value{{int64(4)}}},
			{cols: []string{"row"}, rows: [][]driver.Value{{[]byte(`{"id":4,"key":"absolute_sign_in_limit","value_type":5,"json_value":{"limit_enabled":true,"limit_amount":2,"limit_unit":"unknown"}}`)}}},
		})
		req := buildUpdateRowSessionRequest(t, "POST", "/", body)
		rec := httptest.NewRecorder()
		UpdateRowHandler(rec, req.WithContext(dbutils.SetTx(req.Context(), tx)), "system_config")
		if rec.Code != 400 || !strings.Contains(rec.Body.String(), `"error_lang_key":"error_setting_duration_invalid"`) {
			t.Fatalf("%d %s", rec.Code, rec.Body)
		}
	}
}
