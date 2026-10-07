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
	}
	writers := map[string]string{
		"CreateAdministratorAccount":        "ValidateAdministratorUsername",
		"ChangeLoginName":                   "ValidateLoginName",
		"createRegisteredAccount":           "ValidateLoginName",
		"ensureReservedTestUserCredentials": "ValidateReservedLoginName",
		"replaceAutomationCredentials":      "ValidateReservedLoginName",
	}
	seen := map[string]bool{}
	restrictedStar := privateWholeRowReadPattern
	credentialMutation := regexp.MustCompile(`(?is)\b(?:INSERT\s+INTO|UPDATE)\s+restricted\.users_restricted\b`)
	for _, directory := range []string{"backend", "server_tools"} {
		err := filepath.WalkDir(filepath.Join(appRoot, directory), func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
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
			if restrictedStar.MatchString(source) {
				findings = append(findings, fmt.Sprintf("restricted whole-row read: %s", path))
			}
			tree, err := parser.ParseFile(token.NewFileSet(), path, data, 0)
			if err != nil {
				return err
			}
			ast.Inspect(tree, func(node ast.Node) bool {
				if index, ok := node.(*ast.IndexExpr); ok {
					if selector, ok := index.X.(*ast.SelectorExpr); ok && selector.Sel.Name == "Values" {
						if key, ok := index.Index.(*ast.BasicLit); ok && (key.Value == `"username"` || key.Value == `"otp_pending_username"`) {
							findings = append(findings, fmt.Sprintf("retired session-name access: %s", path))
						}
					}
				}
				fn, ok := node.(*ast.FuncDecl)
				if !ok || fn.Body == nil {
					return true
				}
				required, reviewed := writers[fn.Name.Name]
				// Every SQL login-name INSERT/UPDATE must belong to one reviewed writer.
				writes := false
				validated := false
				ast.Inspect(fn.Body, func(child ast.Node) bool {
					if literal, ok := child.(*ast.BasicLit); ok && literal.Kind == token.STRING {
						sql := strings.ToLower(literal.Value)
						if strings.Contains(sql, "login_name") && credentialMutation.MatchString(sql) {
							writes = true
						}
					}
					if selector, ok := child.(*ast.Ident); ok && selector.Name == required {
						validated = true
					}
					return true
				})
				if writes && (!reviewed || !validated) {
					findings = append(findings, fmt.Sprintf("unvalidated private-name writer %s: %s", fn.Name.Name, path))
				}
				if reviewed {
					seen[fn.Name.Name] = true
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

// A whole credential row includes the private name even without naming its column.
var privateWholeRowReadPattern = regexp.MustCompile(`(?is)SELECT\s+(?:\w+\.)?\*\s+FROM\s+restricted\.|\bur\.\*|\b(?:row_to_json|to_jsonb)\s*\(\s*ur\s*\)`)

func TestPrivateNameWholeRowReadGuard(t *testing.T) {
	for _, query := range []string{"SELECT * FROM restricted.users_restricted", "SELECT u.id,ur.* FROM system_users u JOIN restricted.users_restricted ur USING(id)", "SELECT row_to_json(ur) FROM restricted.users_restricted ur", "SELECT to_jsonb(ur) FROM restricted.users_restricted ur"} {
		if !privateWholeRowReadPattern.MatchString(query) {
			t.Errorf("whole-row private read missed: %s", query)
		}
	}
	if privateWholeRowReadPattern.MatchString("SELECT u.id,ur.email FROM system_users u JOIN restricted.users_restricted ur USING(id)") {
		t.Fatal("explicit safe fields rejected")
	}
}

func TestSourceGuardRejectsReadersOutsideCoreComponents(t *testing.T) {
	root := t.TempDir()
	fixtures := map[string]string{
		"backend/pipeline/unreviewed.go":  "SELECT login_name FROM restricted.users_restricted",
		"server_tools/unreviewed/main.go": "SELECT u.id, ur.* FROM system_users u JOIN restricted.users_restricted ur USING(id)",
	}
	for file, query := range fixtures {
		full := filepath.Join(root, file)
		if err := os.MkdirAll(filepath.Dir(full), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(fmt.Sprintf("package fixture\nconst query = %q\n", query)), 0600); err != nil {
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
