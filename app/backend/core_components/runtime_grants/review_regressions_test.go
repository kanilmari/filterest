// review_regressions_test.go
// Holds the accepted commit-1 review findings to actual reader and policy behavior.
// Uses metadata-only fixtures; PostgreSQL counterparts prove execution privileges.
// Checks narrow dependencies, dispatch prerequisites and complete stable diagnostics.
package runtime_grants

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestReviewedDefinerSearchPathIsPinned(t *testing.T) {
	identity := reviewedDefinerBodies["8c5a769a59dfaa06a4c1ce947ff562b9"]
	definition, _, _ := newestDefinerMigrationFunction(t, identity)
	encoded := string(reviewedDefinerBodiesJSON())
	if !strings.Contains(encoded, `"search_path":"search_path=pg_catalog, public"`) || !strings.Contains(definition, "SET search_path = pg_catalog, public") {
		t.Fatal("reviewed path is not pinned to the migration")
	}
	for _, query := range []string{auditorMayWriteSQL, sqlPathReviewSQL} {
		if !strings.Contains(query, "= ARRAY[b.identity->>'search_path']") || strings.Contains(query, "EXISTS(SELECT 1 FROM unnest(p.proconfig)") {
			t.Fatal("one safety pass accepts an arbitrary function search path")
		}
	}
}

func TestAIChatQueryRequiresCanonicalReads(t *testing.T) {
	for _, group := range []int64{2, 3} {
		for _, disabled := range []*bool{nil, boolPointer(false), boolPointer(true)} {
			s := policyFixture()
			s.Functions[8] = Function{ID: 8, Route: "/api/app/ai-chat/query", TableRelated: true, Disabled: boolPointer(false)}
			s.Objects[13] = Object{OID: 13, Schema: "public", Name: "fresh_dataset_lang_embeddings", Kind: "table"}
			s.Dependencies = []Dependency{{SourceOID: 10, TargetOID: 11, Kind: "label", When: Read, Columns: []string{"id", "title"}}, {SourceOID: 10, TargetOID: 13, Kind: "embedding", When: Read}}
			s.Rights = []Right{{group, 8, 1}}
			assertReads := func(want bool) {
				grants := grantsFor(t, s)
				role := "basic"
				if group == 3 {
					role = "guest"
				}
				for _, target := range []struct {
					oid    int64
					column string
				}{{10, ""}, {11, "title"}, {13, ""}} {
					if containsGrant(grants, role, target.oid, target.column, "SELECT") != want {
						t.Fatalf("group %d facade prerequisite differs for %d/%s", group, target.oid, target.column)
					}
				}
			}
			assertReads(false)
			canonical := s.Functions[1]
			canonical.Disabled = disabled
			s.Functions[1] = canonical
			s.Rights = append(s.Rights, Right{group, 1, 1})
			assertReads(disabled == nil || !*disabled)
		}
	}
}

func TestAutomationPhysicalInsertKeepsDependenciesWithoutRedispatch(t *testing.T) {
	s := policyFixture()
	parent := s.Objects[11]
	parent.Columns = append(parent.Columns, Column{Name: "cached_image"})
	s.Objects[11] = parent
	s.Objects[20] = Object{OID: 20, Schema: "public", Name: "phantom_seq", Kind: "sequence"}
	s.Sequences = []SequenceUse{{12, 20, "id", true}}
	s.Rights = []Right{{2, 2, 1}}
	s.Dependencies = []Dependency{
		{SourceOID: 10, TargetOID: 11, Kind: "automation", When: Insert},
		{SourceOID: 11, TargetOID: 12, Kind: "automation", When: Insert},
		{SourceOID: 11, TargetOID: 11, Kind: "gallery", When: Insert, Columns: []string{"cached_image"}},
		{SourceOID: 10, TargetOID: 12, Kind: "cache", When: Insert, Columns: []string{"filename"}},
		{SourceOID: 11, TargetOID: 12, Kind: "cache", When: Insert, Columns: []string{"parent_id"}},
	}
	grants := grantsFor(t, s)
	if containsGrant(grants, "basic", 12, "", "INSERT") || containsGrant(grants, "basic", 20, "", "USAGE") {
		t.Fatal("A's dispatch seeded B's phantom dispatch into C")
	}
	if !containsGrant(grants, "basic", 11, "cached_image", "UPDATE") || !containsGrant(grants, "basic", 12, "filename", "UPDATE") {
		t.Fatal("physical insert lost gallery work or real source lost cache work")
	}
	if containsGrant(grants, "basic", 12, "parent_id", "UPDATE") {
		t.Fatal("physical automation insert invented an upload/cache callback")
	}
	s.Rights = append(s.Rights, Right{2, 2, 2})
	grants = grantsFor(t, s)
	if !containsGrant(grants, "basic", 12, "", "INSERT") || !containsGrant(grants, "basic", 20, "", "USAGE") {
		t.Fatal("real independent B dispatch did not seed C")
	}
}

// These fixtures exercise loadDependencies, including the canonical gallery
// discovery queries. No content read or mutation can pass this driver.
func reviewDependencySnapshot(t *testing.T, configure func(*GrantSnapshot), relationRows [][]driver.Value, predicate driver.Value) GrantSnapshot {
	t.Helper()
	s := policyFixture()
	s.Objects[30] = Object{OID: 30, Schema: "public", Name: "system_foreign_key_relations_1_m", Kind: "table"}
	configure(&s)
	db := metadataTestDB(t, func(query string, args []driver.NamedValue) (int, [][]driver.Value, error) {
		switch {
		case strings.Contains(query, "FROM public.system_foreign_key_relations_1_m ORDER BY id"):
			return 7, relationRows, nil
		case strings.Contains(query, "SELECT target_column_name"):
			return 1, [][]driver.Value{{predicate}}, nil
		case strings.Contains(query, "SELECT c.oid,c.conrelid"):
			return 5, nil, nil
		case strings.Contains(query, "FROM system_foreign_key_relations_1_m fk"):
			var rows [][]driver.Value
			for _, relation := range relationRows {
				source, target := oidByUID(&s, relation[1].(int64)), oidByUID(&s, relation[2].(int64))
				if s.Objects[target].Name == args[0].Value {
					rows = append(rows, []driver.Value{s.Objects[source].Name, s.Objects[target].Name, relation[3], relation[6]})
				}
			}
			return 4, rows, nil
		case strings.Contains(query, "FROM information_schema.tables"):
			return 1, [][]driver.Value{{true}}, nil
		case strings.Contains(query, "FROM information_schema.columns"):
			var rows [][]driver.Value
			for _, object := range s.Objects {
				if object.Name == args[0].Value {
					for _, column := range object.Columns {
						rows = append(rows, []driver.Value{column.Name, "text"})
					}
				}
			}
			return 2, rows, nil
		default:
			return 0, nil, errors.New("unexpected dependency fixture query")
		}
	})
	tx, err := db.BeginTx(context.Background(), &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := loadDependencies(context.Background(), tx, &s); err != nil {
		t.Fatal(err)
	}
	return s
}

func configureGalleryFixture(s *GrantSnapshot) {
	parent := s.Objects[10]
	parent.Columns = append(parent.Columns, Column{Name: "cached_image"})
	s.Objects[10] = parent
	child := s.Objects[12]
	child.Columns = append(child.Columns, Column{Name: "asset_kind"}, Column{Name: "sort_order"}, Column{Name: "is_primary"})
	s.Objects[12] = child
	s.Objects[13] = Object{OID: 13, Schema: "public", Name: "sibling_attachments", Kind: "table", DatasetUID: 4, Columns: []Column{{Name: "id"}, {Name: "parent_id"}, {Name: "stored_name"}, {Name: "private"}}}
	s.Objects[20] = Object{OID: 20, Schema: "public", Name: "gallery_seq", Kind: "sequence"}
	s.Sequences = []SequenceUse{{12, 20, "id", true}}
	s.Rights = []Right{{2, 3, 3}} // Only gallery-child update; parent/sibling unreadable.
}

func galleryRelationRows() [][]driver.Value {
	return [][]driver.Value{
		{int64(1), int64(3), int64(1), "parent_id", "", false, []byte(`{"file_upload":{"profiles":{"image":{}},"filename_column":"filename"}}`)},
		{int64(2), int64(4), int64(1), "parent_id", "", false, []byte(`{"file_upload":{"profile_key":"attachment","filename_column":"stored_name"}}`)},
	}
}

func TestSharedGalleryChildUpdatePreservesPictureAndReadsSiblingNarrowly(t *testing.T) {
	s := reviewDependencySnapshot(t, configureGalleryFixture, galleryRelationRows(), nil)
	grants := grantsFor(t, s)
	for _, grant := range []struct {
		oid               int64
		column, privilege string
	}{{12, "", "INSERT"}, {20, "", "USAGE"}, {10, "cached_image", "UPDATE"}, {13, "stored_name", "SELECT"}, {13, "parent_id", "SELECT"}} {
		if !containsGrant(grants, "basic", grant.oid, grant.column, grant.privilege) {
			t.Fatal("missing update-only gallery requirement", grant)
		}
	}
	if containsGrant(grants, "basic", 13, "", "SELECT") || containsGrant(grants, "basic", 13, "private", "SELECT") || containsGrant(grants, "basic", 13, "", "INSERT") {
		t.Fatal("attachment sibling acquired unrelated privileges")
	}
	s.Rights = nil
	grants = grantsFor(t, s)
	if containsGrant(grants, "basic", 12, "", "INSERT") || containsGrant(grants, "basic", 20, "", "USAGE") || containsGrant(grants, "basic", 13, "stored_name", "SELECT") {
		t.Fatal("gallery dependencies survived their last mutation consumer")
	}
}

func TestUploadCachePredicateNeedsOnlyNarrowSelect(t *testing.T) {
	rows := [][]driver.Value{{int64(1), int64(3), int64(2), "parent_id", "", false, []byte(`{"file_upload":{"filename_column":"filename","cache_targets":[{"table":"fresh_target","column":"title"}]}}`)}}
	for _, predicate := range []driver.Value{"id", nil, "missing_column"} {
		s := reviewDependencySnapshot(t, func(s *GrantSnapshot) { s.Rights = []Right{{2, 2, 3}} }, rows, predicate)
		if predicate != "id" {
			if !HasBlockers(s.Blockers) {
				t.Fatal("missing/NULL relation target column accepted")
			}
			continue
		}
		grants := grantsFor(t, s)
		if !containsGrant(grants, "basic", 11, "id", "SELECT") || !containsGrant(grants, "basic", 11, "title", "UPDATE") || containsGrant(grants, "basic", 11, "", "SELECT") || containsGrant(grants, "basic", 11, "private", "SELECT") {
			t.Fatal("cache predicate SELECT missing or widened")
		}
	}
}

func TestUnconfiguredMainRowUploadGetsNarrowFilenameUpdate(t *testing.T) {
	s := reviewDependencySnapshot(t, func(s *GrantSnapshot) { s.Rights = []Right{{2, 2, 3}} }, nil, nil)
	grants := grantsFor(t, s)
	if !containsGrant(grants, "basic", 12, "filename", "UPDATE") || containsGrant(grants, "basic", 12, "", "UPDATE") || containsGrant(grants, "basic", 12, "parent_id", "UPDATE") {
		t.Fatal("unconfigured add-only upload missing filename UPDATE or widened")
	}
	s.Rights = []Right{{2, 1, 3}}
	if containsGrant(grantsFor(t, s), "basic", 12, "filename", "UPDATE") {
		t.Fatal("fallback write survived its add consumer")
	}
}

func TestProductReferenceLockBlocksOnlyWithActiveMutation(t *testing.T) {
	for _, name := range []string{"system_languages", "dev_agent_worklines"} {
		s := policyFixture()
		target := s.Objects[11]
		target.Name = name
		s.Objects[11] = target
		s.Dependencies = []Dependency{{SourceOID: 10, TargetOID: 11, Kind: "lock", When: Insert | Update, Requires: Read, Columns: []string{"id"}}}
		s.Rights = []Right{{2, 2, 1}, {2, 1, 2}}
		if grants, err := DesiredRuntimeGrants(s); err == nil || grants != nil || !strings.Contains(err.Error(), name) || !strings.Contains(err.Error(), "dependency lock") {
			t.Fatal("active incompatible reference lock silently dropped", grants, err)
		}
		s.Rights = []Right{{2, 1, 1}, {2, 1, 2}}
		if containsGrant(grantsFor(t, s), "basic", 11, "id", "UPDATE") {
			t.Fatal("read-only reference acquired product write")
		}
	}
}

func TestClassificationErrorIsDeterministic(t *testing.T) {
	s := policyFixture()
	s.Objects[21] = Object{OID: 21, Schema: "public", Name: "system_unknown_second", Kind: "table"}
	s.Objects[20] = Object{OID: 20, Schema: "public", Name: "system_unknown_first", Kind: "table"}
	for i := 0; i < 200; i++ {
		_, err := DesiredRuntimeGrants(s)
		if err == nil || !strings.Contains(err.Error(), "system_unknown_first") {
			t.Fatal("map order selected the classification error", err)
		}
	}
}

func TestAuditFindingsSortedOnEarlyReturns(t *testing.T) {
	for _, fail := range []string{"SELECT t.oid,t.tgrelid", effectivePrivilegesSQL, directACLsSQL, defaultACLsSQL} {
		config, query := metadataSnapshotQueries(nil)
		db := metadataTestDB(t, func(sql string, args []driver.NamedValue) (int, [][]driver.Value, error) {
			if strings.Contains(sql, fail) {
				return 0, nil, errors.New("fixture read failure")
			}
			return query(sql, args)
		})
		findings, err := AuditRuntimeGrants(context.Background(), db, config)
		if err != nil || !HasBlockers(findings) {
			t.Fatal("expected diagnostic return", err, findings)
		}
		previous := ""
		for _, finding := range findings {
			encoded, _ := json.Marshal(finding)
			if string(encoded) <= previous {
				t.Fatal("early-return findings unsorted or duplicated", fail)
			}
			previous = string(encoded)
		}
	}
}

func TestForbiddenDestinationDoesNotSuppressIndependentAudit(t *testing.T) {
	config, query := metadataSnapshotQueries(nil)
	compared, provenance := false, false
	db := metadataTestDB(t, func(sql string, args []driver.NamedValue) (int, [][]driver.Value, error) {
		columns, rows, err := query(sql, args)
		switch {
		case sql == objectsSQL:
			rows = append(rows, []driver.Value{int64(31), "public", "system_about", "table", false, false})
		case strings.Contains(sql, "SELECT a.attrelid,a.attname"):
			rows = append(rows, []driver.Value{int64(31), "id", false, false})
		case strings.Contains(sql, "FROM public.system_triggers"):
			rows = append(rows, []driver.Value{int64(888), "fresh_dataset", "system_about", []byte(`{}`)})
		case sql == effectivePrivilegesSQL:
			compared = true
			var checks []Check
			if err := json.Unmarshal([]byte(args[1].Value.(string)), &checks); err != nil {
				t.Fatal(err)
			}
			wantMissing, wantExcess := false, false
			for _, check := range checks {
				wantMissing = wantMissing || check.Role == "basic" && check.ObjectOID == 10 && check.Privilege == "SELECT" && check.Wanted
				wantExcess = wantExcess || check.Role == "basic" && check.ObjectOID == 11 && check.Privilege == "UPDATE" && !check.Wanted
			}
			if !wantMissing || !wantExcess {
				t.Fatal("independent check omitted")
			}
		case sql == directACLsSQL:
			provenance = true
			rows = [][]driver.Value{{int64(11), "table", "public", "fresh_target", "", int64(101), int64(500), int64(500), "UPDATE", false}}
		}
		return columns, rows, err
	})
	findings, err := AuditRuntimeGrants(context.Background(), db, config)
	if err != nil || !compared || !provenance || !hasFinding(findings, "basic", "missing", "table", 10) || !hasFinding(findings, "basic", "excess_write", "table", 11) {
		t.Fatal("forbidden destination suppressed independent comparisons", err, findings)
	}
	if !hasDirectACLExcess(findings, 11) {
		t.Fatal("direct ACL finding was suppressed", findings)
	}
	for _, reason := range []string{"forbidden operational destination", "id 906:", "id 904:"} {
		found := false
		for _, f := range findings {
			found = found || f.Finding == "blocker" && strings.Contains(f.Reason, reason)
		}
		if !found {
			t.Fatal("audit omitted blocker", reason)
		}
	}
}

// These are the exported site's blocker categories, not a replay of its live
// rights. About/gallery metadata matches the site; runtime rights are paired
// synthetic administrator-only and ordinary-consumer cases.
func TestDevelopmentSiteBlockerCategoriesRemainVisible(t *testing.T) {
	for _, runtimeConsumer := range []bool{false, true} {
		t.Run(map[bool]string{false: "administrator only", true: "ordinary gallery consumer"}[runtimeConsumer], func(t *testing.T) {
			config, query := metadataSnapshotQueries(nil)
			staleIDs := []int64{20, 22, 23, 24, 25, 26, 28, 32, 33}
			db := metadataTestDB(t, func(sql string, args []driver.NamedValue) (int, [][]driver.Value, error) {
				columns, rows, err := query(sql, args)
				switch {
				case sql == objectsSQL:
					rows = append(rows,
						[]driver.Value{int64(31), "public", "system_about", "table", false, false},
						[]driver.Value{int64(32), "public", "systemview_role_table_privileges", "table", true, false},
						[]driver.Value{int64(33), "public", "app_service_locations", "table", false, false},
						[]driver.Value{int64(34), "public", "system_users", "table", true, false},
						[]driver.Value{int64(35), "public", "system_about_assets", "table", false, false})
				case strings.Contains(sql, "SELECT a.attrelid,a.attname"):
					rows = append(rows, []driver.Value{int64(34), "id", false, false}, []driver.Value{int64(34), "enabled", false, false},
						[]driver.Value{int64(31), "id", false, false}, []driver.Value{int64(31), "cached_image", true, false})
					for _, column := range []string{"id", "system_about_id", "filename", "asset_kind", "is_primary", "sort_order"} {
						rows = append(rows, []driver.Value{int64(35), column, false, false})
					}
				case strings.Contains(sql, "FROM public.system_db_tables d ORDER BY d.id"):
					rows = append(rows[:3], []driver.Value{int64(4), int64(4), "public", "app_service_locations", int64(33), ""},
						[]driver.Value{int64(5), int64(5), "public", "system_about", int64(31), ""},
						[]driver.Value{int64(6), int64(6), "public", "system_about_assets", int64(35), ""})
				case strings.Contains(sql, "FROM public.system_functions ORDER BY id"):
					rows = append(rows, []driver.Value{int64(3), "/api/update-row", false, false, true})
				case strings.Contains(sql, "FROM public.system_group_table_func_rights"):
					rows = append(rows[:3], []driver.Value{int64(80), int64(1), int64(3), int64(6)}, []driver.Value{int64(82), int64(1), int64(3), int64(5)})
					if runtimeConsumer {
						rows = append(rows, []driver.Value{int64(81), int64(2), int64(3), int64(6)})
					}
				case strings.Contains(sql, "FROM public.system_row_actor_columns"), strings.Contains(sql, "FROM public.system_foreign_key_relations_m_m"):
					rows = nil
				case strings.Contains(sql, "FROM public.system_foreign_key_relations_1_m ORDER BY id"):
					rows = [][]driver.Value{{int64(80), int64(6), int64(5), "system_about_id", "", true, []byte(`{"file_upload":{"filename_column":"filename","profiles":{"image":{}},"cache_targets":[{"table":"system_about","column":"cached_image"}]}}`)}}
				case strings.Contains(sql, "SELECT c.oid,c.conrelid"):
					return 5, [][]driver.Value{{int64(501), int64(35), int64(31), "system_about_id", "id"}}, nil
				case strings.Contains(sql, "SELECT target_column_name"):
					return 1, [][]driver.Value{{"id"}}, nil
				case strings.Contains(sql, "FROM system_foreign_key_relations_1_m fk"):
					var relations [][]driver.Value
					if args[0].Value == "system_about" {
						relations = [][]driver.Value{{"system_about_assets", "system_about", "system_about_id", []byte(`{"file_upload":{"filename_column":"filename","profiles":{"image":{}}}}`)}}
					}
					return 4, relations, nil
				case strings.Contains(sql, "FROM information_schema.tables"):
					return 1, [][]driver.Value{{true}}, nil
				case strings.Contains(sql, "FROM information_schema.columns"):
					var galleryColumns [][]driver.Value
					for _, column := range []string{"id", "system_about_id", "filename", "asset_kind", "is_primary", "sort_order"} {
						galleryColumns = append(galleryColumns, []driver.Value{column, "text"})
					}
					return 2, galleryColumns, nil
				case strings.Contains(sql, "FROM public.system_triggers"):
					rows = nil
					for _, id := range staleIDs {
						rows = append(rows, []driver.Value{id, "stale_source", "stale_destination", nil})
					}
				case strings.Contains(sql, "SELECT t.oid,t.tgrelid"):
					rows = [][]driver.Value{{int64(21332), int64(32), "unreviewed", false}, {int64(21333), int64(33), "unreviewed", false}, {int64(21334), int64(34), "unreviewed", false}}
				}
				return columns, rows, err
			})
			findings, err := AuditRuntimeGrants(context.Background(), db, config)
			if err != nil {
				t.Fatal(err)
			}
			stale, paths, about, blockers := 0, 0, 0, 0
			for _, finding := range findings {
				if finding.Finding != "blocker" {
					continue
				}
				blockers++
				if finding.Object == `"public"."system_triggers"` {
					stale++
				}
				if finding.Kind == "trigger" {
					paths++
				}
				if strings.Contains(finding.Reason, "forbidden active UPDATE") && strings.Contains(finding.Reason, "system_about") && strings.Contains(finding.Reason, "dependency gallery") {
					about++
				}
			}
			wantAbout := 0
			if runtimeConsumer {
				wantAbout = 1
			}
			if blockers != 12+wantAbout || stale != 9 || paths != 3 || about != wantAbout {
				t.Fatal("site blocker categories or paired gallery consumer differ", blockers, stale, paths, about, findings)
			}
			if !hasFinding(findings, "basic", "missing", "table", 10) || !hasFinding(findings, "basic", "excess_write", "table", 11) {
				t.Fatal("site blockers hid independent comparisons")
			}
		})
	}
}
