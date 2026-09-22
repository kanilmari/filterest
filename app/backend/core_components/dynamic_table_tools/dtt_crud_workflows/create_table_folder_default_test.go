// create_table_folder_default_test.go
// Verifies where a new dataset goes and what the creator is told about it.
// Covers the default folder (the current project's, else database /
// other_tables), a new folder that has a parent but no name, and the folder
// path and navigation visibility the create response reports.
// Exists because a dataset created on fintravel.fi landed unnoticed in
// database / other_tables, which the site navigation does not list.
package dtt_crud_workflows

import (
	"database/sql/driver"
	"errors"
	"testing"
)

func TestResolveCreateTableFolderID_UsesCurrentProjectFolderByDefault(t *testing.T) {
	db := newWorkflowQueueTestDB(t)
	defer db.Close()
	pushWorkflowQuery(queuedWorkflowQuery{cols: []string{"id"}, rows: [][]driver.Value{{int64(10000)}}})

	folderID, err := resolveCreateTableFolderID(db, CreateTableRequest{})
	if err != nil {
		t.Fatalf("resolveCreateTableFolderID returned error: %v", err)
	}
	if folderID != 10000 {
		t.Fatalf("folder id = %d, want the current project folder 10000", folderID)
	}
}

func TestResolveCreateTableFolderID_KeepsAnExplicitChoice(t *testing.T) {
	db := newWorkflowQueueTestDB(t)
	defer db.Close()
	pushWorkflowQuery(queuedWorkflowQuery{cols: []string{"exists"}, rows: [][]driver.Value{{true}}})

	chosen := 14
	folderID, err := resolveCreateTableFolderID(db, CreateTableRequest{FolderID: &chosen})
	if err != nil || folderID != 14 {
		t.Fatalf("folder id = %d, err = %v; want the chosen folder 14", folderID, err)
	}
}

func TestResolveCreateTableFolderID_CreatesANamedNewFolderUnderItsParent(t *testing.T) {
	db := newWorkflowQueueTestDB(t)
	defer db.Close()
	pushWorkflowQuery(queuedWorkflowQuery{cols: []string{"exists"}, rows: [][]driver.Value{{true}}})
	pushWorkflowQuery(queuedWorkflowQuery{cols: []string{"id"}, rows: [][]driver.Value{{int64(10002)}}})

	parent := 10000
	folderID, err := resolveCreateTableFolderID(db, CreateTableRequest{
		FolderID:     &parent,
		CreateFolder: &CreateFolderDef{FolderName: " blog_posts ", ParentID: &parent},
	})
	if err != nil || folderID != 10002 {
		t.Fatalf("folder id = %d, err = %v; want the new folder 10002", folderID, err)
	}
}

// A parent chosen for a new folder that was never named used to be read as
// "no new folder", and the dataset went to the default folder unnoticed.
func TestResolveCreateTableFolderID_RefusesANewFolderWithAParentButNoName(t *testing.T) {
	db := newWorkflowQueueTestDB(t)
	defer db.Close()

	parent := 10000
	for _, name := range []string{"", "   "} {
		_, err := resolveCreateTableFolderID(db, CreateTableRequest{
			CreateFolder: &CreateFolderDef{FolderName: name, ParentID: &parent},
		})
		if !errors.Is(err, errNewFolderNameRequired) {
			t.Fatalf("name %q: err = %v, want errNewFolderNameRequired", name, err)
		}
	}
}

func fintravelFolderRows() queuedWorkflowQuery {
	return queuedWorkflowQuery{
		cols: []string{"id", "parent_id", "folder_name", "is_current_project"},
		rows: [][]driver.Value{
			{int64(1), nil, "database", false},
			{int64(4), int64(1), "apps", false},
			{int64(14), int64(1), "other_tables", false},
			{int64(10000), int64(4), "fintravel", true},
		},
	}
}

func TestDescribeCreatedDataset_NamesTheFolderAndWhetherTheNavigationListsIt(t *testing.T) {
	for _, tc := range []struct {
		folderID   int
		path       string
		navigation bool
	}{
		{10000, "database / apps / fintravel", true},
		{14, "database / other_tables", false},
	} {
		db := newWorkflowQueueTestDB(t)
		pushWorkflowQuery(queuedWorkflowQuery{cols: []string{"table_uid"}, rows: [][]driver.Value{{int64(10044)}}})
		pushWorkflowQuery(fintravelFolderRows())

		got, err := describeCreatedDataset(db, "blogs", tc.folderID)
		db.Close()
		if err != nil {
			t.Fatalf("folder %d: describeCreatedDataset returned error: %v", tc.folderID, err)
		}
		want := createdDatasetResponse{
			Message: "Dataset created.", DatasetName: "blogs", TableUID: 10044,
			FolderID: tc.folderID, FolderPath: tc.path, InSiteNavigation: tc.navigation,
		}
		if got != want {
			t.Fatalf("folder %d: got %+v, want %+v", tc.folderID, got, want)
		}
	}
}

// A read that fails aborts the creation transaction, so it must reach the
// handler as an error instead of a success that could never be committed.
func TestDescribeCreatedDataset_ReportsAFailedRead(t *testing.T) {
	db := newWorkflowQueueTestDB(t)
	defer db.Close()
	pushWorkflowQuery(queuedWorkflowQuery{cols: []string{"table_uid"}, rows: [][]driver.Value{{int64(10044)}}})
	pushWorkflowQuery(queuedWorkflowQuery{err: errors.New("connection lost")})

	if _, err := describeCreatedDataset(db, "blogs", 10000); err == nil {
		t.Fatal("describeCreatedDataset hid a failed folder read")
	}
}
