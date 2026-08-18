// product_identity_reader.go
// Detects Filterest product identity from validated build data or compatibility markers.
// Bridges root version files with runtime/frontend identity and release classification.
// Exists so one product name can coexist with protected transition-only source extensions.
package productidentity

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type ProductKind string
type ReleaseChannel string
type ArtifactPurpose string
type ArtifactType string
type ReleaseMaturity string
type IdentityVerification string
type IdentitySource string

const (
	KindEaselectPrivate ProductKind = "easelect_private"
	KindFilterestPublic ProductKind = "filterest_public"
	KindUnknown         ProductKind = "unknown"

	ReleaseChannelDevelopment ReleaseChannel = "development"
	ReleaseChannelStable      ReleaseChannel = "stable"
	ReleaseChannelUnknown     ReleaseChannel = "unknown"

	ArtifactPurposeDeveloperBackup ArtifactPurpose = "developer_backup"
	ArtifactPurposePublicRelease   ArtifactPurpose = "public_release"
	ArtifactPurposeUnknown         ArtifactPurpose = "unknown"

	ArtifactTypeRuntime ArtifactType = "runtime"
	ArtifactTypeBackup  ArtifactType = "backup"
	ArtifactTypeUnknown ArtifactType = "unknown"

	ReleaseMaturitySnapshot  ReleaseMaturity = "snapshot"
	ReleaseMaturityCandidate ReleaseMaturity = "candidate"
	ReleaseMaturityPublished ReleaseMaturity = "published"
	ReleaseMaturityUnknown   ReleaseMaturity = "unknown"

	IdentityVerificationLocalContract    IdentityVerification = "local_contract_validated"
	IdentityVerificationLegacyUnverified IdentityVerification = "legacy_unverified"
	IdentityVerificationUnverified       IdentityVerification = "unverified"

	IdentitySourceBuildIdentityV1 IdentitySource = "build_identity_v1"
	IdentitySourceLegacyMarker    IdentitySource = "legacy_marker"
	IdentitySourceUnknown         IdentitySource = "unknown"
)

// Identity is the JSON-friendly product identity contract exposed to the frontend.
type Identity struct {
	Kind                              ProductKind          `json:"kind"`
	Name                              string               `json:"name"`
	PrivateUpstream                   bool                 `json:"private_upstream"`
	PublicDistribution                bool                 `json:"public_distribution"`
	AppVersionFile                    string               `json:"app_version_file"`
	Version                           string               `json:"version"`
	ReleaseChannel                    ReleaseChannel       `json:"release_channel"`
	ArtifactPurpose                   ArtifactPurpose      `json:"artifact_purpose"`
	ArtifactType                      ArtifactType         `json:"artifact_type"`
	Maturity                          ReleaseMaturity      `json:"maturity"`
	Verification                      IdentityVerification `json:"verification"`
	IdentitySource                    IdentitySource       `json:"identity_source"`
	BuildID                           string               `json:"build_id,omitempty"`
	LedgerRecordID                    string               `json:"ledger_record_id,omitempty"`
	DatabaseMinVersion                string               `json:"database_min_version,omitempty"`
	DatabaseTargetVersion             string               `json:"database_target_version,omitempty"`
	PrivateFrontendExtensionModuleURL string               `json:"private_frontend_extension_module_url,omitempty"`
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

	if identity, buildIdentityPresent := detectBuildIdentity(root); buildIdentityPresent {
		return identity
	}

	privateVersion, hasPrivateVersion := readMarkerVersion(root, "VERSION_EASELECT")
	publicVersion, hasPublicVersion := readMarkerVersion(root, "VERSION_APP")

	if hasPrivateVersion {
		return Identity{
			Kind:                              KindEaselectPrivate,
			Name:                              "Filterest",
			PrivateUpstream:                   true,
			PublicDistribution:                false,
			AppVersionFile:                    "VERSION_EASELECT",
			Version:                           privateVersion,
			ReleaseChannel:                    ReleaseChannelDevelopment,
			ArtifactPurpose:                   ArtifactPurposeUnknown,
			ArtifactType:                      ArtifactTypeRuntime,
			Maturity:                          ReleaseMaturitySnapshot,
			Verification:                      IdentityVerificationLegacyUnverified,
			IdentitySource:                    IdentitySourceLegacyMarker,
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
			ReleaseChannel:     ReleaseChannelUnknown,
			ArtifactPurpose:    ArtifactPurposeUnknown,
			ArtifactType:       ArtifactTypeUnknown,
			Maturity:           ReleaseMaturityUnknown,
			Verification:       IdentityVerificationLegacyUnverified,
			IdentitySource:     IdentitySourceLegacyMarker,
		}
	}

	return Identity{
		Kind:               KindUnknown,
		Name:               "Unknown",
		PrivateUpstream:    false,
		PublicDistribution: false,
		ReleaseChannel:     ReleaseChannelUnknown,
		ArtifactPurpose:    ArtifactPurposeUnknown,
		ArtifactType:       ArtifactTypeUnknown,
		Maturity:           ReleaseMaturityUnknown,
		Verification:       IdentityVerificationUnverified,
		IdentitySource:     IdentitySourceUnknown,
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
