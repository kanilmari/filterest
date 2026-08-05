// env_loader_test.go
// Verifies environment loading defaults and explicit overrides for runtime mode selection.
// Bridges env_loader.go with process environment state under test control.
// Exists to keep ENVIRONMENT_TYPE fail-closed when no explicit development mode is configured.
package backend

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadAndSetEnvironmentVariablesDefaultsToProdWhenUnset(t *testing.T) {
	originalWd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	tempDir := t.TempDir()
	if err := os.Chdir(tempDir); err != nil {
		t.Fatalf("chdir temp dir: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(originalWd)
	})

	t.Setenv("ENVIRONMENT_TYPE", "")

	envType, err := loadAndSetEnvironmentVariables()
	if err != nil {
		t.Fatalf("loadAndSetEnvironmentVariables() error = %v", err)
	}
	if envType != "prod" {
		t.Fatalf("envType = %q, want prod", envType)
	}
	if got := os.Getenv("ENVIRONMENT_TYPE"); got != "prod" {
		t.Fatalf("ENVIRONMENT_TYPE = %q, want prod", got)
	}
}

func TestLoadAndSetEnvironmentVariablesHonorsExplicitDev(t *testing.T) {
	originalWd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	tempDir := t.TempDir()
	if err := os.Chdir(tempDir); err != nil {
		t.Fatalf("chdir temp dir: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(originalWd)
	})

	t.Setenv("ENVIRONMENT_TYPE", "dev")

	envType, err := loadAndSetEnvironmentVariables()
	if err != nil {
		t.Fatalf("loadAndSetEnvironmentVariables() error = %v", err)
	}
	if envType != "dev" {
		t.Fatalf("envType = %q, want dev", envType)
	}
	if got := os.Getenv("ENVIRONMENT_TYPE"); got != "dev" {
		t.Fatalf("ENVIRONMENT_TYPE = %q, want dev", got)
	}
}

func TestLoadAndSetEnvironmentVariablesReadsExplicitEnvFileValue(t *testing.T) {
	originalWd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	tempDir := t.TempDir()
	if err := os.Chdir(tempDir); err != nil {
		t.Fatalf("chdir temp dir: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(originalWd)
	})

	t.Setenv("ENVIRONMENT_TYPE", "placeholder")
	if err := os.Unsetenv("ENVIRONMENT_TYPE"); err != nil {
		t.Fatalf("unset ENVIRONMENT_TYPE: %v", err)
	}
	envFilePath := filepath.Join(tempDir, ".env")
	if err := os.WriteFile(envFilePath, []byte("ENVIRONMENT_TYPE=dev\n"), 0o644); err != nil {
		t.Fatalf("write .env: %v", err)
	}

	envType, err := loadAndSetEnvironmentVariables()
	if err != nil {
		t.Fatalf("loadAndSetEnvironmentVariables() error = %v", err)
	}
	if envType != "dev" {
		t.Fatalf("envType = %q, want dev", envType)
	}
	if got := os.Getenv("ENVIRONMENT_TYPE"); got != "dev" {
		t.Fatalf("ENVIRONMENT_TYPE = %q, want dev", got)
	}
}

func TestLoadAndSetEnvironmentVariablesPrefersDevEnvOverDotEnvForNativeLocal(t *testing.T) {
	originalWd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	tempDir := t.TempDir()
	if err := os.Chdir(tempDir); err != nil {
		t.Fatalf("chdir temp dir: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(originalWd)
	})

	if err := os.WriteFile(filepath.Join(tempDir, ".env"), []byte("ENVIRONMENT_TYPE=prod\n"), 0o644); err != nil {
		t.Fatalf("write .env: %v", err)
	}
	if err := os.WriteFile(filepath.Join(tempDir, "dev_env.txt"), []byte("ENVIRONMENT_TYPE=dev\n"), 0o644); err != nil {
		t.Fatalf("write dev_env.txt: %v", err)
	}

	envType, err := loadAndSetEnvironmentVariables()
	if err != nil {
		t.Fatalf("loadAndSetEnvironmentVariables() error = %v", err)
	}
	if envType != "dev" {
		t.Fatalf("envType = %q, want dev", envType)
	}
	if got := os.Getenv("ENVIRONMENT_TYPE"); got != "dev" {
		t.Fatalf("ENVIRONMENT_TYPE = %q, want dev", got)
	}
}

func TestLoadAndSetEnvironmentVariablesReadsExternalKeyRootWithoutCompatibilityFiles(t *testing.T) {
	originalWd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	tempRoot := t.TempDir()
	projectRoot := filepath.Join(tempRoot, "easelect")
	keyRoot := filepath.Join(tempRoot, "protected-keys")
	developmentRoot := filepath.Join(keyRoot, "easelect_development")
	tlsRoot := filepath.Join(developmentRoot, "local_tls_certificate")
	if err := os.MkdirAll(tlsRoot, 0o700); err != nil {
		t.Fatalf("mkdir external key root: %v", err)
	}
	if err := os.MkdirAll(projectRoot, 0o755); err != nil {
		t.Fatalf("mkdir project root: %v", err)
	}
	if err := os.Mkdir(filepath.Join(projectRoot, ".git"), 0o755); err != nil {
		t.Fatalf("mkdir source git marker: %v", err)
	}
	if err := os.WriteFile(filepath.Join(projectRoot, "VERSION_EASELECT"), []byte("test\n"), 0o644); err != nil {
		t.Fatalf("write source marker: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(developmentRoot, "runtime_environment.env"),
		[]byte("ENVIRONMENT_TYPE=prod\n"),
		0o600,
	); err != nil {
		t.Fatalf("write runtime env: %v", err)
	}
	if err := os.WriteFile(
		filepath.Join(developmentRoot, "development_environment.env"),
		[]byte("ENVIRONMENT_TYPE=dev\n"),
		0o600,
	); err != nil {
		t.Fatalf("write development env: %v", err)
	}
	if err := os.Chdir(projectRoot); err != nil {
		t.Fatalf("chdir project root: %v", err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(originalWd)
	})

	t.Setenv("EASELECT_KEY_ROOT", keyRoot)
	t.Setenv("ENVIRONMENT_TYPE", "")
	if err := os.Unsetenv("ENVIRONMENT_TYPE"); err != nil {
		t.Fatalf("unset ENVIRONMENT_TYPE: %v", err)
	}
	t.Setenv("TLS_CERT_FILE", "")
	t.Setenv("TLS_KEY_FILE", "")

	envType, err := loadAndSetEnvironmentVariables()
	if err != nil {
		t.Fatalf("loadAndSetEnvironmentVariables() error = %v", err)
	}
	if envType != "dev" {
		t.Fatalf("envType = %q, want dev", envType)
	}
	if got := os.Getenv("TLS_CERT_FILE"); got != filepath.Join(tlsRoot, "localhost_certificate.crt") {
		t.Fatalf("TLS_CERT_FILE = %q, want external certificate", got)
	}
	if got := os.Getenv("TLS_KEY_FILE"); got != filepath.Join(tlsRoot, "localhost_private_key.key") {
		t.Fatalf("TLS_KEY_FILE = %q, want external private key", got)
	}
	for _, legacyName := range []string{".env", "dev_env.txt", "dev-cert.crt", "dev-cert.key"} {
		legacyPath := filepath.Join(projectRoot, legacyName)
		if _, err := os.Lstat(legacyPath); !os.IsNotExist(err) {
			t.Fatalf("legacy root path exists after load: %s", legacyPath)
		}
	}
}

func TestResolveProjectPrivatePathsKeepsGeneratedRuntimeLocal(t *testing.T) {
	projectRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(projectRoot, "VERSION_APP"), []byte("test\n"), 0o644); err != nil {
		t.Fatalf("write generated marker: %v", err)
	}
	t.Setenv("EASELECT_KEY_ROOT", filepath.Join(t.TempDir(), "must-not-be-used"))

	envFiles, tlsCertFile, tlsKeyFile, err := resolveProjectPrivatePaths(projectRoot)
	if err != nil {
		t.Fatalf("resolveProjectPrivatePaths() error = %v", err)
	}
	if len(envFiles) != 2 ||
		envFiles[0] != filepath.Join(projectRoot, "dev_env.txt") ||
		envFiles[1] != filepath.Join(projectRoot, ".env") {
		t.Fatalf("envFiles = %#v, want generated runtime-local files", envFiles)
	}
	if tlsCertFile != "" || tlsKeyFile != "" {
		t.Fatalf("generated TLS defaults = %q, %q; want main.go root-local fallbacks", tlsCertFile, tlsKeyFile)
	}
}

func TestResolveProjectPrivatePathsKeepsDeployedEaselectRuntimeLocal(t *testing.T) {
	projectRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(projectRoot, "VERSION_EASELECT"), []byte("test\n"), 0o644); err != nil {
		t.Fatalf("write deployed version marker: %v", err)
	}
	t.Setenv("EASELECT_KEY_ROOT", filepath.Join(t.TempDir(), "must-not-be-used"))

	envFiles, tlsCertFile, tlsKeyFile, err := resolveProjectPrivatePaths(projectRoot)
	if err != nil {
		t.Fatalf("resolveProjectPrivatePaths() error = %v", err)
	}
	if len(envFiles) != 2 ||
		envFiles[0] != filepath.Join(projectRoot, "dev_env.txt") ||
		envFiles[1] != filepath.Join(projectRoot, ".env") {
		t.Fatalf("envFiles = %#v, want deployed runtime-local files", envFiles)
	}
	if tlsCertFile != "" || tlsKeyFile != "" {
		t.Fatalf("deployed TLS defaults = %q, %q; want main.go runtime-local fallbacks", tlsCertFile, tlsKeyFile)
	}
}

func TestResolveProjectPrivatePathsUsesConfiguredGeneratedKeyHome(t *testing.T) {
	projectRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(projectRoot, "VERSION_APP"), []byte("test\n"), 0o644); err != nil {
		t.Fatalf("write generated marker: %v", err)
	}
	keyRoot := filepath.Join(t.TempDir(), "runtime keys")
	config := "projects_home=../project packages\nkeys_home=" + keyRoot + "\n"
	if err := os.WriteFile(
		filepath.Join(projectRoot, filterestLocalPathsFile),
		[]byte(config),
		0o600,
	); err != nil {
		t.Fatalf("write locator: %v", err)
	}

	envFiles, tlsCertFile, tlsKeyFile, err := resolveProjectPrivatePaths(projectRoot)
	if err != nil {
		t.Fatalf("resolveProjectPrivatePaths() error = %v", err)
	}
	profileRoot := filepath.Join(keyRoot, "filterest_runtime")
	if len(envFiles) != 2 ||
		envFiles[0] != filepath.Join(profileRoot, "development_environment.env") ||
		envFiles[1] != filepath.Join(profileRoot, "runtime_environment.env") {
		t.Fatalf("envFiles = %#v, want configured Filterest profile", envFiles)
	}
	if tlsCertFile != filepath.Join(profileRoot, "local_tls_certificate", "localhost_certificate.crt") {
		t.Fatalf("tlsCertFile = %q", tlsCertFile)
	}
	if tlsKeyFile != filepath.Join(profileRoot, "local_tls_certificate", "localhost_private_key.key") {
		t.Fatalf("tlsKeyFile = %q", tlsKeyFile)
	}
}

func TestResolveProjectPrivatePathsRejectsInvalidKeyRootOverride(t *testing.T) {
	projectRoot := t.TempDir()
	if err := os.Mkdir(filepath.Join(projectRoot, ".git"), 0o755); err != nil {
		t.Fatalf("mkdir source git marker: %v", err)
	}
	if err := os.WriteFile(filepath.Join(projectRoot, "VERSION_EASELECT"), []byte("test\n"), 0o644); err != nil {
		t.Fatalf("write source marker: %v", err)
	}

	for _, invalidRoot := range []string{"relative/keys", filepath.Join(projectRoot, "private")} {
		t.Run(invalidRoot, func(t *testing.T) {
			t.Setenv("EASELECT_KEY_ROOT", invalidRoot)
			if _, _, _, err := resolveProjectPrivatePaths(projectRoot); err == nil {
				t.Fatalf("resolveProjectPrivatePaths(%q) error = nil, want rejection", invalidRoot)
			}
		})
	}
}
