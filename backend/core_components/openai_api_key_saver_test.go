// openai_api_key_saver_test.go
// Verifies protected, atomic OpenAI API key persistence for a generated Filterest checkout.
// Bridges temporary environment scaffolds with the runtime process environment.
// Exists to prevent secret disclosure, duplicate declarations, and permissive file modes.
package backend

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveOpenAIAPIKeyToProjectEnvironmentUpdatesProtectedScaffold(t *testing.T) {
	projectRoot := t.TempDir()
	envPath := filepath.Join(projectRoot, ".env")
	scaffold := "SITE_NAME=Filterest\n" + openAIAPIKeyEnvironmentName + "=\nKEEP_ME=yes\n"
	if err := os.WriteFile(envPath, []byte(scaffold), 0o644); err != nil {
		t.Fatalf("write scaffold: %v", err)
	}
	t.Setenv(openAIAPIKeyEnvironmentName, "")

	secret := "test-provider-secret-that-must-not-be-returned"
	if err := saveOpenAIAPIKeyToProjectEnvironment(projectRoot, secret); err != nil {
		t.Fatalf("saveOpenAIAPIKeyToProjectEnvironment() error = %v", err)
	}

	content, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatalf("read updated scaffold: %v", err)
	}
	updated := string(content)
	if !strings.Contains(updated, openAIAPIKeyEnvironmentName+"="+secret) || !strings.Contains(updated, "KEEP_ME=yes") {
		t.Fatalf("updated environment content did not preserve expected declarations")
	}
	info, err := os.Stat(envPath)
	if err != nil {
		t.Fatalf("stat updated scaffold: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("environment mode = %o, want 600", info.Mode().Perm())
	}
	if got := os.Getenv(openAIAPIKeyEnvironmentName); got != secret {
		t.Fatalf("runtime OpenAI API key was not activated")
	}
}

func TestReplaceEnvironmentSecretRejectsDuplicateDeclarations(t *testing.T) {
	_, err := replaceEnvironmentSecret(
		[]byte(openAIAPIKeyEnvironmentName+"=first\nexport "+openAIAPIKeyEnvironmentName+"=second\n"),
		openAIAPIKeyEnvironmentName,
		"replacement",
	)
	if err == nil {
		t.Fatal("replaceEnvironmentSecret() error = nil, want duplicate declaration error")
	}
	if strings.Contains(err.Error(), "replacement") {
		t.Fatal("duplicate declaration error exposed the submitted secret")
	}
}

func TestSaveOpenAIAPIKeyToProjectEnvironmentRejectsMultilineSecret(t *testing.T) {
	err := saveOpenAIAPIKeyToProjectEnvironment(t.TempDir(), "test-first\nINJECTED=value")
	if err != ErrInvalidOpenAIAPIKey {
		t.Fatalf("error = %v, want ErrInvalidOpenAIAPIKey", err)
	}
}
