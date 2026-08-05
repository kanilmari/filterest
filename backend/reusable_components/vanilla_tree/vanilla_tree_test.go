// vanilla_tree_test.go
// Unit tests for the vanilla_tree helper conversions.
// Covers the low-level value normalization used between SQL row values and tree filtering so the navigation-tree package keeps a stable integer-conversion contract without requiring database-backed handler tests.
package vanilla_tree

import (
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
)

func TestTreeNodeIconKeyJSON(t *testing.T) {
	iconKey := "warning"
	node := TreeNode{
		ID:       "t_riskienhallinta",
		Name:     "riskienhallinta",
		ParentID: "f_156",
		DbID:     3172,
		TableUID: "3156",
		IconKey:  &iconKey,
	}

	body, err := json.Marshal(node)
	if err != nil {
		t.Fatalf("Marshal(TreeNode) error = %v", err)
	}

	var decoded map[string]interface{}
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("Unmarshal(TreeNode JSON) error = %v", err)
	}
	if decoded["icon_key"] != "warning" {
		t.Fatalf("decoded icon_key = %#v, want warning", decoded["icon_key"])
	}

	node.IconKey = nil
	body, err = json.Marshal(node)
	if err != nil {
		t.Fatalf("Marshal(TreeNode without icon) error = %v", err)
	}
	if string(body) == "" || !json.Valid(body) {
		t.Fatalf("TreeNode JSON invalid: %s", string(body))
	}
	if mapBody := string(body); strings.Contains(mapBody, `"icon_key"`) {
		t.Fatalf("TreeNode without IconKey should omit icon_key, got %s", mapBody)
	}
}

func TestToInt(t *testing.T) {
	tests := []struct {
		name  string
		value interface{}
		want  int
		ok    bool
	}{
		{name: "int", value: int(5), want: 5, ok: true},
		{name: "int32", value: int32(6), want: 6, ok: true},
		{name: "int64", value: int64(7), want: 7, ok: true},
		{name: "float64", value: float64(8), want: 8, ok: true},
		{name: "bytes", value: []byte("9"), want: 9, ok: true},
		{name: "string", value: "10", want: 10, ok: true},
		{name: "invalid bytes", value: []byte("x"), want: 0, ok: false},
		{name: "invalid string", value: "y", want: 0, ok: false},
		{name: "unsupported", value: true, want: 0, ok: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := toInt(tt.value)
			if got != tt.want || ok != tt.ok {
				t.Fatalf("toInt(%v) = (%d, %v), want (%d, %v)", tt.value, got, ok, tt.want, tt.ok)
			}
		})
	}
}

func TestBuildLegacyOtherTablesFolderRemap(t *testing.T) {
	folderRows := []folderTreeRow{
		{ID: 15, Name: "database"},
		{ID: 150, Name: "other_tables", ParentID: sql.NullInt64{Int64: 15, Valid: true}},
		{ID: 151, Name: "other_tables"},
		{ID: 152, Name: "legacy_child", ParentID: sql.NullInt64{Int64: 151, Valid: true}},
	}

	remap := buildLegacyOtherTablesFolderRemap(folderRows)
	if len(remap) != 1 {
		t.Fatalf("remap len = %d, want 1", len(remap))
	}
	if remap[151] != 150 {
		t.Fatalf("remap[151] = %d, want 150", remap[151])
	}
	if _, exists := remap[150]; exists {
		t.Fatalf("canonical folder 150 should not be remapped")
	}
}

func TestBuildLegacyOtherTablesFolderRemapRequiresCanonicalDatabaseChild(t *testing.T) {
	folderRows := []folderTreeRow{
		{ID: 15, Name: "database"},
		{ID: 151, Name: "other_tables"},
	}

	remap := buildLegacyOtherTablesFolderRemap(folderRows)
	if remap != nil {
		t.Fatalf("remap = %#v, want nil without database child folder", remap)
	}
}

func TestFindCanonicalOtherTablesFolderID(t *testing.T) {
	folderRows := []folderTreeRow{
		{ID: 15, Name: "database"},
		{ID: 150, Name: "other_tables", ParentID: sql.NullInt64{Int64: 15, Valid: true}},
		{ID: 151, Name: "other_tables"},
	}

	got := findCanonicalOtherTablesFolderID(folderRows)
	if !got.Valid || got.Int64 != 150 {
		t.Fatalf("canonical other_tables folder = %#v, want valid 150", got)
	}
}

func TestRemapFolderReference(t *testing.T) {
	legacyRemap := map[int]int{151: 150}

	got := remapFolderReference(sql.NullInt64{Int64: 151, Valid: true}, legacyRemap)
	if !got.Valid || got.Int64 != 150 {
		t.Fatalf("remapped folder = %#v, want valid 150", got)
	}

	unchanged := remapFolderReference(sql.NullInt64{Int64: 150, Valid: true}, legacyRemap)
	if !unchanged.Valid || unchanged.Int64 != 150 {
		t.Fatalf("unchanged folder = %#v, want valid 150", unchanged)
	}

	invalid := remapFolderReference(sql.NullInt64{}, legacyRemap)
	if invalid.Valid {
		t.Fatalf("invalid folder reference = %#v, want invalid", invalid)
	}
}

func TestNormalizeTableFolderReferenceDefaultsOrphansToCanonicalOtherTables(t *testing.T) {
	legacyRemap := map[int]int{151: 150}
	canonicalFolder := sql.NullInt64{Int64: 150, Valid: true}

	got := normalizeTableFolderReference(sql.NullInt64{}, legacyRemap, canonicalFolder)
	if !got.Valid || got.Int64 != 150 {
		t.Fatalf("normalized orphan folder = %#v, want valid 150", got)
	}

	remapped := normalizeTableFolderReference(sql.NullInt64{Int64: 151, Valid: true}, legacyRemap, canonicalFolder)
	if !remapped.Valid || remapped.Int64 != 150 {
		t.Fatalf("normalized legacy folder = %#v, want valid 150", remapped)
	}
}
