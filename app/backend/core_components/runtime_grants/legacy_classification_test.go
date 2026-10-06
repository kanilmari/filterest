// legacy_classification_test.go
// Exercises the reviewed development catalogue without needing that site's data.
// Connects table/route classification to actual desired grants and hard denials.
// Prevents obsolete rights from reviving dormant product tables.
package runtime_grants

import "testing"

func TestDevelopmentTableClassificationsAndGrants(t *testing.T) {
	for name, class := range map[string]TableClass{
		"system_about_assets":            Content,
		"system_ai_chatbot_instructions": Protected,
		"system_app_db_compatibility":    Product,
		"system_column_types_for_mgmt":   Protected,
		"system_config_value_data_types": Product,
		"system_database_identity":       Product,
		"system_file_structure":          Protected,
		"system_fk_cache_triggers":       Product,
		"system_lang_key_types":          Product,
		"system_log":                     Product,
		"system_log_classes":             Protected,
		"system_log_types":               Product,
		"system_row_views":               Protected,
		"system_styles":                  Protected,
	} {
		t.Run(name, func(t *testing.T) {
			s := policyFixture()
			o := s.Objects[10]
			o.Name = name
			s.Objects[10] = o
			if got, err := ClassifyTable(o); err != nil || got != class {
				t.Fatalf("class=%s, err=%v; want %s", got, err, class)
			}
			// Include obsolete reads and every write route.
			for _, group := range []int64{2, 3} {
				for _, function := range []int64{1, 2, 3, 4} {
					s.Rights = append(s.Rights, Right{group, function, 1})
				}
				s.Rights = append(s.Rights, Right{group, 1, 2})
			}
			if class != Protected {
				s.Dependencies = []Dependency{{SourceOID: 11, TargetOID: 10, Kind: "label", When: Read, Columns: []string{"id", "title"}}}
			}
			s.Objects[13] = Object{OID: 13, Schema: "public", Name: name + "_id_seq", Kind: "sequence"}
			s.Sequences = []SequenceUse{{TableOID: 10, SequenceOID: 13, Column: "id", NextValue: true}}
			grants := grantsFor(t, s)
			for _, role := range []string{"basic", "guest"} {
				for _, privilege := range []string{"SELECT", "INSERT", "UPDATE", "DELETE"} {
					want := privilege == "SELECT" && class != Protected || role == "basic" && class == Content
					if got := containsGrant(grants, role, 10, "", privilege); got != want {
						t.Fatalf("%s %s=%v; want %v", role, privilege, got, want)
					}
				}
			}
			for _, g := range grants {
				if class == Protected && (g.ObjectOID == 10 || g.ObjectOID == 13) && g.Role != "readonly" {
					t.Fatal("dormant product object acquired a grant", g)
				}
			}
			if !containsGrant(grants, "readonly", 10, "", "SELECT") {
				t.Fatal("public readonly contract changed")
			}
		})
	}
}

func TestDormantProductDependenciesFailClosed(t *testing.T) {
	for name := range retiredProductTables {
		s := policyFixture()
		o := s.Objects[10]
		o.Name = name
		s.Objects[10] = o
		s.Rights = []Right{{2, 1, 2}}
		s.Dependencies = []Dependency{{SourceOID: 11, TargetOID: 10, Kind: "label", When: Read, Columns: []string{"id", "title"}}}
		if _, err := DesiredRuntimeGrants(s); err == nil {
			t.Fatal("dormant target silently acquired a label dependency", name)
		}
		// A stale right on the dormant source contributes no label grants.
		s.Rights = []Right{{2, 1, 1}}
		s.Dependencies[0].SourceOID, s.Dependencies[0].TargetOID = 10, 11
		if containsGrant(grantsFor(t, s), "basic", 11, "title", "SELECT") {
			t.Fatal("dormant source revived its label dependencies", name)
		}
	}
}

func TestAboutAssetClassificationRequiresRegistration(t *testing.T) {
	o := Object{Schema: "public", Name: "system_about_assets", Kind: "table"}
	if _, err := ClassifyTable(o); err == nil {
		t.Fatal("unregistered child acquired content classification")
	}
	o.DatasetUID = 3036
	o.Protected = true
	if class, err := ClassifyTable(o); err != nil || class != Protected {
		t.Fatal("asset exception bypassed protected closure", class, err)
	}
	o.Protected = false
	o.Name = "system_unreviewed_assets"
	if _, err := ClassifyTable(o); err == nil {
		t.Fatal("asset exception generalized to an unknown product child")
	}
}

func TestAboutAssetsKeepIndependentRights(t *testing.T) {
	s := policyFixture()
	parent, child := s.Objects[10], s.Objects[11]
	parent.Name, child.Name = "system_about", "system_about_assets"
	s.Objects[10], s.Objects[11] = parent, child
	s.Rights = []Right{{2, 1, 1}, {2, 2, 1}}
	if containsGrant(grantsFor(t, s), "basic", 11, "", "INSERT") {
		t.Fatal("parent rights conferred child writes")
	}
	s.Rights = []Right{{2, 2, 2}, {3, 1, 2}}
	grants := grantsFor(t, s)
	if !containsGrant(grants, "basic", 11, "", "INSERT") || !containsGrant(grants, "guest", 11, "", "SELECT") {
		t.Fatal("independent asset child rights lost their grants")
	}
}

func TestDeleteForeignKeyRouteConfersNoContentGrants(t *testing.T) {
	for _, disabled := range []*bool{nil, boolPointer(false), boolPointer(true)} {
		s := policyFixture()
		s.Functions[72412] = Function{ID: 72412, Route: "/api/delete_foreign_key", TableRelated: true, Disabled: disabled}
		s.Rights = []Right{{2, 72412, 1}, {3, 72412, 1}, {1, 72412, 1}}
		for _, g := range grantsFor(t, s) {
			if g.ObjectOID == 10 && g.Role != "readonly" {
				t.Fatal("administrator schema metadata route conferred content privileges", g)
			}
		}
	}
}
