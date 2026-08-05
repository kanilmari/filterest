// env_loader.go
// Loads environment variables from the native-local dev files and .env fallbacks.
// In Docker deployments environment variables are injected via docker-compose files.
// ENVIRONMENT_TYPE now fails closed to "prod" unless development is set explicitly.
package backend

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/joho/godotenv"
)

var (
	envLoaded     bool
	envLoadedType string
	envLoadMu     sync.Mutex
)

// LoadEnvironmentVariables loads .env file (if present) and returns the
// environment type. Docker environment variables take precedence.
// Returns "prod" by default unless development is requested explicitly.
func LoadEnvironmentVariables() (string, error) {
	envLoadMu.Lock()
	defer envLoadMu.Unlock()

	envType, err := loadAndSetEnvironmentVariables()
	envLoaded = true
	envLoadedType = envType

	return envType, err
}

func ensureEnvironmentVariablesLoaded() (string, error) {
	envLoadMu.Lock()
	loaded := envLoaded
	envType := envLoadedType
	envLoadMu.Unlock()

	if loaded {
		return envType, nil
	}

	return LoadEnvironmentVariables()
}

func loadAndSetEnvironmentVariables() (string, error) {
	projectRoot, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("resolve project root: %w", err)
	}
	envFiles, tlsCertFile, tlsKeyFile, err := resolveProjectPrivatePaths(projectRoot)
	if err != nil {
		return "", err
	}

	// Native development settings win over runtime defaults, while already
	// exported Docker, deployment, or operator values remain authoritative.
	for _, envFile := range envFiles {
		if err := loadEnvironmentFileIfPresent(envFile); err != nil {
			return "", err
		}
	}
	setEnvironmentDefault("TLS_CERT_FILE", tlsCertFile)
	setEnvironmentDefault("TLS_KEY_FILE", tlsKeyFile)

	// Get environment type: fail closed to production unless development is explicit.
	envType := strings.TrimSpace(os.Getenv("ENVIRONMENT_TYPE"))
	if envType == "" {
		envType = "prod"
	}

	// Ensure ENVIRONMENT_TYPE is set for other packages
	_ = os.Setenv("ENVIRONMENT_TYPE", envType)

	return envType, nil
}

// resolveProjectPrivatePaths separates the private Easelect source checkout
// from generated Filterest and deployed runtimes. Easelect derives all four
// files from one external key root; other runtimes keep root-local files.
func resolveProjectPrivatePaths(projectRoot string) ([]string, string, string, error) {
	isPrivateSource, err := isPrivateEaselectSourceCheckout(projectRoot)
	if err != nil {
		return nil, "", "", err
	}
	homes, err := resolveFilterestHomes(projectRoot, isPrivateSource)
	if err != nil {
		return nil, "", "", err
	}
	if !isPrivateSource && !homes.KeysHomeConfigured {
		return []string{
			filepath.Join(projectRoot, "dev_env.txt"),
			filepath.Join(projectRoot, ".env"),
		}, "", "", nil
	}

	profileName := "filterest_runtime"
	if isPrivateSource {
		profileName = "easelect_development"
	}
	developmentRoot := filepath.Join(homes.KeysHome, profileName)
	return []string{
			filepath.Join(developmentRoot, "development_environment.env"),
			filepath.Join(developmentRoot, "runtime_environment.env"),
		},
		filepath.Join(developmentRoot, "local_tls_certificate", "localhost_certificate.crt"),
		filepath.Join(developmentRoot, "local_tls_certificate", "localhost_private_key.key"),
		nil
}

func isPrivateEaselectSourceCheckout(projectRoot string) (bool, error) {
	for _, marker := range []string{".git", "VERSION_EASELECT"} {
		if _, err := os.Stat(filepath.Join(projectRoot, marker)); err != nil {
			if os.IsNotExist(err) {
				return false, nil
			}
			return false, fmt.Errorf("inspect Easelect source marker %s: %w", marker, err)
		}
	}
	return true, nil
}

func setEnvironmentDefault(key string, value string) {
	if value == "" || os.Getenv(key) != "" {
		return
	}
	_ = os.Setenv(key, value)
}

func loadEnvironmentFileIfPresent(envFile string) error {
	if err := godotenv.Load(envFile); err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("%s: %w", envFile, err)
		}
	}

	return nil
}
