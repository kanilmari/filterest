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

	"easelect/backend/core_components/runtimepaths"
)

func configureOpenAIKeyRuntimePathsForTest(t *testing.T, paths runtimepaths.Paths) {
	t.Helper()
	original := runtimepaths.Current()
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("read working directory: %v", err)
	}
	if err := runtimepaths.Configure(paths); err != nil {
		t.Fatalf("configure OpenAI key runtime paths: %v", err)
	}
	t.Cleanup(func() {
		if err := runtimepaths.Configure(original); err == nil {
			return
		}
		legacy, resolveErr := runtimepaths.Resolve(
			workingDirectory,
			workingDirectory,
			false,
		)
		if resolveErr == nil {
			_ = runtimepaths.Configure(legacy)
		}
	})
}

func clearFilterestHomeOverridesForOpenAIKeyTest(t *testing.T) {
	t.Helper()
	for _, variableName := range []string{
		"FILTEREST_KEYS_HOME",
		"FILTEREST_KEYS_HOME_CONFIGURED",
		"FILTEREST_PROJECTS_HOME",
		"FILTEREST_PROJECTS_HOME_CONFIGURED",
		"FILTEREST_RUNTIME_DATA_HOME",
		"FILTEREST_RUNTIME_DATA_HOME_CONFIGURED",
		"FILTEREST_MAINTAINER_TOOLS_HOME",
		"FILTEREST_MAINTAINER_TOOLS_HOME_CONFIGURED",
		"FILTEREST_OPERATIONS_HOME",
		"FILTEREST_OPERATIONS_HOME_CONFIGURED",
	} {
		t.Setenv(variableName, "")
	}
}

func TestSaveOpenAIAPIKeyUsesConfiguredNestedInstallationRoot(t *testing.T) {
	installationRoot := t.TempDir()
	applicationRoot := filepath.Join(installationRoot, "app")
	protectedRoot := filepath.Join(installationRoot, "keys", "filterest_runtime")
	if err := os.MkdirAll(applicationRoot, 0o755); err != nil {
		t.Fatalf("create application root: %v", err)
	}
	if err := os.MkdirAll(protectedRoot, 0o700); err != nil {
		t.Fatalf("create protected root: %v", err)
	}
	for _, marker := range []string{"go.mod", "VERSION_APP"} {
		if err := os.WriteFile(filepath.Join(applicationRoot, marker), []byte("test\n"), 0o644); err != nil {
			t.Fatalf("write application marker %s: %v", marker, err)
		}
	}
	runtimeEnvironment := filepath.Join(protectedRoot, "runtime_environment.env")
	if err := os.WriteFile(
		runtimeEnvironment,
		[]byte(openAIAPIKeyEnvironmentName+"=\nKEEP_ME=yes\n"),
		0o600,
	); err != nil {
		t.Fatalf("write protected runtime environment: %v", err)
	}

	paths, err := runtimepaths.Resolve(applicationRoot, installationRoot, true)
	if err != nil {
		t.Fatalf("resolve nested runtime paths: %v", err)
	}
	configureOpenAIKeyRuntimePathsForTest(t, paths)
	clearFilterestHomeOverridesForOpenAIKeyTest(t)
	t.Setenv(openAIAPIKeyEnvironmentName, "")

	originalWorkingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("read original working directory: %v", err)
	}
	if err := os.Chdir(applicationRoot); err != nil {
		t.Fatalf("enter immutable application root: %v", err)
	}
	t.Cleanup(func() { _ = os.Chdir(originalWorkingDirectory) })

	secret := "test-nested-provider-secret"
	if err := SaveOpenAIAPIKey(secret); err != nil {
		t.Fatalf("SaveOpenAIAPIKey() error = %v", err)
	}
	content, err := os.ReadFile(runtimeEnvironment)
	if err != nil {
		t.Fatalf("read protected runtime environment: %v", err)
	}
	if !strings.Contains(string(content), openAIAPIKeyEnvironmentName+"="+secret) ||
		!strings.Contains(string(content), "KEEP_ME=yes") {
		t.Fatal("protected runtime environment did not receive the saved key")
	}
	if err := os.Unsetenv(openAIAPIKeyEnvironmentName); err != nil {
		t.Fatalf("clear active OpenAI key before restart simulation: %v", err)
	}
	if _, err := loadAndSetEnvironmentVariablesFromRoot(installationRoot); err != nil {
		t.Fatalf("reload protected runtime environment: %v", err)
	}
	if got := os.Getenv(openAIAPIKeyEnvironmentName); got != secret {
		t.Fatalf("reloaded OpenAI API key = %q, want saved value", got)
	}
	for _, forbiddenPath := range []string{
		filepath.Join(applicationRoot, ".env"),
		filepath.Join(applicationRoot, "dev_env.txt"),
		filepath.Join(applicationRoot, "keys"),
	} {
		if _, err := os.Lstat(forbiddenPath); !os.IsNotExist(err) {
			t.Fatalf("immutable application path was created: %s (error %v)", forbiddenPath, err)
		}
	}
}

func TestSaveOpenAIAPIKeyKeepsConfiguredLegacyFlatRoot(t *testing.T) {
	legacyRoot := t.TempDir()
	environmentPath := filepath.Join(legacyRoot, ".env")
	if err := os.WriteFile(
		environmentPath,
		[]byte(openAIAPIKeyEnvironmentName+"=\n"),
		0o600,
	); err != nil {
		t.Fatalf("write legacy environment: %v", err)
	}
	paths, err := runtimepaths.Resolve(legacyRoot, legacyRoot, false)
	if err != nil {
		t.Fatalf("resolve legacy runtime paths: %v", err)
	}
	configureOpenAIKeyRuntimePathsForTest(t, paths)
	clearFilterestHomeOverridesForOpenAIKeyTest(t)
	t.Setenv(openAIAPIKeyEnvironmentName, "")

	secret := "test-legacy-provider-secret"
	if err := SaveOpenAIAPIKey(secret); err != nil {
		t.Fatalf("SaveOpenAIAPIKey() legacy error = %v", err)
	}
	content, err := os.ReadFile(environmentPath)
	if err != nil {
		t.Fatalf("read legacy environment: %v", err)
	}
	if !strings.Contains(string(content), openAIAPIKeyEnvironmentName+"="+secret) {
		t.Fatal("legacy flat environment did not receive the saved key")
	}
}

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
