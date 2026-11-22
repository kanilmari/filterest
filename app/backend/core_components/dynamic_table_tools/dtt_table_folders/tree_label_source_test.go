// tree_label_source_test.go
// Checks source ownership failures at the tree rename persistence boundary.
// Connects folder and dataset renames to the language component's transactional association.
// Prevents a successful rename response from leaving its label unbound.
package dtt_system_table_folders

import (
	"database/sql/driver"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"easelect/backend/core_components/runtime_grants/granttest"
)

// labelMockQueries answers the language component's reads: the old name's key exists (id 11)
// with one Finnish column and no rows, and the new name has no key until it is created (id 19).
func labelMockQueries(oldName, newName string) []folderQueryResponse {
	return []folderQueryResponse{
		{match: "lang_key_type, creation_spec", args: []driver.Value{oldName},
			cols: []string{"id", "fi", "en", "ch", "yue", "lang_key_type", "creation_spec"},
			rows: [][]driver.Value{{int64(11), "Vanha", nil, nil, nil, nil, nil}}},
		{match: "lang_key_type, creation_spec", args: []driver.Value{newName},
			cols: []string{"id", "fi", "en", "ch", "yue", "lang_key_type", "creation_spec"}},
		{match: "FROM system_lang_key_translations", cols: []string{"language_code", "translation", "source_kind", "review_status"}},
		{match: "INSERT INTO system_lang_keys (lang_key, created, updated)", cols: []string{"id"}, rows: [][]driver.Value{{int64(19)}}},
		{match: "SELECT id FROM system_lang_keys WHERE lang_key", cols: []string{"id"}, rows: [][]driver.Value{{int64(19)}}},
	}
}

func TestTreeRenameRequiresLabelAssociation(t *testing.T) {
	failure := errors.New("injected association failure")
	// Each association step must fail the rename: moving the old source, and recording the new one.
	for step, match := range map[string]string{
		"move":   "SELECT $1, source_type, $2, $2, usage_explanation",
		"record": "VALUES ($1, $2, $3, $3, CURRENT_DATE)",
	} {
		t.Run("folder/"+step, func(t *testing.T) {
			queries := append(labelMockQueries("old_folder", "new_folder"),
				folderQueryResponse{match: "SELECT folder_name FROM system_table_folders", cols: []string{"folder_name"}, rows: [][]driver.Value{{"old_folder"}}},
				folderQueryResponse{match: "SELECT EXISTS (SELECT 1 FROM system_table_folders", cols: []string{"exists"}, rows: [][]driver.Value{{false}}})
			db, state := openFolderMockDB(t, queries, []folderExecResponse{
				{match: match, err: failure},
				{match: "UPDATE system_table_folders", rowsAffected: 1},
				{match: "system_lang_keys", rowsAffected: 1},
				{match: "system_lang_key_translations", rowsAffected: 1},
				{match: "system_lang_key_sources", rowsAffected: 1}})
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			_, err = renameFolder(tx, RenameTreeNodeRequest{ItemID: 4, ItemType: "folder", NewName: "new_folder",
				Translations: map[string]string{"en": "Label"}})
			if !errors.Is(err, failure) {
				t.Fatal("rename accepted missing association", err)
			}
			if last := state.calls[len(state.calls)-1].query; !strings.Contains(last, match) {
				t.Fatal("the injected step was not the one that failed", last)
			}
		})
		t.Run("table/"+step, func(t *testing.T) {
			queries := append(labelMockQueries("old_table", "new_table"),
				folderQueryResponse{match: "SELECT table_name FROM system_db_tables", cols: []string{"table_name"}, rows: [][]driver.Value{{"old_table"}}},
				folderQueryResponse{match: "SELECT to_regclass('public.system_triggers')", cols: []string{"present"}, rows: [][]driver.Value{{false}}})
			db, state := openFolderMockDB(t, queries, []folderExecResponse{
				{match: match, err: failure},
				{match: "ALTER TABLE", rowsAffected: 0},
				{match: "UPDATE system_db_tables", rowsAffected: 1},
				{match: "system_lang_keys", rowsAffected: 1},
				{match: "system_lang_key_translations", rowsAffected: 1},
				{match: "system_lang_key_sources", rowsAffected: 1}})
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			_, err = renameTable(tx, RenameTreeNodeRequest{ItemID: 5, ItemType: "table", NewName: "new_table"})
			if !errors.Is(err, failure) {
				t.Fatal("rename accepted missing association", err)
			}
			if last := state.calls[len(state.calls)-1].query; !strings.Contains(last, match) {
				t.Fatal("the injected step was not the one that failed", last)
			}
		})
	}
}

func TestTreeRenameMovesOnlyTheItemsOwnSource(t *testing.T) {
	for _, stillUsed := range []bool{false, true} {
		name := map[bool]string{false: "only folder of that name", true: "another folder keeps the old name"}[stillUsed]
		t.Run(name, func(t *testing.T) {
			queries := append(labelMockQueries("old_folder", "new_folder"),
				folderQueryResponse{match: "SELECT folder_name FROM system_table_folders", cols: []string{"folder_name"}, rows: [][]driver.Value{{"old_folder"}}},
				folderQueryResponse{match: "SELECT EXISTS (SELECT 1 FROM system_table_folders", cols: []string{"exists"}, rows: [][]driver.Value{{stillUsed}}})
			db, state := openFolderMockDB(t, queries, []folderExecResponse{
				{match: "UPDATE system_table_folders", rowsAffected: 1},
				{match: "system_lang_keys", rowsAffected: 1},
				{match: "system_lang_key_sources", rowsAffected: 1}})
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			if _, err := renameFolder(tx, RenameTreeNodeRequest{ItemID: 4, ItemType: "folder", NewName: "new_folder"}); err != nil {
				t.Fatal(err)
			}
			var moved, released, rewritten, ensured bool
			for _, call := range state.calls {
				switch {
				case strings.Contains(call.query, "INSERT INTO system_lang_key_sources") && strings.Contains(call.query, "SELECT $1, source_type"):
					moved = true
				case strings.Contains(call.query, "DELETE FROM system_lang_key_sources"):
					released = true
					if call.args[0].Value != int64(11) || call.args[2].Value != "old_folder" {
						t.Fatal("released the wrong association", call.args)
					}
				case strings.Contains(call.query, "SET source_high = $2, last_seen = CURRENT_DATE") && strings.Contains(call.query, "source_type = 'folder'"):
					rewritten = true
				case strings.Contains(call.query, "VALUES ($1, $2, $3, $3, CURRENT_DATE)"):
					ensured = true
					if call.args[0].Value != int64(19) || call.args[1].Value != "folder" || call.args[2].Value != "new_folder" {
						t.Fatal("label associated with the wrong object", call.args)
					}
				case strings.Contains(call.query, "UPDATE system_lang_keys SET lang_key"), strings.Contains(call.query, "SET lang_key ="):
					t.Fatal("the shared old key was renamed", call.query)
				}
			}
			if moved == stillUsed || released == stillUsed || rewritten == stillUsed || !ensured {
				t.Fatal("source ownership", moved, released, rewritten, ensured)
			}
		})
	}
}

// existingKeyQueries answer the language reads when the new name's key already exists with its
// own English text (id 12) and the old folder's key has only Finnish (id 11).
func existingKeyQueries() []folderQueryResponse {
	return []folderQueryResponse{
		{match: "SELECT folder_name FROM system_table_folders", cols: []string{"folder_name"}, rows: [][]driver.Value{{"old_folder"}}},
		{match: "SELECT EXISTS (SELECT 1 FROM system_table_folders", cols: []string{"exists"}, rows: [][]driver.Value{{false}}},
		{match: "lang_key_type, creation_spec", args: []driver.Value{"old_folder"},
			cols: []string{"id", "fi", "en", "ch", "yue", "lang_key_type", "creation_spec"},
			rows: [][]driver.Value{{int64(11), "Vanha", nil, nil, nil, nil, nil}}},
		{match: "lang_key_type, creation_spec", args: []driver.Value{"new_folder"},
			cols: []string{"id", "fi", "en", "ch", "yue", "lang_key_type", "creation_spec"},
			rows: [][]driver.Value{{int64(12), nil, "Purchase orders", nil, nil, nil, nil}}},
		{match: "FROM system_lang_key_translations", cols: []string{"language_code", "translation", "source_kind", "review_status"}},
	}
}

func TestTreeRenameRefusesUnsupportedLanguageWithoutWriting(t *testing.T) {
	db, state := openFolderMockDB(t, existingKeyQueries(), []folderExecResponse{{match: "UPDATE system_table_folders", rowsAffected: 1}})
	req := withFolderTx(httptest.NewRequest(http.MethodPost, "/api/rename-tree-node",
		strings.NewReader(`{"item_id":4,"item_type":"folder","new_name":"new_folder","translations":{"yue":"報告"}}`)), db)
	rec := httptest.NewRecorder()
	HandleRenameTreeNode(granttest.Recorder{ResponseRecorder: rec}, req)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "unsupported languages yue") {
		t.Fatal(rec.Code, rec.Body.String())
	}
	// Only the folder row was written before the refusal; the request transaction middleware
	// rolls it back for every non-2xx answer.
	for _, call := range state.calls {
		if strings.Contains(call.query, "system_lang_") {
			t.Fatal("a refused label wrote language data:", call.query)
		}
	}
}

// Owner, 22.11.2026: "Älä muuta jaettua avainta". The rename succeeds, the existing key keeps its
// English, and the answer names the languages whose typed text was not saved.
func TestTreeRenameOntoAnExistingKeyReportsTheKeptText(t *testing.T) {
	db, state := openFolderMockDB(t, existingKeyQueries(), []folderExecResponse{
		{match: "UPDATE system_table_folders", rowsAffected: 1},
		{match: "system_lang_keys", rowsAffected: 1},
		{match: "system_lang_key_translations", rowsAffected: 1},
		{match: "system_lang_key_sources", rowsAffected: 1}})
	req := withFolderTx(httptest.NewRequest(http.MethodPost, "/api/rename-tree-node",
		strings.NewReader(`{"item_id":4,"item_type":"folder","new_name":"new_folder","translations":{"fi":"Vanha","en":"Orders"},"shown_translations":{"fi":"Vanha","en":""}}`)), db)
	rec := httptest.NewRecorder()
	HandleRenameTreeNode(granttest.Recorder{ResponseRecorder: rec}, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"label_kept":{"lang_key":"new_folder","languages":["en"]}`) {
		t.Fatal(rec.Code, rec.Body.String())
	}
	for _, call := range state.calls {
		if strings.Contains(call.query, "INSERT INTO system_lang_keys (lang_key, fi, en") {
			t.Fatal("the dialog's text was written into the shared key:", call.query)
		}
		if strings.Contains(call.query, "UPDATE system_lang_keys") && len(call.args) > 2 && call.args[2].Value != nil {
			t.Fatal("the existing English was replaced:", call.args)
		}
	}
}
