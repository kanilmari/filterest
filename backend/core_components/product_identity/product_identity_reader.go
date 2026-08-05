// product_identity_reader.go
// Detects whether the current checkout is private Easelect or public Filterest.
// Bridges root version marker files and runtime/frontend product identity checks.
// Exists so public core code can branch without importing private Easelect tools.
package productidentity

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type ProductKind string

const (
	KindEaselectPrivate ProductKind = "easelect_private"
	KindFilterestPublic ProductKind = "filterest_public"
	KindUnknown         ProductKind = "unknown"
)

// Identity is the JSON-friendly product identity contract exposed to the frontend.
type Identity struct {
	Kind                              ProductKind `json:"kind"`
	Name                              string      `json:"name"`
	PrivateUpstream                   bool        `json:"private_upstream"`
	PublicDistribution                bool        `json:"public_distribution"`
	AppVersionFile                    string      `json:"app_version_file"`
	Version                           string      `json:"version"`
	PrivateFrontendExtensionModuleURL string      `json:"private_frontend_extension_module_url,omitempty"`
}

var (
	privateExtensionMu        sync.RWMutex
	privateFrontendModuleURLs []string
)

// RegisterPrivateFrontendExtension adds an Easelect-only frontend extension entrypoint.
// Between private activation packages and product identity responses, it lets public
// frontend code discover private modules without hardcoding private paths.
func RegisterPrivateFrontendExtension(moduleURL string) {
	moduleURL = strings.TrimSpace(moduleURL)
	if moduleURL == "" {
		panic("private frontend extension module URL cannot be empty")
	}

	privateExtensionMu.Lock()
	defer privateExtensionMu.Unlock()
	for _, existingURL := range privateFrontendModuleURLs {
		if existingURL == moduleURL {
			return
		}
	}
	privateFrontendModuleURLs = append(privateFrontendModuleURLs, moduleURL)
}

// Detect reads the product marker files under root and returns the active identity.
// Between filesystem markers and runtime route/frontend code, it keeps the public
// Filterest branch independent from private Easelect activation packages.
func Detect(root string) Identity {
	root = strings.TrimSpace(root)
	if root == "" {
		if cwd, err := os.Getwd(); err == nil {
			root = cwd
		}
	}

	privateVersion, hasPrivateVersion := readMarkerVersion(root, "VERSION_EASELECT")
	publicVersion, hasPublicVersion := readMarkerVersion(root, "VERSION_APP")

	if hasPrivateVersion {
		return Identity{
			Kind:                              KindEaselectPrivate,
			Name:                              "Easelect",
			PrivateUpstream:                   true,
			PublicDistribution:                false,
			AppVersionFile:                    "VERSION_EASELECT",
			Version:                           privateVersion,
			PrivateFrontendExtensionModuleURL: firstPrivateFrontendModuleURL(),
		}
	}

	if hasPublicVersion {
		return Identity{
			Kind:               KindFilterestPublic,
			Name:               "Filterest",
			PrivateUpstream:    false,
			PublicDistribution: true,
			AppVersionFile:     "VERSION_APP",
			Version:            publicVersion,
		}
	}

	return Identity{
		Kind:               KindUnknown,
		Name:               "Unknown",
		PrivateUpstream:    false,
		PublicDistribution: false,
	}
}

// DetectFromWorkingDirectory is the normal runtime entrypoint for HTTP handlers.
func DetectFromWorkingDirectory() Identity {
	return Detect("")
}

func readMarkerVersion(root string, filename string) (string, bool) {
	if root == "" {
		return "", false
	}
	content, err := os.ReadFile(filepath.Join(root, filename))
	if err != nil {
		return "", false
	}
	return strings.TrimSpace(string(content)), true
}

func firstPrivateFrontendModuleURL() string {
	privateExtensionMu.RLock()
	defer privateExtensionMu.RUnlock()
	if len(privateFrontendModuleURLs) == 0 {
		return ""
	}
	return privateFrontendModuleURLs[0]
}
