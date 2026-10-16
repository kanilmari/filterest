// tree_label_source_test.go
// Checks source ownership failures at the tree rename persistence boundary.
// Connects new and existing folder/dataset keys to transactional associations.
// Prevents a successful rename response from leaving its label unbound.
package dtt_system_table_folders

import (
	"database/sql/driver"
	"errors"
	"testing"
)

func TestTreeRenameRequiresLabelAssociation(t *testing.T) {
	for _, itemType := range []string{"folder", "table"} {
		for _, existing := range []bool{false, true} {
			t.Run(itemType+map[bool]string{false: "/new", true: "/existing"}[existing], func(t *testing.T) {
				lookup := folderQueryResponse{match: "SELECT id FROM system_lang_keys", cols: []string{"id"}}
				if existing {
					lookup.rows = [][]driver.Value{{int64(19)}}
				}
				failure := errors.New("injected association failure")
				db, _ := openFolderMockDB(t, []folderQueryResponse{lookup,
					{match: "INSERT INTO system_lang_keys", cols: []string{"id"}, rows: [][]driver.Value{{int64(19)}}}},
					[]folderExecResponse{{match: "UPDATE system_lang_keys", rowsAffected: 1},
						{match: "INSERT INTO system_lang_key_sources", err: failure}})
				tx, err := db.Begin()
				if err != nil {
					t.Fatal(err)
				}
				defer tx.Rollback()
				if err := upsertLangKey(tx, "same_name", "same_name", itemType, map[string]string{"en": "Label"}); !errors.Is(err, failure) {
					t.Fatal("rename accepted missing association", err)
				}
			})
		}
	}
}

func TestTreeRenamePersistsObjectAssociation(t *testing.T) {
	for _, kind := range []string{"folder", "table"} {
		t.Run(kind, func(t *testing.T) {
			db, state := openFolderMockDB(t, []folderQueryResponse{
				{match: "SELECT id FROM system_lang_keys", cols: []string{"id"}},
				{match: "INSERT INTO system_lang_keys", cols: []string{"id"}, rows: [][]driver.Value{{int64(19)}}},
			}, []folderExecResponse{{match: "INSERT INTO system_lang_key_sources", rowsAffected: 1}})
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback()
			if err := upsertLangKey(tx, "old_name", "renamed_label", kind, map[string]string{"en": "Label"}); err != nil {
				t.Fatal(err)
			}
			if len(state.calls) != 1 {
				t.Fatal("missing source write", state.calls)
			}
			args := state.calls[0].args
			if len(args) != 3 || args[0].Value != int64(19) || args[1].Value != kind || args[2].Value != "renamed_label" {
				t.Fatal("label associated with the wrong object", args)
			}
		})
	}
}
