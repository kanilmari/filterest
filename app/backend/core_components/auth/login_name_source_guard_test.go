// login_name_source_guard_test.go
// Holds LT11 private-name readers and writers to the reviewed source boundary.
// Complements sessions' AST guard for centralized cookie loading and saving.
// New private-name access or credential writer requires explicit review and validation.
package auth

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func TestLoginNameSourceGuard(t *testing.T) {
	findings, err := collectLoginNameSourceGuardFindings(filepath.Join("..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	for _, finding := range findings {
		t.Error(finding)
	}
}

func collectLoginNameSourceGuardFindings(appRoot string) ([]string, error) {
	var findings []string
	allowed := map[string]string{
		"backend/core_components/startup/reserved_test_users.go":                    "exact reserved fixture reconciliation",
		"backend/core_components/auth/register.go":                                  "registration refusal language keys",
		"backend/core_components/auth/registration_account.go":                      "validated registration writer and duplicate check",
		"backend/core_components/otp/otp.go":                                        "private-name change attempt policy",
		"backend/core_components/auth/credentials/login_name_change.go":             "shared validated name writer",
		"backend/core_components/auth/credentials/administrator_account_creator.go": "validated administrator creation",
		"backend/core_components/auth/automation_account_provisioner.go":            "reserved automation identity and credential writer",
		"backend/core_components/httpresponse/account_name_refusal.go":              "value-free constraint mapping",
		"backend/core_components/auth/profile_update.go":                            "authenticated owner name change",
		"backend/core_components/auth/admin_user_authentication_handler.go":         "administrator name change and promotion",
		"backend/core_components/auth/password_reset_handler.go":                    "private lookup and owner-only reset mail",
		"backend/core_components/auth/login_name_lookup.go":                         "credential lookup for sign-in",
		"backend/core_components/auth/first_run_admin.go":                           "validated first administrator form",
		"backend/core_components/email/account_email.go":                            "owner-only welcome and name-change mail",
		"server_tools/initial_admin_bootstrap/main.go":                              "operator bootstrap lookup of an existing administrator",
		"frontend/core_components/user_tools/profile_security_printer.js":           "owner-entered name change, never private readback",
		"server_tools/agent_tools/automation_account_credentials.py":                "fixed identity readiness marker",
		"server_tools/public_bootstrap/generate_bootstrap.py":                       "bootstrap acceptance of reviewed name protections",
		"server_tools/scripts/login_name_dry_run.sql":                               "read-only preflight without name projections",
		"server_tools/migrations/20261005000011_separate_login_names.sql":           "atomic K1 backfill and name protections",
		"server_tools/migrations/20261005000013_seed_login_name_keys.sql":           "translated account-name labels and refusals",
		"server_tools/public_bootstrap/source/base.schema.sql":                      "reviewed fresh credential schema",
		"server_tools/public_bootstrap/source/base.seed.sql":                        "reviewed ordinary-user name-setting default",
		"server_tools/public_bootstrap/schema.sql":                                  "generated schema checked by bootstrap hash tests",
		"server_tools/public_bootstrap/seed_data.sql":                               "generated labels and acceptance checked by bootstrap hash tests",
		"server_tools/versioning/schema_snapshots/db-9.10.0.sql":                    "versioned generated schema checked by bootstrap tests",
	}
	// Bind review to both file and function; a familiar function name in a
	// different package must not authorize a new credential writer.
	writers := map[string]string{
		"backend/core_components/auth/credentials/administrator_account_creator.go:CreateAdministratorAccount": "ValidateAdministratorUsername",
		"backend/core_components/auth/credentials/login_name_change.go:ChangeLoginName":                        "ValidateLoginName",
		"backend/core_components/auth/registration_account.go:createRegisteredAccount":                         "ValidateLoginName",
		"backend/core_components/startup/reserved_test_users.go:ensureReservedTestUserCredentials":             "ValidateReservedLoginName",
		"backend/core_components/auth/automation_account_provisioner.go:replaceAutomationCredentials":          "ValidateReservedLoginName",
		// These two reviewed wrappers must continue to call the common validator.
		"backend/core_components/auth/credentials/administrator_account_creator.go:ValidateAdministratorUsername": "ValidateLoginName",
		"backend/core_components/auth/credentials/account_name_allocator.go:ValidateReservedLoginName":            "ValidateLoginName",
	}
	seen := map[string]bool{}
	credentialMutation := regexp.MustCompile(`(?is)\b(?:INSERT\s+INTO|UPDATE)\s+restricted\s*\.\s*users_restricted\b`)
	for _, directory := range []string{"backend", "server_tools", "frontend"} {
		if _, err := os.Stat(filepath.Join(appRoot, directory)); os.IsNotExist(err) {
			continue
		}
		err := filepath.WalkDir(filepath.Join(appRoot, directory), func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() {
				if entry.Name() == "dist" || entry.Name() == "node_modules" {
					return filepath.SkipDir
				}
				return nil
			}
			extension := filepath.Ext(path)
			if (extension != ".go" && extension != ".js" && extension != ".ts" && extension != ".py" && extension != ".sql") ||
				strings.HasSuffix(path, "_test.go") || strings.HasSuffix(path, ".test.js") || strings.HasSuffix(path, ".test.ts") || strings.HasSuffix(path, ".spec.ts") || strings.HasPrefix(entry.Name(), "test_") {
				return nil
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			source := string(data)
			relative, err := filepath.Rel(appRoot, path)
			if err != nil {
				return err
			}
			if strings.Contains(source, "login_name") && allowed[filepath.ToSlash(relative)] == "" {
				findings = append(findings, fmt.Sprintf("unreviewed private-name source: %s", path))
			}
			if privateWholeRowReadPattern.MatchString(source) || (extension != ".go" && hasPrivateWholeRowRead(source)) {
				findings = append(findings, fmt.Sprintf("restricted whole-row read: %s", path))
			}
			if extension != ".go" {
				return nil
			}
			tree, err := parser.ParseFile(token.NewFileSet(), path, data, 0)
			if err != nil {
				return err
			}
			ast.Inspect(tree, func(node ast.Node) bool {
				if expression, ok := node.(ast.Expr); ok && hasPrivateWholeRowRead(sourceGuardString(expression)) {
					findings = append(findings, fmt.Sprintf("restricted whole-row read: %s", path))
				}
				if index, ok := node.(*ast.IndexExpr); ok {
					if selector, ok := index.X.(*ast.SelectorExpr); ok && selector.Sel.Name == "Values" {
						if key, ok := index.Index.(*ast.BasicLit); ok {
							value, _ := strconv.Unquote(key.Value)
							if value == "username" || value == "otp_pending_username" {
								findings = append(findings, fmt.Sprintf("retired session-name access: %s", path))
							}
						}
					}
				}
				fn, ok := node.(*ast.FuncDecl)
				if !ok || fn.Body == nil {
					return true
				}
				identity := filepath.ToSlash(relative) + ":" + fn.Name.Name
				required, reviewed := writers[identity]
				// Every SQL login-name INSERT/UPDATE must belong to one reviewed writer.
				writes := false
				validated := false
				ast.Inspect(fn.Body, func(child ast.Node) bool {
					if expression, ok := child.(ast.Expr); ok {
						sql := strings.ToLower(strings.ReplaceAll(sourceGuardString(expression), `"`, ""))
						if strings.Contains(sql, "login_name") && credentialMutation.MatchString(sql) {
							writes = true
						}
					}
					if call, ok := child.(*ast.CallExpr); ok {
						switch target := call.Fun.(type) {
						case *ast.Ident:
							validated = validated || target.Name == required
						case *ast.SelectorExpr:
							validated = validated || target.Sel.Name == required
						}
					}
					return true
				})
				if writes && (!reviewed || !validated) {
					findings = append(findings, fmt.Sprintf("unvalidated private-name writer %s: %s", fn.Name.Name, path))
				}
				if reviewed {
					seen[identity] = true
					if !validated {
						findings = append(findings, fmt.Sprintf("writer lost validator: %s", fn.Name.Name))
					}
				}
				return true
			})
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	for name := range writers {
		if !seen[name] {
			findings = append(findings, fmt.Sprintf("reviewed writer absent: %s", name))
		}
	}
	return findings, nil
}

// Constant concatenation must not hide a writer by separating the column name
// from INSERT/UPDATE. Merely referring to a validator is never a call to it.
func sourceGuardString(expression ast.Expr) string {
	switch value := expression.(type) {
	case *ast.BasicLit:
		if value.Kind == token.STRING {
			text, _ := strconv.Unquote(value.Value)
			return text
		}
	case *ast.BinaryExpr:
		if value.Op == token.ADD {
			return sourceGuardString(value.X) + sourceGuardString(value.Y)
		}
	case *ast.ParenExpr:
		return sourceGuardString(value.X)
	}
	return ""
}

// A whole credential row includes the private name even without naming its column.
var privateWholeRowReadPattern = regexp.MustCompile(`(?is)SELECT\s+(?:\w+\.)?\*\s+FROM\s+restricted\.|\bur\.\*|\b(?:row_to_json|to_jsonb)\s*\(\s*ur\s*\)`)

var restrictedRelationPattern = regexp.MustCompile(`(?is)\b(?:FROM|JOIN)\s+restricted\s*\.\s*(\w+)(?:\s+(?:AS\s+)?(\w+))?`)
var privateUnqualifiedStarPattern = regexp.MustCompile(`(?is)\bSELECT\s+(?:DISTINCT\s+)?(?:[^();]+,\s*)?\*\s+FROM\s+(?:restricted\s*\.|[^();]*\bJOIN\s+restricted\s*\.)`)

func hasPrivateWholeRowRead(source string) bool {
	// Match the restricted relation's actual aliases. A preflight may select
	// all fields of an explicitly narrowed CTE; that is not a private whole row.
	source = strings.ReplaceAll(source, `"`, "")
	if privateWholeRowReadPattern.MatchString(source) {
		return true
	}
	for _, statement := range strings.Split(source, ";") {
		if privateUnqualifiedStarPattern.MatchString(statement) {
			return true
		}
		for _, relation := range restrictedRelationPattern.FindAllStringSubmatch(statement, -1) {
			for _, alias := range relation[1:] {
				if alias == "" {
					continue
				}
				projection := regexp.MustCompile(`(?is)\b` + regexp.QuoteMeta(alias) + `\s*\.\s*\*|\b(?:row_to_json|to_jsonb)\s*\(\s*` + regexp.QuoteMeta(alias) + `\s*\)`)
				if projection.MatchString(statement) {
					return true
				}
			}
		}
	}
	return false
}

func TestPrivateNameWholeRowReadGuard(t *testing.T) {
	for _, query := range []string{"SELECT * FROM restricted.users_restricted", "SELECT u.id,ur.* FROM system_users u JOIN restricted.users_restricted ur USING(id)", "SELECT row_to_json(ur) FROM restricted.users_restricted ur", "SELECT to_jsonb(ur) FROM restricted.users_restricted ur", `SELECT private.* FROM "restricted"."users_restricted" private`, `SELECT u.id, private.* FROM system_users u JOIN restricted.users_restricted private USING(id)`, `SELECT to_jsonb(private) FROM restricted.users_restricted AS private`, "SELECT DISTINCT *\nFROM restricted.verification_codes"} {
		if !hasPrivateWholeRowRead(query) {
			t.Errorf("whole-row private read missed: %s", query)
		}
	}
	if hasPrivateWholeRowRead("SELECT u.id,ur.email FROM system_users u JOIN restricted.users_restricted ur USING(id)") {
		t.Fatal("explicit safe fields rejected")
	}
	if hasPrivateWholeRowRead("WITH accounts AS (SELECT id,email FROM restricted.users_restricted) SELECT * FROM accounts") {
		t.Fatal("narrowed preflight CTE rejected")
	}
}

func TestSourceGuardRejectsReadersOutsideCoreComponents(t *testing.T) {
	root := t.TempDir()
	fixtures := map[string]string{
		"backend/pipeline/unreviewed.go":              "SELECT login_name FROM restricted.users_restricted",
		"server_tools/unreviewed/main.go":             "SELECT u.id, ur.* FROM system_users u JOIN restricted.users_restricted ur USING(id)",
		"frontend/unreviewed.js":                      "SELECT login_name FROM restricted.users_restricted",
		"server_tools/unreviewed/read.py":             "SELECT login_name FROM restricted.users_restricted",
		"server_tools/unreviewed/read.sql":            "SELECT login_name FROM restricted.users_restricted",
		"server_tools/scripts/login_name_dry_run.sql": `SELECT private.* FROM "restricted"."users_restricted" private`,
	}
	for file, query := range fixtures {
		full := filepath.Join(root, file)
		if err := os.MkdirAll(filepath.Dir(full), 0700); err != nil {
			t.Fatal(err)
		}
		source := fmt.Sprintf("package fixture\nconst query = %q\n", query)
		if filepath.Ext(file) == ".sql" {
			source = query
		}
		if err := os.WriteFile(full, []byte(source), 0600); err != nil {
			t.Fatal(err)
		}
	}
	findings, err := collectLoginNameSourceGuardFindings(root)
	if err != nil {
		t.Fatal(err)
	}
	for file := range fixtures {
		if !strings.Contains(strings.Join(findings, "\n"), filepath.Join(root, file)) {
			t.Fatal("unreviewed reader outside core components escaped", file)
		}
	}
}

func TestSourceGuardRequiresValidatorCallsInReviewedWriters(t *testing.T) {
	const reviewed = "backend/core_components/auth/credentials/login_name_change.go"
	for _, fixture := range []struct {
		name, function, body string
		refused              bool
	}{
		{"reference is not validation", "ChangeLoginName", `_ = ValidateLoginName; query := "UPDATE restricted.users_restricted SET login_name=$1"; _ = query`, true},
		{"quoted concatenated writer", "unreviewed", "query := `UPDATE \"restricted\".\"users_restricted\" SET ` + `login_name=$1`; _ = query", true},
		{"real common validation", "ChangeLoginName", `ValidateLoginName(name); query := "UPDATE restricted.users_restricted SET login_name=$1"; _ = query`, false},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, reviewed)
			if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(filepath.Join(root, "server_tools"), 0700); err != nil {
				t.Fatal(err)
			}
			source := fmt.Sprintf("package credentials\nfunc %s(name string) { %s }", fixture.function, fixture.body)
			if err := os.WriteFile(path, []byte(source), 0600); err != nil {
				t.Fatal(err)
			}
			findings, err := collectLoginNameSourceGuardFindings(root)
			if err != nil {
				t.Fatal(err)
			}
			refused := strings.Contains(strings.Join(findings, "\n"), "unvalidated private-name writer "+fixture.function+": "+path)
			if refused != fixture.refused {
				t.Fatalf("writer refused=%v want=%v: %v", refused, fixture.refused, findings)
			}
		})
	}
}
