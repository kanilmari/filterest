// release_manifest_contract_validator.go
// Parses and validates authenticated release requirements.
// Connects manifest fields, shared build identity and installation prerequisites.
// Rejects unsupported versions and inconsistent cross-field release claims.
package release_updates

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

const MaxManifestBytes = 4 << 20

var (
	ErrInvalidManifest       = errors.New("invalid release manifest")
	contractVersionPattern   = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)
	contractCommitPattern    = regexp.MustCompile(`^[0-9a-f]{40}$`)
	contractHashPattern      = regexp.MustCompile(`^[0-9a-f]{64}$`)
	contractIDPattern        = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,63}$`)
	contractTagPattern       = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
	contractNamePattern      = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$`)
	contractMigrationPattern = regexp.MustCompile(`^[0-9]{14}_[a-z0-9_]+\.sql$`)
)

// ManifestV1 describes authenticated release requirements, not installation eligibility.
type ManifestV1 struct {
	SchemaVersion              int                    `json:"schema_version"`
	ManifestType               string                 `json:"manifest_type"`
	Publisher                  string                 `json:"publisher"`
	ReleaseID                  string                 `json:"release_id"`
	CreatedAt                  string                 `json:"created_at"`
	Product                    string                 `json:"product"`
	Version                    string                 `json:"version"`
	ReleaseTag                 string                 `json:"release_tag"`
	PublishedCommit            string                 `json:"published_commit"`
	MinimumTrustPolicyRevision uint64                 `json:"minimum_trust_policy_revision"`
	BuildIdentity              BuildIdentityV1        `json:"build_identity"`
	Composition                CompositionV1          `json:"composition"`
	Artifacts                  []ArtifactV1           `json:"artifacts"`
	Database                   DatabaseRouteV1        `json:"database"`
	Protocol                   ProtocolV1             `json:"protocol"`
	Platform                   PlatformRequirementsV1 `json:"platform"`
	Health                     HealthRequirementsV1   `json:"health"`
	Recovery                   RecoveryRequirementsV1 `json:"recovery"`
	Capacity                   CapacityRequirementsV1 `json:"capacity"`
}

// BuildIdentityV1 retains the existing Python contract's field meanings. The
// source commit identifies reviewed source; PublishedCommit identifies the final tree.
type BuildIdentityV1 struct {
	SchemaVersion      int             `json:"schema_version"`
	Product            string          `json:"product"`
	BuildID            string          `json:"build_id"`
	LedgerRecordID     string          `json:"ledger_record_id"`
	LedgerRecordSHA256 string          `json:"ledger_record_sha256"`
	AppVersion         string          `json:"app_version"`
	ArtifactType       string          `json:"artifact_type"`
	Channel            string          `json:"channel"`
	Maturity           string          `json:"maturity"`
	Source             BuildSourceV1   `json:"source"`
	Database           BuildDatabaseV1 `json:"database"`
	CreatedAt          string          `json:"created_at"`
}

type BuildSourceV1 struct {
	Model  string `json:"model"`
	Commit string `json:"commit"`
}
type BuildDatabaseV1 struct {
	MinVersion    string `json:"min_version"`
	TargetVersion string `json:"target_version"`
}
type CompositionV1 struct {
	ID         string           `json:"id"`
	Revision   uint64           `json:"revision"`
	Components []ComponentPinV1 `json:"components"`
}
type ComponentPinV1 struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	Commit  string `json:"commit"`
}
type ArtifactV1 struct {
	Name              string             `json:"name"`
	Kind              string             `json:"kind"`
	SizeBytes         uint64             `json:"size_bytes"`
	ExpandedSizeBytes uint64             `json:"expanded_size_bytes"`
	SHA256            string             `json:"sha256"`
	Platform          ArtifactPlatformV1 `json:"platform"`
	OCI               *OCIDescriptorsV1  `json:"oci,omitempty"`
}
type OCIDescriptorsV1 struct {
	ManifestDigest string `json:"manifest_digest"`
	ConfigDigest   string `json:"config_digest"`
}
type ArtifactPlatformV1 struct {
	OS           string             `json:"os"`
	Architecture string             `json:"architecture"`
	CPUFeatures  []string           `json:"cpu_features"`
	Libc         *LibcRequirementV1 `json:"libc,omitempty"`
}
type LibcRequirementV1 struct {
	Family     string `json:"family"`
	MinVersion string `json:"min_version"`
}
type DatabaseRouteV1 struct {
	MinVersion      string            `json:"min_version"`
	TargetVersion   string            `json:"target_version"`
	SupportedStarts []DatabaseStartV1 `json:"supported_starts"`
	Migrations      []MigrationV1     `json:"migrations"`
}
type DatabaseStartV1 struct {
	AppVersion          string   `json:"app_version"`
	DatabaseVersion     string   `json:"database_version"`
	CompositionRevision uint64   `json:"composition_revision"`
	MigrationIDs        []string `json:"migration_ids"`
}
type MigrationV1 struct {
	ID                       string `json:"id"`
	Component                string `json:"component"`
	ContentSHA256            string `json:"content_sha256"`
	DatabaseVersion          string `json:"database_version"`
	PublishesDatabaseVersion bool   `json:"publishes_database_version"`
	TransactionPolicy        string `json:"transaction_policy"`
	ErrorPolicy              string `json:"error_policy"`
}
type ProtocolV1 struct {
	Version              int      `json:"version"`
	RequiredCapabilities []string `json:"required_capabilities"`
}
type PlatformRequirementsV1 struct {
	Targets    []ArtifactPlatformV1     `json:"targets"`
	PostgreSQL PostgreSQLRequirementsV1 `json:"postgresql"`
	Docker     *DockerRequirementsV1    `json:"docker,omitempty"`
}
type PostgreSQLRequirementsV1 struct {
	MinMajor   uint64                   `json:"min_major"`
	MaxMajor   uint64                   `json:"max_major"`
	Extensions []ExtensionRequirementV1 `json:"extensions"`
}
type ExtensionRequirementV1 struct {
	Name       string `json:"name"`
	MinVersion string `json:"min_version"`
}
type DockerRequirementsV1 struct {
	MinEngineVersion  string `json:"min_engine_version"`
	MinComposeVersion string `json:"min_compose_version"`
}
type HealthRequirementsV1 struct {
	HealthPath           string `json:"health_path"`
	ReadyPath            string `json:"ready_path"`
	GrantsReconciled     bool   `json:"grants_reconciled"`
	ExactBuildIdentity   bool   `json:"exact_build_identity"`
	ExactAppVersion      bool   `json:"exact_app_version"`
	ExactDatabaseVersion bool   `json:"exact_database_version"`
	ExactComposition     bool   `json:"exact_composition"`
	ExactInstallation    bool   `json:"exact_installation"`
}
type RecoveryRequirementsV1 struct {
	Mode                string   `json:"mode"`
	BackupScopes        []string `json:"backup_scopes"`
	ProtectedBackup     bool     `json:"protected_backup"`
	OffHostCopy         bool     `json:"off_host_copy"`
	RestoreTestRequired bool     `json:"restore_test_required"`
}
type CapacityRequirementsV1 struct {
	ReserveBytes   uint64                 `json:"reserve_bytes"`
	ReservePercent uint64                 `json:"reserve_percent"`
	RequireInodes  bool                   `json:"require_inodes"`
	Allocations    []CapacityAllocationV1 `json:"allocations"`
}
type CapacityAllocationV1 struct {
	Purpose string `json:"purpose"`
	Bytes   uint64 `json:"bytes"`
	Inodes  uint64 `json:"inodes"`
}

// ParseManifest rejects unsupported versions and ambiguous JSON before interpreting requirements.
func ParseManifest(data []byte) (*ManifestV1, error) {
	var manifest ManifestV1
	if err := decodeContractJSON(data, MaxManifestBytes, &manifest); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidManifest, err)
	}
	if err := validateManifest(manifest); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidManifest, err)
	}
	return &manifest, nil
}

func validateManifest(m ManifestV1) error {
	if m.SchemaVersion != 1 || m.ManifestType != "filterest_release" || m.Protocol.Version != 1 {
		return errors.New("unsupported manifest or updater protocol version")
	}
	if !contractIDPattern.MatchString(m.Publisher) || !contractTagPattern.MatchString(m.ReleaseID) || !contractIDPattern.MatchString(m.Product) || m.Composition.ID != m.Product || m.Composition.Revision == 0 || m.MinimumTrustPolicyRevision == 0 {
		return errors.New("invalid envelope or composition")
	}
	created, err := contractTime(m.CreatedAt)
	if err != nil {
		return err
	}
	if !contractVersionPattern.MatchString(m.Version) || !contractTagPattern.MatchString(m.ReleaseTag) || !contractCommitPattern.MatchString(m.PublishedCommit) {
		return errors.New("invalid release version, tag or published commit")
	}
	if m.Product == "filterest" && m.ReleaseTag != "v"+m.Version {
		return errors.New("public release tag must match platform version")
	}
	if err := validateManifestIdentity(m.BuildIdentity); err != nil {
		return err
	}
	identityTime, _ := contractTime(m.BuildIdentity.CreatedAt)
	if created.Before(identityTime) || m.Version != m.BuildIdentity.AppVersion || m.Database.MinVersion != m.BuildIdentity.Database.MinVersion || m.Database.TargetVersion != m.BuildIdentity.Database.TargetVersion {
		return errors.New("release and build identity disagree")
	}
	components := map[string]ComponentPinV1{}
	for _, c := range m.Composition.Components {
		if !contractIDPattern.MatchString(c.ID) || !contractVersionPattern.MatchString(c.Version) || !contractCommitPattern.MatchString(c.Commit) {
			return errors.New("invalid component pin")
		}
		if _, found := components[c.ID]; found {
			return errors.New("duplicate component pin")
		}
		components[c.ID] = c
	}
	core, found := components["filterest"]
	if !found || core.Version != m.Version {
		return errors.New("composition must pin the shared Filterest platform version")
	}
	product, found := components[m.Product]
	if !found || product.Commit != m.PublishedCommit || (m.Product == "filterest" && len(components) != 1) {
		return errors.New("published commit must match the product component")
	}
	if err := validateManifestArtifacts(m); err != nil {
		return err
	}
	if err := validateManifestDatabase(m, components); err != nil {
		return err
	}
	return validateManifestRequirements(m)
}

func validateManifestIdentity(b BuildIdentityV1) error {
	if b.SchemaVersion != 1 || b.Product != "filterest" || b.ArtifactType != "runtime" || b.Channel != "stable" || b.Maturity != "published" {
		return errors.New("manifest requires a published stable runtime build identity")
	}
	if !contractVersionPattern.MatchString(b.AppVersion) || !contractVersionPattern.MatchString(b.Database.MinVersion) || !contractVersionPattern.MatchString(b.Database.TargetVersion) || compareContractVersions(b.Database.TargetVersion, b.Database.MinVersion) < 0 || !contractHashPattern.MatchString(b.LedgerRecordSHA256) || !contractCommitPattern.MatchString(b.Source.Commit) || (b.Source.Model != "public_first" && b.Source.Model != "legacy_maintainer_export") {
		return errors.New("invalid build identity dimensions")
	}
	if _, err := contractTime(b.CreatedAt); err != nil {
		return err
	}
	buildID := "filterest-" + b.AppVersion + "-stable-runtime-" + b.Source.Commit[:12]
	if b.BuildID != buildID || b.LedgerRecordID != "build:"+buildID {
		return errors.New("build identity identifiers disagree")
	}
	return nil
}

func validateManifestArtifacts(m ManifestV1) error {
	if len(m.Artifacts) == 0 {
		return errors.New("release has no artifacts")
	}
	names := map[string]bool{}
	for _, a := range m.Artifacts {
		if !contractNamePattern.MatchString(a.Name) || names[a.Name] || a.SizeBytes == 0 || a.ExpandedSizeBytes < a.SizeBytes || !contractHashPattern.MatchString(a.SHA256) {
			return errors.New("invalid or duplicate artifact")
		}
		names[a.Name] = true
		if err := validateArtifactPlatform(a.Platform); err != nil {
			return err
		}
		switch a.Kind {
		case "binary", "verifier_binary":
			if a.Platform.OS == "any" || a.ExpandedSizeBytes != a.SizeBytes {
				return errors.New("binary must declare a native platform and exact size")
			}
		case "oci_archive":
			if a.Platform.OS == "any" || a.OCI == nil || m.Platform.Docker == nil {
				return errors.New("OCI archive requires platform, descriptors and Docker requirements")
			}
		case "source_archive", "notice", "checksum":
			if a.Platform.OS != "any" {
				return errors.New("portable artifact must use the any platform")
			}
		default:
			return errors.New("unknown artifact kind")
		}
		if a.OCI != nil {
			if a.Kind != "oci_archive" || !validOCIDigest(a.OCI.ManifestDigest) || !validOCIDigest(a.OCI.ConfigDigest) {
				return errors.New("invalid OCI descriptor combination")
			}
		}
		if a.Platform.OS != "any" {
			matched := false
			for _, p := range m.Platform.Targets {
				if samePlatform(p, a.Platform) {
					matched = true
				}
			}
			if !matched {
				return errors.New("artifact platform is not a declared release target")
			}
		}
	}
	return nil
}

func validateManifestDatabase(m ManifestV1, components map[string]ComponentPinV1) error {
	db := m.Database
	if len(db.SupportedStarts) == 0 {
		return errors.New("explicit database starting versions are required")
	}
	indices := map[string]int{}
	previous := ""
	for i, migration := range db.Migrations {
		_, owned := components[migration.Component]
		if !contractMigrationPattern.MatchString(migration.ID) || migration.ID <= previous || !owned || !contractHashPattern.MatchString(migration.ContentSHA256) || !contractVersionPattern.MatchString(migration.DatabaseVersion) || compareContractVersions(migration.DatabaseVersion, db.TargetVersion) > 0 || (migration.TransactionPolicy != "runner" && migration.TransactionPolicy != "self_managed") || (migration.ErrorPolicy != "required" && migration.ErrorPolicy != "optional") {
			return errors.New("invalid migration inventory or global order")
		}
		if migration.PublishesDatabaseVersion && migration.ErrorPolicy != "required" {
			return errors.New("database version ownership cannot be optional")
		}
		indices[migration.ID] = i
		previous = migration.ID
	}
	if len(db.Migrations) > 0 {
		owner := db.Migrations[len(db.Migrations)-1]
		if !owner.PublishesDatabaseVersion || owner.DatabaseVersion != db.TargetVersion {
			return errors.New("migration inventory must end with target version owner")
		}
	}
	starts := map[string]bool{}
	for _, start := range db.SupportedStarts {
		key := fmt.Sprintf("%s/%s/%d", start.AppVersion, start.DatabaseVersion, start.CompositionRevision)
		if !contractVersionPattern.MatchString(start.AppVersion) || !contractVersionPattern.MatchString(start.DatabaseVersion) || start.CompositionRevision == 0 || start.CompositionRevision >= m.Composition.Revision || compareContractVersions(start.AppVersion, m.Version) > 0 || compareContractVersions(start.DatabaseVersion, db.TargetVersion) > 0 || starts[key] {
			return errors.New("invalid or duplicate database starting combination")
		}
		starts[key] = true
		last := -1
		for _, id := range start.MigrationIDs {
			index, ok := indices[id]
			if !ok || index <= last {
				return errors.New("database route must reference unique globally ordered migrations")
			}
			last = index
		}
		if len(start.MigrationIDs) == 0 {
			if start.DatabaseVersion != db.TargetVersion {
				return errors.New("database version change needs an explicit migration route")
			}
		} else {
			owner := db.Migrations[last]
			if !owner.PublishesDatabaseVersion || owner.DatabaseVersion != db.TargetVersion {
				return errors.New("database route must end with target version owner")
			}
		}
	}
	return nil
}

func validateArtifactPlatform(p ArtifactPlatformV1) error {
	if err := uniqueContractIDs(p.CPUFeatures); err != nil {
		return err
	}
	if p.OS == "any" {
		if p.Architecture != "any" || len(p.CPUFeatures) != 0 || p.Libc != nil {
			return errors.New("portable platform cannot require CPU or libc")
		}
		return nil
	}
	if p.OS != "linux" || (p.Architecture != "amd64" && p.Architecture != "arm64") {
		return errors.New("unsupported platform")
	}
	if p.Libc != nil && ((p.Libc.Family != "glibc" && p.Libc.Family != "musl") || !contractVersionPattern.MatchString(p.Libc.MinVersion)) {
		return errors.New("invalid libc requirement")
	}
	return nil
}

func validateManifestRequirements(m ManifestV1) error {
	if err := uniqueContractIDs(m.Protocol.RequiredCapabilities); err != nil {
		return err
	}
	if len(m.Platform.Targets) == 0 {
		return errors.New("platform targets are required")
	}
	for i, p := range m.Platform.Targets {
		if err := validateArtifactPlatform(p); err != nil {
			return err
		}
		if p.OS == "any" {
			return errors.New("release targets must be native")
		}
		for _, prior := range m.Platform.Targets[:i] {
			if samePlatform(prior, p) {
				return errors.New("duplicate platform target")
			}
		}
	}
	pg := m.Platform.PostgreSQL
	if pg.MinMajor == 0 || pg.MaxMajor < pg.MinMajor {
		return errors.New("invalid PostgreSQL version range")
	}
	extensions := map[string]bool{}
	for _, e := range pg.Extensions {
		if !contractIDPattern.MatchString(e.Name) || !contractVersionPattern.MatchString(e.MinVersion) || extensions[e.Name] {
			return errors.New("invalid or duplicate PostgreSQL extension")
		}
		extensions[e.Name] = true
	}
	if d := m.Platform.Docker; d != nil && (!contractVersionPattern.MatchString(d.MinEngineVersion) || !contractVersionPattern.MatchString(d.MinComposeVersion)) {
		return errors.New("invalid Docker version requirements")
	}
	h := m.Health
	if h.HealthPath != "/health" || h.ReadyPath != "/system/ready" || !h.GrantsReconciled || !h.ExactBuildIdentity || !h.ExactAppVersion || !h.ExactDatabaseVersion || !h.ExactComposition || !h.ExactInstallation {
		return errors.New("all exact health and identity gates are required")
	}
	r := m.Recovery
	if r.Mode != "restore_before_reopening" || !r.ProtectedBackup || !r.OffHostCopy || !r.RestoreTestRequired || !exactContractSet(r.BackupScopes, []string{"database", "database_roles", "media", "settings", "projects", "previous_release"}) {
		return errors.New("complete protected off-host backups and tested restore are required")
	}
	c := m.Capacity
	if c.ReserveBytes == 0 || c.ReservePercent == 0 || c.ReservePercent > 100 || !c.RequireInodes {
		return errors.New("byte, percentage and inode reserves are required")
	}
	purposes := []string{"staging", "expanded_release", "retained_release", "database_backup", "media_backup", "settings_backup", "projects_backup"}
	if m.Platform.Docker != nil {
		purposes = append(purposes, "docker_storage")
	}
	actual := make([]string, 0, len(c.Allocations))
	for _, allocation := range c.Allocations {
		if allocation.Bytes == 0 || allocation.Inodes == 0 {
			return errors.New("capacity allocations need positive bytes and inodes")
		}
		actual = append(actual, allocation.Purpose)
	}
	if !exactContractSet(actual, purposes) {
		return errors.New("capacity allocations must cover the installation requirements exactly")
	}
	return nil
}

func contractTime(value string) (time.Time, error) {
	parsed, err := time.Parse("2006-01-02T15:04:05Z", value)
	if err != nil || parsed.Format("2006-01-02T15:04:05Z") != value {
		return time.Time{}, errors.New("timestamp must be a real UTC YYYY-MM-DDTHH:MM:SSZ value")
	}
	return parsed, nil
}

// Compare decimal segments by length first; no machine-integer overflow changes ordering.
func compareContractVersions(left, right string) int {
	l, r := strings.Split(left, "."), strings.Split(right, ".")
	for i := 0; i < 3; i++ {
		if len(l[i]) < len(r[i]) {
			return -1
		}
		if len(l[i]) > len(r[i]) {
			return 1
		}
		if l[i] < r[i] {
			return -1
		}
		if l[i] > r[i] {
			return 1
		}
	}
	return 0
}

func uniqueContractIDs(values []string) error {
	seen := map[string]bool{}
	for _, v := range values {
		if !contractIDPattern.MatchString(v) || seen[v] {
			return errors.New("invalid or duplicate requirement identifier")
		}
		seen[v] = true
	}
	return nil
}

func exactContractSet(actual, expected []string) bool {
	if len(actual) != len(expected) {
		return false
	}
	seen := map[string]bool{}
	for _, v := range actual {
		if seen[v] {
			return false
		}
		seen[v] = true
	}
	for _, v := range expected {
		if !seen[v] {
			return false
		}
	}
	return true
}

func validOCIDigest(value string) bool {
	return strings.HasPrefix(value, "sha256:") && contractHashPattern.MatchString(strings.TrimPrefix(value, "sha256:"))
}

func samePlatform(a, b ArtifactPlatformV1) bool {
	if a.OS != b.OS || a.Architecture != b.Architecture || !exactContractSet(a.CPUFeatures, b.CPUFeatures) || (a.Libc == nil) != (b.Libc == nil) {
		return false
	}
	return a.Libc == nil || *a.Libc == *b.Libc
}
