// table_classifier_test.go
// Classifies every literal table created by the bootstrap and public migrations.
// Links the shipped schema inventory to the policy's explicit product catalogue.
// Prevents new system or developer tables from falling through to content.
package runtime_grants

import (
	"crypto/md5"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestBootstrapAndMigrationTablesAreClassified(t *testing.T) {
	root := filepath.Join("..", "..", "..", "server_tools")
	files, err := filepath.Glob(filepath.Join(root, "migrations", "*.sql"))
	if err != nil {
		t.Fatal(err)
	}
	files = append(files, filepath.Join(root, "public_bootstrap", "schema.sql"))
	// These are the bootstrap's registered synthetic datasets, not product tables.
	content := map[string]bool{}
	for _, name := range []string{"palvelukatalogi", "riskienhallinta", "dokumentaatio", "tiketit", "palvelukatalogi_assets", "riskienhallinta_assets", "dokumentaatio_assets", "tiketit_assets", "palvelukatalogi_riskienhallinta_relation", "palvelukatalogi_dokumentaatio_relation", "palvelukatalogi_tiketit_relation", "riskienhallinta_dokumentaatio_relation", "riskienhallinta_tiketit_relation", "dokumentaatio_tiketit_relation"} {
		content[name] = true
	}
	pattern := regexp.MustCompile(`(?i)\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:UNLOGGED\s+|MATERIALIZED\s+)?(?:TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"?[a-z_][a-z_0-9]*"?\.)?"?[a-z_][a-z_0-9]*"?)`)
	count := 0
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		for _, match := range pattern.FindAllStringSubmatch(string(data), -1) {
			name := strings.ReplaceAll(match[1], `"`, "")
			schema := "public"
			if parts := strings.Split(name, "."); len(parts) == 2 {
				schema, name = parts[0], parts[1]
			}
			object := Object{Schema: schema, Name: name, Kind: "table"}
			if content[name] {
				object.DatasetUID = 1
			}
			class, err := ClassifyTable(object)
			if err != nil {
				t.Errorf("%s: %v", filepath.Base(file), err)
			}
			if strings.HasPrefix(name, "system_") || strings.HasPrefix(name, "dev_agent_") {
				if class == Content {
					t.Errorf("product table classified as content: %s", name)
				}
			}
			count++
		}
	}
	if count < 100 {
		t.Fatalf("schema inventory unexpectedly small: %d", count)
	}
}

func TestPasswordResetDummyWorkIsConfidentialOnly(t *testing.T) {
	snapshot := policyFixture()
	object := snapshot.Objects[10]
	object.Schema, object.Name = "restricted", "password_reset_dummy_work"
	snapshot.Objects[10] = object
	class, err := ClassifyTable(object)
	if err != nil || class != Restricted {
		t.Fatal(class, err)
	}
	grants := grantsFor(t, snapshot)
	for _, role := range []string{"PUBLIC", "basic", "guest", "readonly", "confidential"} {
		for _, privilege := range []string{"SELECT", "UPDATE"} {
			if containsGrant(grants, role, 10, "", privilege) != (role == "confidential") {
				t.Fatal("dummy work escaped the confidential pool", role, privilege)
			}
		}
	}
}

func TestProductTriggerBodiesHaveReviewedFingerprints(t *testing.T) {
	root := filepath.Join("..", "..", "..", "server_tools")
	files, err := filepath.Glob(filepath.Join(root, "migrations", "*.sql"))
	if err != nil {
		t.Fatal(err)
	}
	files = append(files, filepath.Join(root, "public_bootstrap", "schema.sql"))
	pattern := regexp.MustCompile(`(?is)CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)\s*\([^;]*?RETURNS\s+TRIGGER\s+(?:(?:[^$]|\$[^$])*?)AS\s+(\$\$)(.*?)\$\$`)
	count := 0
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		for _, match := range pattern.FindAllStringSubmatch(string(data), -1) {
			digest := fmt.Sprintf("%x", md5.Sum([]byte(match[3])))
			if !reviewedTriggerBodies[digest] {
				t.Errorf("%s: unreviewed product trigger body %s", filepath.Base(file), match[1])
			}
			count++
		}
	}
	if count < 30 {
		t.Fatalf("trigger inventory unexpectedly small: %d", count)
	}
	data, err := os.ReadFile(filepath.Join(root, "public_bootstrap", "schema.sql"))
	if err != nil {
		t.Fatal(err)
	}
	actor := regexp.MustCompile(`(?s)CREATE OR REPLACE FUNCTION public\.app_request_actor_id\(\).*?AS \$\$(.*?)\$\$`).FindStringSubmatch(string(data))
	if len(actor) != 2 || fmt.Sprintf("%x", md5.Sum([]byte(actor[1]))) != reviewedActorDefaultBody {
		t.Fatal("request actor default body requires policy review")
	}
}

func TestConfiguredRoleNamesNeverReadPasswords(t *testing.T) {
	keys := []string{}
	config := ConfiguredRoles(func(key string) string { keys = append(keys, key); return "custom_" + key })
	if config.Names["basic"] != "custom_DB_BASIC_USER" {
		t.Fatal("configured role ignored")
	}
	for _, key := range keys {
		if strings.Contains(key, "PASSWORD") {
			t.Fatal("policy requested a password")
		}
	}
}
