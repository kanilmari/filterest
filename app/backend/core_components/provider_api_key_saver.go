// provider_api_key_saver.go
// Stores an administrator-provided AI provider API key in the active protected environment file.
// Bridges the admin configuration API, the runtime process environment and the Filterest key-location contract.
// Exists so a missing provider credential is fixed in the interface instead of by editing a server file over SSH.
package backend

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"easelect/backend/core_components/runtimepaths"
)

// Provider identifiers accepted by the administrator-facing key form. They are
// the same words the embedding status report and the chat prompt already use.
const (
	APIKeyProviderOpenAI = "openai"
	APIKeyProviderGoogle = "google"
)

// providerAPIKeyEnvironmentNames is the one place that decides which provider
// credentials the interface may write, and under which environment name each
// one is stored. A provider that is not listed here cannot be saved at all,
// so an administrator form can never reach an arbitrary setting.
var providerAPIKeyEnvironmentNames = map[string]string{
	APIKeyProviderOpenAI: "OPENAI_API_KEY",
	APIKeyProviderGoogle: "GOOGLE_API_KEY",
}

var (
	// ErrInvalidProviderAPIKey is safe for an HTTP handler to map to a client error.
	// It never carries the submitted value.
	ErrInvalidProviderAPIKey = errors.New("invalid provider API key")

	// ErrUnknownAPIKeyProvider means the request named a provider this
	// installation does not store a key for.
	ErrUnknownAPIKeyProvider = errors.New("unknown API key provider")

	// ErrProtectedEnvironmentNotWritable means this installation keeps its
	// settings somewhere the running application cannot write: typically a
	// container that receives its environment from the host instead of from a
	// mounted file. The caller must say so plainly rather than report success.
	ErrProtectedEnvironmentNotWritable = errors.New("protected environment file cannot be written by the application")

	providerAPIKeySaveMu sync.Mutex
)

// ProviderAPIKeyEnvironmentName returns the environment name a provider's key
// is stored under, and whether the provider is known at all.
func ProviderAPIKeyEnvironmentName(provider string) (string, bool) {
	environmentName, known := providerAPIKeyEnvironmentNames[NormalizeAPIKeyProvider(provider)]
	return environmentName, known
}

// NormalizeAPIKeyProvider is the single spelling rule for a provider name, so
// the saver and the routes that answer about it never disagree.
func NormalizeAPIKeyProvider(provider string) string {
	return strings.ToLower(strings.TrimSpace(provider))
}

// SaveProviderAPIKey stores one provider's secret in the environment file this
// installation actually reads.
// Between: the admin-only HTTP boundary and the resolved Filterest/Easelect private key location.
// Why: makes the new key available immediately while keeping it out of logs, responses and Git.
func SaveProviderAPIKey(provider string, apiKey string) error {
	return saveProviderAPIKeyToProjectEnvironment(
		runtimepaths.Current().InstallationRoot,
		provider,
		apiKey,
	)
}

// SaveOpenAIAPIKey keeps the chat prompt's existing entry point unchanged while
// the one implementation above owns the behaviour.
func SaveOpenAIAPIKey(apiKey string) error {
	return SaveProviderAPIKey(APIKeyProviderOpenAI, apiKey)
}

func saveProviderAPIKeyToProjectEnvironment(projectRoot string, provider string, apiKey string) error {
	environmentName, known := ProviderAPIKeyEnvironmentName(provider)
	if !known {
		return ErrUnknownAPIKeyProvider
	}

	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" || len(apiKey) > 4096 || strings.ContainsAny(apiKey, "\r\n\x00") {
		return ErrInvalidProviderAPIKey
	}

	providerAPIKeySaveMu.Lock()
	defer providerAPIKeySaveMu.Unlock()

	envFiles, _, _, err := resolveProjectPrivatePaths(projectRoot)
	if err != nil {
		return fmt.Errorf("resolve protected environment file: %w", err)
	}
	targetPath, currentContent, err := selectProviderAPIKeyEnvironmentFile(envFiles, environmentName)
	if err != nil {
		return err
	}
	updatedContent, err := replaceEnvironmentSecret(currentContent, environmentName, apiKey)
	if err != nil {
		return err
	}
	if err := atomicallyWriteProtectedEnvironmentFile(targetPath, updatedContent); err != nil {
		return err
	}
	if err := os.Setenv(environmentName, apiKey); err != nil {
		return fmt.Errorf("%s was saved but could not be activated in the running process", environmentName)
	}
	return nil
}

// selectProviderAPIKeyEnvironmentFile picks the protected file that already
// declares this provider's key, or the runtime scaffold when none does.
func selectProviderAPIKeyEnvironmentFile(envFiles []string, environmentName string) (string, []byte, error) {
	type existingEnvironmentFile struct {
		path    string
		content []byte
	}
	existingFiles := make([]existingEnvironmentFile, 0, len(envFiles))
	for _, envFile := range envFiles {
		info, err := os.Lstat(envFile)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return "", nil, fmt.Errorf("inspect protected environment file: %w", err)
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return "", nil, errors.New("protected environment file must be a regular file")
		}
		content, err := os.ReadFile(envFile)
		if err != nil {
			return "", nil, fmt.Errorf("read protected environment file: %w", err)
		}
		candidate := existingEnvironmentFile{path: envFile, content: content}
		existingFiles = append(existingFiles, candidate)
		if environmentContentDeclaresKey(content, environmentName) {
			return candidate.path, candidate.content, nil
		}
	}
	if len(existingFiles) == 0 {
		// A deployment that injects its environment from outside the container
		// has no file here at all. That is a configuration fact, not a bug.
		return "", nil, ErrProtectedEnvironmentNotWritable
	}
	// The last loaded file is the runtime/.env scaffold when no earlier file
	// already owns the key declaration.
	target := existingFiles[len(existingFiles)-1]
	return target.path, target.content, nil
}

func environmentContentDeclaresKey(content []byte, key string) bool {
	for _, line := range strings.Split(string(content), "\n") {
		if environmentAssignmentKey(line) == key {
			return true
		}
	}
	return false
}

func environmentAssignmentKey(line string) string {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" || strings.HasPrefix(trimmed, "#") {
		return ""
	}
	if strings.HasPrefix(trimmed, "export ") {
		trimmed = strings.TrimSpace(strings.TrimPrefix(trimmed, "export "))
	}
	key, _, found := strings.Cut(trimmed, "=")
	if !found {
		return ""
	}
	return strings.TrimSpace(key)
}

func replaceEnvironmentSecret(content []byte, key string, secret string) ([]byte, error) {
	lines := strings.Split(strings.ReplaceAll(string(content), "\r\n", "\n"), "\n")
	foundIndex := -1
	for index, line := range lines {
		if environmentAssignmentKey(line) != key {
			continue
		}
		if foundIndex >= 0 {
			return nil, fmt.Errorf("protected environment file contains duplicate %s declarations", key)
		}
		foundIndex = index
	}
	assignment := key + "=" + secret
	if foundIndex >= 0 {
		lines[foundIndex] = assignment
	} else {
		if len(lines) > 0 && lines[len(lines)-1] != "" {
			lines = append(lines, "")
		}
		lines = append(lines, assignment, "")
	}
	return []byte(strings.Join(lines, "\n")), nil
}

// atomicallyWriteProtectedEnvironmentFile replaces the file in one rename, so a
// reader never sees a half-written settings file. Every failure to place the
// new file is reported as "not writable here": the administrator's next action
// is the same whether the folder is read-only, owned by another user or full.
func atomicallyWriteProtectedEnvironmentFile(targetPath string, content []byte) error {
	targetDirectory := filepath.Dir(targetPath)
	temporaryFile, err := os.CreateTemp(targetDirectory, ".provider-key-*.tmp")
	if err != nil {
		return fmt.Errorf("%w: create protected environment update: %v", ErrProtectedEnvironmentNotWritable, err)
	}
	temporaryPath := temporaryFile.Name()
	cleanup := func() {
		_ = temporaryFile.Close()
		_ = os.Remove(temporaryPath)
	}
	defer cleanup()

	if err := temporaryFile.Chmod(0o600); err != nil {
		return fmt.Errorf("protect environment update: %w", err)
	}
	if _, err := temporaryFile.Write(content); err != nil {
		return fmt.Errorf("write environment update: %w", err)
	}
	if err := temporaryFile.Sync(); err != nil {
		return fmt.Errorf("sync environment update: %w", err)
	}
	if err := temporaryFile.Close(); err != nil {
		return fmt.Errorf("close environment update: %w", err)
	}
	if err := os.Rename(temporaryPath, targetPath); err != nil {
		return fmt.Errorf("%w: install environment update: %v", ErrProtectedEnvironmentNotWritable, err)
	}
	if directory, err := os.Open(targetDirectory); err == nil {
		_ = directory.Sync()
		_ = directory.Close()
	}
	return nil
}
