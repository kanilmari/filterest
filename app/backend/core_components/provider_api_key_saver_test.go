// provider_api_key_saver_test.go
// Verifies protected, atomic provider API key persistence for every known provider.
// Bridges temporary environment scaffolds with the runtime process environment.
// Exists to prevent secret disclosure, cross-provider overwrites, duplicate declarations and permissive file modes.
package backend

import (
	"bytes"
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"easelect/backend/core_components/runtimepaths"
)

// openAIAPIKeyEnvironmentName and googleAPIKeyEnvironmentName read the names
// from the saver's own registry, so a renamed setting fails here instead of
// silently testing a name nothing uses.
var (
	openAIAPIKeyEnvironmentName = providerAPIKeyEnvironmentNames[APIKeyProviderOpenAI]
	googleAPIKeyEnvironmentName = providerAPIKeyEnvironmentNames[APIKeyProviderGoogle]
)

func configureProviderKeyRuntimePathsForTest(t *testing.T, paths runtimepaths.Paths) {
	t.Helper()
	original := runtimepaths.Current()
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("read working directory: %v", err)
	}
	if err := runtimepaths.Configure(paths); err != nil {
		t.Fatalf("configure provider key runtime paths: %v", err)
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

func clearFilterestHomeOverridesForProviderKeyTest(t *testing.T) {
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

func TestProviderAPIKeyEnvironmentNameCoversTheKnownProvidersOnly(t *testing.T) {
	for provider, want := range map[string]string{
		APIKeyProviderOpenAI: "OPENAI_API_KEY",
		APIKeyProviderGoogle: "GOOGLE_API_KEY",
	} {
		got, known := ProviderAPIKeyEnvironmentName(provider)
		if !known || got != want {
			t.Fatalf("ProviderAPIKeyEnvironmentName(%q) = %q, %v; want %q, true", provider, got, known, want)
		}
	}
	if _, known := ProviderAPIKeyEnvironmentName("anthropic"); known {
		t.Fatal("an unlisted provider must not resolve to a settings name")
	}
	if got, known := ProviderAPIKeyEnvironmentName("  Google "); !known || got != "GOOGLE_API_KEY" {
		t.Fatalf("a differently spelled provider name = %q, %v; want GOOGLE_API_KEY, true", got, known)
	}
	if len(providerAPIKeyEnvironmentNames) != 2 {
		t.Fatalf("registered providers = %v, want exactly the two checked above", providerAPIKeyEnvironmentNames)
	}
}

// TestSaveProviderAPIKeyWritesEachProvidersOwnSetting is the core of the
// generalisation: two providers must never overwrite each other's key.
func TestSaveProviderAPIKeyWritesEachProvidersOwnSetting(t *testing.T) {
	projectRoot := t.TempDir()
	envPath := filepath.Join(projectRoot, ".env")
	scaffold := "SITE_NAME=Filterest\n" +
		openAIAPIKeyEnvironmentName + "=\n" +
		googleAPIKeyEnvironmentName + "=\nKEEP_ME=yes\n"
	if err := os.WriteFile(envPath, []byte(scaffold), 0o600); err != nil {
		t.Fatalf("write scaffold: %v", err)
	}
	t.Setenv(openAIAPIKeyEnvironmentName, "")
	t.Setenv(googleAPIKeyEnvironmentName, "")

	openAISecret := "test-openai-secret-that-must-not-be-returned"
	googleSecret := "test-google-secret-that-must-not-be-returned"
	if err := saveProviderAPIKeyToProjectEnvironment(projectRoot, APIKeyProviderOpenAI, openAISecret); err != nil {
		t.Fatalf("save OpenAI key: %v", err)
	}
	if err := saveProviderAPIKeyToProjectEnvironment(projectRoot, APIKeyProviderGoogle, googleSecret); err != nil {
		t.Fatalf("save Google key: %v", err)
	}

	content, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatalf("read updated scaffold: %v", err)
	}
	updated := string(content)
	for _, wanted := range []string{
		openAIAPIKeyEnvironmentName + "=" + openAISecret,
		googleAPIKeyEnvironmentName + "=" + googleSecret,
		"KEEP_ME=yes",
		"SITE_NAME=Filterest",
	} {
		if !strings.Contains(updated, wanted) {
			t.Fatalf("protected environment file lost or missed a declaration: %q", strings.SplitN(wanted, "=", 2)[0])
		}
	}
	if got := os.Getenv(openAIAPIKeyEnvironmentName); got != openAISecret {
		t.Fatal("the running process did not pick up the saved OpenAI key")
	}
	if got := os.Getenv(googleAPIKeyEnvironmentName); got != googleSecret {
		t.Fatal("the running process did not pick up the saved Google key")
	}
	info, err := os.Stat(envPath)
	if err != nil {
		t.Fatalf("stat updated scaffold: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("environment mode = %o, want 600", info.Mode().Perm())
	}
}

// TestSaveProviderAPIKeyReturnsAndLogsNothingAboutTheSecret protects the one
// promise the administrator cannot verify for themselves.
func TestSaveProviderAPIKeyReturnsAndLogsNothingAboutTheSecret(t *testing.T) {
	projectRoot := t.TempDir()
	envPath := filepath.Join(projectRoot, ".env")
	if err := os.WriteFile(envPath, []byte(googleAPIKeyEnvironmentName+"=\n"), 0o600); err != nil {
		t.Fatalf("write scaffold: %v", err)
	}
	t.Setenv(googleAPIKeyEnvironmentName, "")

	var logged bytes.Buffer
	originalWriter := log.Writer()
	originalFlags := log.Flags()
	log.SetOutput(&logged)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(originalWriter)
		log.SetFlags(originalFlags)
	})

	secret := "test-google-secret-never-logged"
	if err := saveProviderAPIKeyToProjectEnvironment(projectRoot, APIKeyProviderGoogle, secret); err != nil {
		t.Fatalf("save Google key: %v", err)
	}
	if strings.Contains(logged.String(), secret) {
		t.Fatal("the saved key appeared in the application log")
	}

	// A refused value must not reach the log or the returned error either.
	logged.Reset()
	rejected := "test-rejected-secret\nINJECTED=value"
	err := saveProviderAPIKeyToProjectEnvironment(projectRoot, APIKeyProviderGoogle, rejected)
	if !errors.Is(err, ErrInvalidProviderAPIKey) {
		t.Fatalf("error = %v, want ErrInvalidProviderAPIKey", err)
	}
	if strings.Contains(err.Error(), "test-rejected-secret") || strings.Contains(logged.String(), "test-rejected-secret") {
		t.Fatal("a refused value was echoed in the error or the log")
	}
}

// TestSaveProviderAPIKeyRefusalChangesNothing covers every refusal the form can
// provoke: the protected file and the running process must be untouched.
func TestSaveProviderAPIKeyRefusalChangesNothing(t *testing.T) {
	projectRoot := t.TempDir()
	envPath := filepath.Join(projectRoot, ".env")
	scaffold := googleAPIKeyEnvironmentName + "=original-value\nKEEP_ME=yes\n"
	if err := os.WriteFile(envPath, []byte(scaffold), 0o600); err != nil {
		t.Fatalf("write scaffold: %v", err)
	}
	t.Setenv(googleAPIKeyEnvironmentName, "original-value")

	refusals := map[string]struct {
		provider string
		apiKey   string
		want     error
	}{
		"empty value":        {APIKeyProviderGoogle, "   ", ErrInvalidProviderAPIKey},
		"newline in value":   {APIKeyProviderGoogle, "abc\nDB_PASSWORD=stolen", ErrInvalidProviderAPIKey},
		"null byte in value": {APIKeyProviderGoogle, "abc\x00def", ErrInvalidProviderAPIKey},
		"oversized value":    {APIKeyProviderGoogle, strings.Repeat("k", 4097), ErrInvalidProviderAPIKey},
		"unknown provider":   {"anthropic", "abc", ErrUnknownAPIKeyProvider},
		"empty provider":     {"", "abc", ErrUnknownAPIKeyProvider},
	}
	for name, refusal := range refusals {
		t.Run(name, func(t *testing.T) {
			err := saveProviderAPIKeyToProjectEnvironment(projectRoot, refusal.provider, refusal.apiKey)
			if !errors.Is(err, refusal.want) {
				t.Fatalf("error = %v, want %v", err, refusal.want)
			}
			content, err := os.ReadFile(envPath)
			if err != nil {
				t.Fatalf("read scaffold: %v", err)
			}
			if string(content) != scaffold {
				t.Fatal("a refused value changed the protected environment file")
			}
			if got := os.Getenv(googleAPIKeyEnvironmentName); got != "original-value" {
				t.Fatalf("a refused value changed the running process: %q", got)
			}
			info, err := os.Stat(envPath)
			if err != nil {
				t.Fatalf("stat scaffold: %v", err)
			}
			if info.Mode().Perm() != 0o600 {
				t.Fatalf("environment mode = %o, want 600", info.Mode().Perm())
			}
		})
	}
}

// TestSaveProviderAPIKeyReportsAnInstallationItCannotWrite describes the
// production container that receives its settings from the host: there is no
// protected file inside it to update, and the page must say so.
func TestSaveProviderAPIKeyReportsAnInstallationItCannotWrite(t *testing.T) {
	t.Run("no protected environment file exists", func(t *testing.T) {
		err := saveProviderAPIKeyToProjectEnvironment(t.TempDir(), APIKeyProviderGoogle, "test-google-secret")
		if !errors.Is(err, ErrProtectedEnvironmentNotWritable) {
			t.Fatalf("error = %v, want ErrProtectedEnvironmentNotWritable", err)
		}
	})

	t.Run("the protected folder refuses a new file", func(t *testing.T) {
		if os.Geteuid() == 0 {
			t.Skip("the root user is not stopped by folder permissions")
		}
		projectRoot := t.TempDir()
		envPath := filepath.Join(projectRoot, ".env")
		if err := os.WriteFile(envPath, []byte(googleAPIKeyEnvironmentName+"=\n"), 0o600); err != nil {
			t.Fatalf("write scaffold: %v", err)
		}
		if err := os.Chmod(projectRoot, 0o500); err != nil {
			t.Fatalf("make the protected folder read-only: %v", err)
		}
		t.Cleanup(func() { _ = os.Chmod(projectRoot, 0o700) })

		err := saveProviderAPIKeyToProjectEnvironment(projectRoot, APIKeyProviderGoogle, "test-google-secret")
		if !errors.Is(err, ErrProtectedEnvironmentNotWritable) {
			t.Fatalf("error = %v, want ErrProtectedEnvironmentNotWritable", err)
		}
	})
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
	configureProviderKeyRuntimePathsForTest(t, paths)
	clearFilterestHomeOverridesForProviderKeyTest(t)
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

// TestSaveProviderAPIKeySurvivesARestartOfTheNestedInstallation proves the same
// restart path for the Google key the embedding page installs.
func TestSaveProviderAPIKeySurvivesARestartOfTheNestedInstallation(t *testing.T) {
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
	if err := os.WriteFile(runtimeEnvironment, []byte("KEEP_ME=yes\n"), 0o600); err != nil {
		t.Fatalf("write protected runtime environment: %v", err)
	}

	paths, err := runtimepaths.Resolve(applicationRoot, installationRoot, true)
	if err != nil {
		t.Fatalf("resolve nested runtime paths: %v", err)
	}
	configureProviderKeyRuntimePathsForTest(t, paths)
	clearFilterestHomeOverridesForProviderKeyTest(t)
	t.Setenv(googleAPIKeyEnvironmentName, "")

	secret := "test-google-secret-for-restart"
	if err := SaveProviderAPIKey(APIKeyProviderGoogle, secret); err != nil {
		t.Fatalf("SaveProviderAPIKey() error = %v", err)
	}
	if got := os.Getenv(googleAPIKeyEnvironmentName); got != secret {
		t.Fatal("the running process did not pick up the saved Google key")
	}
	if err := os.Unsetenv(googleAPIKeyEnvironmentName); err != nil {
		t.Fatalf("clear active Google key before restart simulation: %v", err)
	}
	if _, err := loadAndSetEnvironmentVariablesFromRoot(installationRoot); err != nil {
		t.Fatalf("reload protected runtime environment: %v", err)
	}
	if got := os.Getenv(googleAPIKeyEnvironmentName); got != secret {
		t.Fatalf("reloaded Google API key = %q, want saved value", got)
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
	configureProviderKeyRuntimePathsForTest(t, paths)
	clearFilterestHomeOverridesForProviderKeyTest(t)
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
	if err := saveProviderAPIKeyToProjectEnvironment(projectRoot, APIKeyProviderOpenAI, secret); err != nil {
		t.Fatalf("saveProviderAPIKeyToProjectEnvironment() error = %v", err)
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

func TestSaveProviderAPIKeyToProjectEnvironmentRejectsMultilineSecret(t *testing.T) {
	err := saveProviderAPIKeyToProjectEnvironment(t.TempDir(), APIKeyProviderOpenAI, "test-first\nINJECTED=value")
	if !errors.Is(err, ErrInvalidProviderAPIKey) {
		t.Fatalf("error = %v, want ErrInvalidProviderAPIKey", err)
	}
}
