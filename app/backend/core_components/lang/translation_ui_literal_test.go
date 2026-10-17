// translation_ui_literal_test.go
// Exercises the one-query serving rule and association failure boundaries.
// Connects trusted literal rows to unchanged HTTP admission/cache behavior.
// A late iteration failure must discard even rows already read successfully.
package lang

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"testing"
)

func TestTranslationsLiteralSharedBindingsAndOneAssociationQuery(t *testing.T) {
	t.Setenv("DEV_MODE", "false")
	queries := translationQueries(0, false, false, false, 11)
	rows := &queries[len(queries)-1]
	rows.rows = append(rows.rows, []driver.Value{"app_b", "literal_ui", "", int64(0), true})
	state := installTranslationDB(t, queries)
	response := httptest.NewRecorder()
	GetTranslationsHandler(response, translationRequest(t, 0))
	var body map[string]string
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["app_b"] == "" || body["shared_key"] == "" || body["hidden_column"] != "" {
		t.Fatal(body)
	}
	count := 0
	for _, query := range state.queryCalls {
		if query == translationObjectSourcesQuery {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("association query count=%d", count)
	}
	if response.Header().Get("Cache-Control") != "private, no-store" || response.Header().Get("Vary") != "Cookie" {
		t.Fatal(response.Header())
	}
}

func TestTranslationsAssociationFailuresDiscardWholeMap(t *testing.T) {
	for _, failure := range []string{"query", "scan", "iteration"} {
		t.Run(failure, func(t *testing.T) {
			t.Setenv("DEV_MODE", "false")
			queries := translationQueries(0, false, false, false, 11)
			q := &queries[len(queries)-1]
			switch failure {
			case "query":
				q.err = errors.New("association lookup failed")
			case "scan":
				q.rows = append(q.rows, []driver.Value{nil, nil, nil, nil, nil})
			case "iteration":
				q.rowErr = errors.New("late association iteration failed")
			}
			state := installTranslationDB(t, queries)
			response := httptest.NewRecorder()
			GetTranslationsHandler(response, translationRequest(t, 0))
			var body map[string]string
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if len(body) != 0 {
				t.Fatal("partial map leaked", body)
			}
			count := 0
			for _, query := range state.queryCalls {
				if query == translationObjectSourcesQuery {
					count++
				}
			}
			if count != 1 {
				t.Fatal(count)
			}
		})
	}
}
