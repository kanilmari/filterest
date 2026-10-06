// final_review_regressions_test.go
// Guards every accepted final review boundary before commit-1 handoff.
// Exercises real snapshot readers and pure policy without database access.
// Prevents bootstrap IDs, adoption callbacks and unrelated blockers widening grants.
package runtime_grants

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"easelect/backend/core_components/runtimepaths"
)

func TestSiteGuestGroupAndAnonymousMembershipUnion(t *testing.T) {
	for _, membership := range []int64{4, 5} {
		config, query := metadataSnapshotQueries(nil)
		db := metadataTestDB(t, func(sql string, args []driver.NamedValue) (int, [][]driver.Value, error) {
			columns, rows, err := query(sql, args)
			switch {
			case strings.Contains(sql, "FROM public.system_user_groups"):
				return 2, [][]driver.Value{{int64(1), "admins"}, {int64(3), "users"}, {int64(4), "guests"}, {int64(5), "anonymous_extra"}}, nil
			case strings.Contains(sql, "FROM public.system_user_group_memberships"):
				return 2, [][]driver.Value{{int64(1), membership}}, nil
			case strings.Contains(sql, "FROM public.system_group_table_func_rights"):
				return 4, [][]driver.Value{{int64(1), int64(3), int64(1), int64(1)}, {int64(2), int64(4), int64(1), int64(2)}, {int64(3), int64(5), int64(1), int64(3)}}, nil
			}
			return columns, rows, err
		})
		tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
		if err != nil {
			t.Fatal(err)
		}
		s, err := LoadGrantSnapshot(context.Background(), tx, config)
		tx.Rollback()
		if err != nil {
			t.Fatal(err)
		}
		if s.GuestGroups[3] || !s.GuestGroups[4] || s.GuestGroups[5] != (membership == 5) {
			t.Fatal("site guests and anonymous membership union differ", s.GuestGroups)
		}
		// This reader fixture deliberately retains unrelated dangling metadata.
		s.Blockers = nil
		price := s.Objects[10]
		price.Name = "app_price_chart"
		s.Objects[10] = price
		grants := grantsFor(t, s)
		if !containsGrant(grants, "basic", 10, "", "SELECT") || containsGrant(grants, "guest", 10, "", "SELECT") {
			t.Fatal("users-only price chart leaked to guests")
		}
		if !containsGrant(grants, "guest", 11, "", "SELECT") || containsGrant(grants, "guest", 12, "", "SELECT") != (membership == 5) {
			t.Fatal("named guest group or anonymous membership lost its read")
		}
	}
}

func TestGuestGroupResolutionRefusesMissingOrAmbiguousName(t *testing.T) {
	for _, guests := range [][][]driver.Value{nil, {{int64(3), "guests"}, {int64(4), "guests"}}} {
		config, query := metadataSnapshotQueries(nil)
		db := metadataTestDB(t, func(sql string, args []driver.NamedValue) (int, [][]driver.Value, error) {
			if strings.Contains(sql, "FROM public.system_user_groups") {
				return 2, append([][]driver.Value{{int64(1), "admins"}, {int64(2), "users"}, {int64(3), "users"}}, guests...), nil
			}
			return query(sql, args)
		})
		tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
		if err != nil {
			t.Fatal(err)
		}
		s, err := LoadGrantSnapshot(context.Background(), tx, config)
		tx.Rollback()
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, f := range s.Blockers {
			found = found || strings.Contains(f.Reason, "uniquely named guests group")
		}
		if !found {
			t.Fatal("guest resolution did not block", s.Blockers)
		}
	}
}

func TestGalleryAdoptionDoesNotExecuteSettlementOrNestedCallbacks(t *testing.T) {
	for _, test := range []struct {
		name       string
		right      Right
		wantOrder  bool
		wantNested bool
	}{
		{"parent only", Right{2, 2, 1}, false, false},
		{"child add only", Right{2, 2, 3}, true, true},
		{"child delete only", Right{2, 4, 3}, false, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			rows := append(galleryRelationRows()[:1], []driver.Value{int64(3), int64(5), int64(3), "parent_id", "", false, []byte(`{"file_upload":{"profiles":{"image":{}},"filename_column":"filename"}}`)})
			s := reviewDependencySnapshot(t, func(s *GrantSnapshot) {
				configureGalleryFixture(s)
				child := s.Objects[12]
				child.Columns = append(child.Columns, Column{Name: "cached_image"})
				s.Objects[12] = child
				s.Objects[14] = Object{OID: 14, Schema: "public", Name: "nested_gallery_assets", Kind: "table", DatasetUID: 5, Columns: []Column{{Name: "id"}, {Name: "filename"}, {Name: "parent_id"}, {Name: "is_primary"}, {Name: "sort_order"}, {Name: "asset_kind"}}}
				s.Objects[21] = Object{OID: 21, Schema: "public", Name: "nested_gallery_seq", Kind: "sequence"}
				s.Sequences = append(s.Sequences, SequenceUse{14, 21, "id", true})
				s.Rights = []Right{test.right}
			}, rows, nil)
			grants := grantsFor(t, s)
			for _, requirement := range []struct {
				oid               int64
				column, privilege string
			}{{12, "", "INSERT"}, {20, "", "USAGE"}, {12, "filename", "SELECT"}, {12, "parent_id", "SELECT"}, {12, "is_primary", "SELECT"}, {12, "sort_order", "SELECT"}, {10, "cached_image", "UPDATE"}} {
				if !containsGrant(grants, "basic", requirement.oid, requirement.column, requirement.privilege) {
					t.Fatal("required adoption/preview support missing", requirement)
				}
			}
			if containsGrant(grants, "basic", 12, "is_primary", "UPDATE") || containsGrant(grants, "basic", 12, "sort_order", "UPDATE") != test.wantOrder {
				t.Fatal("primary or ordering writes exceed actual settlement")
			}
			for _, requirement := range []struct {
				oid               int64
				column, privilege string
			}{{14, "", "INSERT"}, {21, "", "USAGE"}, {12, "cached_image", "UPDATE"}, {14, "filename", "SELECT"}} {
				if containsGrant(grants, "basic", requirement.oid, requirement.column, requirement.privilege) != test.wantNested {
					t.Fatal("adoption invented nested execution or real create lost it", requirement)
				}
			}
			if containsGrant(grants, "basic", 14, "sort_order", "UPDATE") || containsGrant(grants, "basic", 14, "is_primary", "UPDATE") {
				t.Fatal("nested adoption executed settlement")
			}
		})
	}
}

func hasDirectACLExcess(findings []Finding, oid int64) bool {
	for _, f := range findings {
		if f.Role == "basic" && f.Kind == "table" && f.ObjectOID == oid && f.Privilege == "UPDATE" && f.Finding == "excess_write" && strings.HasPrefix(f.Reason, "direct ACL; grantor OID ") {
			return true
		}
	}
	return false
}

func TestStandaloneSequencesBlockOnlyTheirOwnDiagnosticChecks(t *testing.T) {
	config, query := metadataSnapshotQueries(nil)
	db := metadataTestDB(t, func(sql string, args []driver.NamedValue) (int, [][]driver.Value, error) {
		columns, rows, err := query(sql, args)
		switch sql {
		case objectsSQL:
			rows = append(rows, []driver.Value{int64(40), "public", "standalone_sequence", "sequence", false, false}, []driver.Value{int64(41), "public", "another_sequence", "sequence", false, false})
		case directACLsSQL:
			rows = [][]driver.Value{{int64(11), "table", "public", "fresh_target", "", int64(101), int64(500), int64(500), "UPDATE", false}}
		}
		return columns, rows, err
	})
	tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	s, err := LoadGrantSnapshot(context.Background(), tx, config)
	tx.Rollback()
	if err != nil {
		t.Fatal(err)
	}
	s.Blockers = nil
	if grants, err := DesiredRuntimeGrants(s); err == nil || grants != nil || !strings.Contains(err.Error(), "standalone_sequence") {
		t.Fatal("pure policy accepted standalone ordinary sequence", grants, err)
	}
	var diagnostics []Finding
	grants, err := evaluateRuntimeGrants(s, &diagnostics)
	if err != nil || len(diagnostics) != 2 {
		t.Fatal("sequence blockers were not isolated", err, diagnostics)
	}
	checks, err := BuildGrantChecks(s, grants)
	if err != nil {
		t.Fatal(err)
	}
	if len(checks) == 0 {
		t.Fatal("independent checks lost")
	}
	for _, check := range checks {
		if check.ObjectOID == 40 || check.ObjectOID == 41 {
			t.Fatal("unknown sequence got a diagnostic classification", check)
		}
	}
	findings, err := AuditRuntimeGrants(context.Background(), db, config)
	if err != nil || !hasFinding(findings, "basic", "missing", "table", 10) || !hasFinding(findings, "basic", "excess_write", "table", 11) || !hasDirectACLExcess(findings, 11) {
		t.Fatal("standalone sequence suppressed unrelated effective/direct-ACL findings", err, findings)
	}
	for _, oid := range []int64{40, 41} {
		if !hasFinding(findings, "policy", "blocker", "sequence", oid) {
			t.Fatal("individual sequence blocker missing", oid, findings)
		}
	}
}

func TestProductAndDedicatedParentGalleryRequiresActiveRuntimeConsumer(t *testing.T) {
	for _, name := range []string{"system_about", "dev_agent_worklines"} {
		t.Run(name, func(t *testing.T) {
			s := reviewDependencySnapshot(t, func(s *GrantSnapshot) {
				configureGalleryFixture(s)
				parent := s.Objects[10]
				parent.Name = name
				s.Objects[10] = parent
				s.Rights = []Right{{1, 3, 3}}
			}, galleryRelationRows(), nil)
			found := false
			for _, dependency := range s.Dependencies {
				found = found || dependency.SourceOID == 12 && dependency.TargetOID == 10 && dependency.Kind == "gallery"
			}
			if !found {
				t.Fatal("non-content parent gallery was not discovered")
			}
			if containsGrant(grantsFor(t, s), "basic", 10, "cached_image", "UPDATE") {
				t.Fatal("administrator-only gallery entered runtime pool")
			}
			s.Rights = append(s.Rights, Right{2, 3, 3})
			if grants, err := DesiredRuntimeGrants(s); err == nil || grants != nil || !strings.Contains(err.Error(), "forbidden active UPDATE") || !strings.Contains(err.Error(), "dependency gallery") {
				t.Fatal("active runtime gallery failed to block product write", grants, err)
			}
		})
	}
}

func TestAdditionalSchemasRequireDesiredObjects(t *testing.T) {
	s := policyFixture()
	for i, name := range []string{"public", "restricted", "apps", "postgis", "labels", "unused"} {
		oid := int64(40 + i)
		s.Objects[oid] = Object{OID: oid, Name: name, Kind: "schema"}
	}
	target := s.Objects[11]
	target.Schema = "labels"
	s.Objects[11] = target
	unused := s.Objects[12]
	unused.Schema = "unused"
	s.Objects[12] = unused
	s.Dependencies = []Dependency{{SourceOID: 10, TargetOID: 11, Kind: "label", When: Read, Columns: []string{"id", "title"}}}
	for _, rights := range [][]Right{nil, {{2, 1, 1}}, {{3, 1, 1}}} {
		s.Rights = rights
		grants := grantsFor(t, s)
		for _, role := range []string{"basic", "guest", "readonly", "confidential"} {
			if !containsGrant(grants, role, 40, "", "USAGE") || containsGrant(grants, role, 41, "", "USAGE") != (role == "confidential") {
				t.Fatal("approved public/restricted schema contract changed", role)
			}
			for _, oid := range []int64{42, 43, 45} {
				if containsGrant(grants, role, oid, "", "USAGE") {
					t.Fatal("empty or unused schema became a requirement", role, oid)
				}
			}
			wantLabel := len(rights) != 0 && (role == "basic" || role == "guest" && rights[0].GroupID == 3)
			if containsGrant(grants, role, 44, "", "USAGE") != wantLabel {
				t.Fatal("narrow label dependency lost/widened namespace access", role)
			}
		}
	}
	sequence := Object{OID: 50, Schema: "apps", Name: "default_sequence", Kind: "sequence"}
	s.Objects[50] = sequence
	s.Sequences = []SequenceUse{{10, 50, "id", true}}
	s.Rights = []Right{{2, 2, 1}}
	if !containsGrant(grantsFor(t, s), "basic", 42, "", "USAGE") || containsGrant(grantsFor(t, s), "guest", 42, "", "USAGE") {
		t.Fatal("cross-schema sequence requirement lost/widened schema access")
	}
}

func TestReviewRuntimePathsRestoreValidatedBaseline(t *testing.T) {
	expected := runtimepaths.Current()
	for _, field := range []*string{&expected.InstallationRoot, &expected.ApplicationRoot, &expected.DataRoot, &expected.StorageRoot, &expected.StorageDeletedRoot, &expected.RuntimeRoot} {
		absolute, err := filepath.Abs(*field)
		if err != nil {
			t.Fatal(err)
		}
		*field = absolute
	}
	paths, err := runtimepaths.Resolve(t.TempDir(), t.TempDir(), true)
	if err != nil {
		t.Fatal(err)
	}
	t.Run("temporary fixture paths", func(t *testing.T) {
		configureReviewRuntimePaths(t, paths)
		if !reflect.DeepEqual(runtimepaths.Current(), paths) {
			t.Fatal("fixture paths were not published")
		}
	})
	if !reflect.DeepEqual(runtimepaths.Current(), expected) {
		t.Fatal("cleanup did not restore the equivalent absolute baseline", runtimepaths.Current(), expected)
	}
	if err := runtimepaths.Configure(runtimepaths.Current()); err != nil {
		t.Fatal("restored baseline is invalid", err)
	}
}
