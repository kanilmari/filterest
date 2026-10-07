// row_delete_archive_postgres_test.go
// Verifies deleting a gallery picture then its parent archives all committed row media.
// Uses the disposable bootstrap fixture and real delete handler with lazy commit hooks.
// Protects recovery copies and proves files move only after each transaction commits.
package runtime_grants_test

import (
	deletes "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_delete"
	assets "easelect/backend/core_components/dynamic_table_tools/dtt_asset_linking"
	"easelect/backend/core_components/media_utils"
	. "easelect/backend/core_components/runtime_grants"
	"easelect/backend/core_components/runtimepaths"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestPictureThenRowDeletionMergesArchivePostgres(t *testing.T) {
	f := newMutationHooksFixture(t)
	const parent = "archive_merge_parent"
	const gallery = parent + "_assets"
	uid := f.create(parent, "")
	f.request(assets.EnableImageAssetLinkingHandler, `{"parent_table":"archive_merge_parent"}`, http.StatusCreated)
	first, second := fmt.Sprintf("%d_1_1.jpg", uid), fmt.Sprintf("%d_1_2.jpg", uid)
	FixtureExec(t, f.owner, `INSERT INTO archive_merge_parent(id,title,cached_image) VALUES(1,'archive merge',$1)`, second)
	FixtureExec(t, f.owner, `INSERT INTO archive_merge_parent_assets(id,archive_merge_parent_id,filename,asset_kind,sort_order,is_primary)
 VALUES(1,1,$1,'image',1,false),(2,1,$2,'image',2,true)`, first, second)
	paths := runtimepaths.Current()
	rowStorage := filepath.Join(paths.StorageRoot, fmt.Sprint(uid), "1")
	rowArchive := filepath.Join(paths.StorageDeletedRoot, fmt.Sprint(uid), "1")
	expectedContents := map[string]int{}
	for _, variant := range media_utils.RequiredSubfolders {
		for _, name := range []string{first, second, "row-attachment.pdf"} {
			content := variant + "/" + name
			path := filepath.Join(rowStorage, variant, name)
			if err := os.MkdirAll(filepath.Dir(path), 0750); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte(content), 0640); err != nil {
				t.Fatal(err)
			}
			expectedContents[content] = 1
		}
	}
	deleteThroughCommit := func(table string, id int) {
		t.Helper()
		f.request(func(w http.ResponseWriter, r *http.Request) {
			deletes.DeleteRowsHandler(w, r, table)
			// The real middleware must still own the commit here. Files stay live
			// during the request and reach the archive in its after-commit hook.
			live := filepath.Join(rowStorage, "original", first)
			if table == parent {
				live = filepath.Join(rowStorage, "original", second)
			}
			if _, err := os.Lstat(live); err != nil {
				t.Fatalf("storage moved before request commit: %v", err)
			}
		}, fmt.Sprintf(`{"ids":[%d]}`, id), http.StatusOK)
	}
	deleteThroughCommit(gallery, 1)
	for _, variant := range media_utils.RequiredSubfolders {
		content, err := os.ReadFile(filepath.Join(rowArchive, variant, first))
		if err != nil || string(content) != variant+"/"+first {
			t.Fatalf("first picture not archived after its delete: %q, %v", content, err)
		}
		if _, err := os.Lstat(filepath.Join(rowStorage, variant, first)); !os.IsNotExist(err) {
			t.Fatalf("deleted picture still live: %v", err)
		}
		if _, err := os.Lstat(filepath.Join(rowStorage, variant, second)); err != nil {
			t.Fatalf("surviving picture moved with its sibling: %v", err)
		}
	}
	// An older recovery copy with the remaining picture's name must survive too.
	if err := os.WriteFile(filepath.Join(rowArchive, "original", second), []byte("earlier recovery copy"), 0640); err != nil {
		t.Fatal(err)
	}
	expectedContents["earlier recovery copy"] = 1
	deleteThroughCommit(parent, 1)
	if _, err := os.Lstat(rowStorage); !os.IsNotExist(err) {
		t.Fatalf("deleted parent left live storage: %v", err)
	}
	for _, table := range []string{parent, gallery} {
		var count int
		if err := f.owner.QueryRow("SELECT count(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("parent delete did not remove %s rows: %d, %v", table, count, err)
		}
	}
	actualContents := map[string]int{}
	if err := filepath.WalkDir(rowArchive, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		content, err := os.ReadFile(path)
		if err == nil {
			actualContents[string(content)]++
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if len(actualContents) != len(expectedContents) {
		t.Fatalf("archive contents = %v, want %v", actualContents, expectedContents)
	}
	for content, count := range expectedContents {
		if actualContents[content] != count {
			t.Fatalf("archive has %d copies of %q, want %d", actualContents[content], content, count)
		}
	}
	content, err := os.ReadFile(filepath.Join(rowArchive, "original", second))
	if err != nil || string(content) != "earlier recovery copy" {
		t.Fatalf("earlier recovery file overwritten: %q, %v", content, err)
	}
}
