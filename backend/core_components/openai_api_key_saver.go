// openai_api_key_saver.go
// Stores the administrator-provided OpenAI API key in the active protected environment file.
// Bridges the admin configuration API, runtime process environment, and Filterest key-location contract.
// Exists so a missing chat credential can be fixed without exposing or directly editing database state.
package backend

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const openAIAPIKeyEnvironmentName = "OPENAI_API_KEY"

var (
	// ErrInvalidOpenAIAPIKey is safe for an HTTP handler to map to a client error.
	ErrInvalidOpenAIAPIKey = errors.New("invalid OpenAI API key")
	openAIAPIKeySaveMu     sync.Mutex
)

// SaveOpenAIAPIKey stores a secret in the environment file currently used by this checkout.
// Between: the admin-only HTTP boundary and the resolved Filterest/Easelect private key location.
// Why: makes the new key available immediately while keeping it out of logs, responses, and Git.
func SaveOpenAIAPIKey(apiKey string) error {
	projectRoot, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("resolve project root: %w", err)
	}
	return saveOpenAIAPIKeyToProjectEnvironment(projectRoot, apiKey)
}

func saveOpenAIAPIKeyToProjectEnvironment(projectRoot string, apiKey string) error {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" || len(apiKey) > 4096 || strings.ContainsAny(apiKey, "\r\n\x00") {
		return ErrInvalidOpenAIAPIKey
	}

	openAIAPIKeySaveMu.Lock()
	defer openAIAPIKeySaveMu.Unlock()

	envFiles, _, _, err := resolveProjectPrivatePaths(projectRoot)
	if err != nil {
		return fmt.Errorf("resolve protected environment file: %w", err)
	}
	targetPath, currentContent, err := selectOpenAIAPIKeyEnvironmentFile(envFiles)
	if err != nil {
		return err
	}
	updatedContent, err := replaceEnvironmentSecret(currentContent, openAIAPIKeyEnvironmentName, apiKey)
	if err != nil {
		return err
	}
	if err := atomicallyWriteProtectedEnvironmentFile(targetPath, updatedContent); err != nil {
		return err
	}
	if err := os.Setenv(openAIAPIKeyEnvironmentName, apiKey); err != nil {
		return errors.New("OpenAI API key was saved but could not be activated in the running process")
	}
	return nil
}

func selectOpenAIAPIKeyEnvironmentFile(envFiles []string) (string, []byte, error) {
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
		if environmentContentDeclaresKey(content, openAIAPIKeyEnvironmentName) {
			return candidate.path, candidate.content, nil
		}
	}
	if len(existingFiles) == 0 {
		return "", nil, errors.New("no protected environment file is available")
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

func atomicallyWriteProtectedEnvironmentFile(targetPath string, content []byte) error {
	targetDirectory := filepath.Dir(targetPath)
	temporaryFile, err := os.CreateTemp(targetDirectory, ".openai-key-*.tmp")
	if err != nil {
		return fmt.Errorf("create protected environment update: %w", err)
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
		return fmt.Errorf("install environment update: %w", err)
	}
	if directory, err := os.Open(targetDirectory); err == nil {
		_ = directory.Sync()
		_ = directory.Close()
	}
	return nil
}
