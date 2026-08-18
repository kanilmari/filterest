// build_identity_reader.go
// Validates the generated Filterest build identity and its immutable ledger row.
// Bridges locally generated release metadata with the product identity endpoint.
// Exists so marker filenames alone cannot claim a stable public release.
package productidentity

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	buildIdentityFilename = "BUILD_IDENTITY.json"
	releaseLedgerFilename = "server_tools/versioning/release_ledger.v1.jsonl"
	maxBuildIdentityBytes = 64 * 1024
	maxReleaseLedgerBytes = 4 * 1024 * 1024
)

var (
	strictSemverPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)
	fullGitSHAPattern   = regexp.MustCompile(`^[0-9a-f]{40}$`)
	sha256Pattern       = regexp.MustCompile(`^[0-9a-f]{64}$`)
	utcTimestampPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$`)
)

type buildSourceV1 struct {
	Model  string `json:"model"`
	Commit string `json:"commit"`
}

type buildDatabaseV1 struct {
	MinVersion    string `json:"min_version"`
	TargetVersion string `json:"target_version"`
}

type buildIdentityV1 struct {
	SchemaVersion      int             `json:"schema_version"`
	Product            string          `json:"product"`
	BuildID            string          `json:"build_id"`
	LedgerRecordID     string          `json:"ledger_record_id"`
	LedgerRecordSHA256 string          `json:"ledger_record_sha256"`
	AppVersion         string          `json:"app_version"`
	ArtifactType       ArtifactType    `json:"artifact_type"`
	Channel            ReleaseChannel  `json:"channel"`
	Maturity           ReleaseMaturity `json:"maturity"`
	Source             buildSourceV1   `json:"source"`
	Database           buildDatabaseV1 `json:"database"`
	CreatedAt          string          `json:"created_at"`
}

type releaseLedgerRecordV1 struct {
	SchemaVersion        int             `json:"schema_version"`
	RecordType           string          `json:"record_type"`
	RecordID             string          `json:"record_id"`
	PreviousRecordSHA256 *string         `json:"previous_record_sha256"`
	Product              string          `json:"product"`
	BuildID              string          `json:"build_id"`
	AppVersion           string          `json:"app_version"`
	ArtifactType         ArtifactType    `json:"artifact_type"`
	Channel              ReleaseChannel  `json:"channel"`
	Maturity             ReleaseMaturity `json:"maturity"`
	Source               buildSourceV1   `json:"source"`
	Database             buildDatabaseV1 `json:"database"`
	CreatedAt            string          `json:"created_at"`
}

func detectBuildIdentity(root string) (Identity, bool) {
	identityPath := filepath.Join(root, buildIdentityFilename)
	identityBytes, err := readBoundedIdentityFile(identityPath, maxBuildIdentityBytes)
	if errors.Is(err, os.ErrNotExist) {
		return Identity{}, false
	}
	if err != nil {
		return invalidBuildIdentity(), true
	}
	if !bytes.HasSuffix(identityBytes, []byte("\n")) {
		return invalidBuildIdentity(), true
	}

	document := buildIdentityV1{}
	identityJSON := bytes.TrimSuffix(identityBytes, []byte("\n"))
	if err := decodeStrictJSONObject(identityJSON, &document, buildIdentityV1Keys()); err != nil {
		return invalidBuildIdentity(), true
	}
	if err := validateBuildIdentityDocument(document); err != nil {
		return invalidBuildIdentity(), true
	}

	appVersion, hasAppVersion := readMarkerVersion(root, "VERSION_APP")
	dbVersion, hasDBVersion := readMarkerVersion(root, "VERSION_DB")
	if !hasAppVersion || appVersion != document.AppVersion ||
		!hasDBVersion || dbVersion != document.Database.TargetVersion {
		return invalidBuildIdentity(), true
	}
	if err := validateReleaseLedgerBinding(root, document); err != nil {
		return invalidBuildIdentity(), true
	}

	legacyPurpose := ArtifactPurposeUnknown
	if document.ArtifactType == ArtifactTypeBackup {
		legacyPurpose = ArtifactPurposeDeveloperBackup
	} else if document.Channel == ReleaseChannelStable &&
		document.Maturity == ReleaseMaturityPublished {
		legacyPurpose = ArtifactPurposePublicRelease
	}

	return Identity{
		Kind:                  KindFilterestPublic,
		Name:                  "Filterest",
		PrivateUpstream:       false,
		PublicDistribution:    true,
		AppVersionFile:        "VERSION_APP",
		Version:               document.AppVersion,
		ReleaseChannel:        document.Channel,
		ArtifactPurpose:       legacyPurpose,
		ArtifactType:          document.ArtifactType,
		Maturity:              document.Maturity,
		Verification:          IdentityVerificationLocalContract,
		IdentitySource:        IdentitySourceBuildIdentityV1,
		BuildID:               document.BuildID,
		LedgerRecordID:        document.LedgerRecordID,
		DatabaseMinVersion:    document.Database.MinVersion,
		DatabaseTargetVersion: document.Database.TargetVersion,
	}, true
}

func invalidBuildIdentity() Identity {
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
		IdentitySource:     IdentitySourceBuildIdentityV1,
	}
}

func readBoundedIdentityFile(path string, maximum int) ([]byte, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(content) == 0 || len(content) > maximum {
		return nil, fmt.Errorf("identity contract file size is invalid")
	}
	return content, nil
}

func decodeStrictJSONObject(data []byte, destination any, requiredKeys map[string]struct{}) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("JSON object has trailing content")
	}

	object := map[string]json.RawMessage{}
	if err := json.Unmarshal(data, &object); err != nil {
		return err
	}
	if len(object) != len(requiredKeys) {
		return fmt.Errorf("JSON object does not have the exact v1 fields")
	}
	for key := range requiredKeys {
		if _, ok := object[key]; !ok {
			return fmt.Errorf("JSON object is missing required field %q", key)
		}
	}
	var canonicalValue any
	if err := json.Unmarshal(data, &canonicalValue); err != nil {
		return err
	}
	canonical, err := json.Marshal(canonicalValue)
	if err != nil {
		return err
	}
	if !bytes.Equal(data, canonical) {
		return fmt.Errorf("JSON object is not canonical")
	}
	return nil
}

func buildIdentityV1Keys() map[string]struct{} {
	return stringSet(
		"schema_version", "product", "build_id", "ledger_record_id",
		"ledger_record_sha256", "app_version", "artifact_type", "channel",
		"maturity", "source", "database", "created_at",
	)
}

func releaseLedgerRecordV1Keys() map[string]struct{} {
	return stringSet(
		"schema_version", "record_type", "record_id", "previous_record_sha256",
		"product", "build_id", "app_version", "artifact_type", "channel",
		"maturity", "source", "database", "created_at",
	)
}

func stringSet(values ...string) map[string]struct{} {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		set[value] = struct{}{}
	}
	return set
}

func validateBuildIdentityDocument(document buildIdentityV1) error {
	if document.SchemaVersion != 1 || document.Product != "filterest" {
		return fmt.Errorf("unsupported build identity contract")
	}
	if !sha256Pattern.MatchString(document.LedgerRecordSHA256) {
		return fmt.Errorf("invalid ledger record digest")
	}
	if err := validateBuildDimensions(
		document.AppVersion,
		document.ArtifactType,
		document.Channel,
		document.Maturity,
		document.Source,
		document.Database,
		document.CreatedAt,
	); err != nil {
		return err
	}
	expectedBuildID := buildIDFor(
		document.AppVersion,
		document.Channel,
		document.ArtifactType,
		document.Source.Commit,
	)
	if document.BuildID != expectedBuildID || document.LedgerRecordID != "build:"+expectedBuildID {
		return fmt.Errorf("build and ledger record identifiers do not match dimensions")
	}
	return nil
}

func validateBuildDimensions(
	appVersion string,
	artifactType ArtifactType,
	channel ReleaseChannel,
	maturity ReleaseMaturity,
	source buildSourceV1,
	database buildDatabaseV1,
	createdAt string,
) error {
	if !strictSemverPattern.MatchString(appVersion) ||
		!strictSemverPattern.MatchString(database.MinVersion) ||
		!strictSemverPattern.MatchString(database.TargetVersion) {
		return fmt.Errorf("version fields must use strict x.y.z syntax")
	}
	if compareSemver(database.TargetVersion, database.MinVersion) < 0 {
		return fmt.Errorf("database target version is older than minimum")
	}
	if artifactType != ArtifactTypeRuntime && artifactType != ArtifactTypeBackup {
		return fmt.Errorf("unsupported artifact type")
	}
	if channel != ReleaseChannelDevelopment && channel != ReleaseChannelStable {
		return fmt.Errorf("unsupported release channel")
	}
	if maturity != ReleaseMaturitySnapshot && maturity != ReleaseMaturityCandidate &&
		maturity != ReleaseMaturityPublished {
		return fmt.Errorf("unsupported release maturity")
	}
	if channel == ReleaseChannelDevelopment && maturity != ReleaseMaturitySnapshot {
		return fmt.Errorf("development artifact is not a snapshot")
	}
	if artifactType == ArtifactTypeBackup && maturity != ReleaseMaturitySnapshot {
		return fmt.Errorf("backup artifact is not a snapshot")
	}
	if (maturity == ReleaseMaturityCandidate || maturity == ReleaseMaturityPublished) &&
		(channel != ReleaseChannelStable || artifactType != ArtifactTypeRuntime) {
		return fmt.Errorf("candidate or published artifact is not a stable runtime")
	}
	if source.Model != "legacy_maintainer_export" && source.Model != "public_first" {
		return fmt.Errorf("unsupported source model")
	}
	if !fullGitSHAPattern.MatchString(source.Commit) {
		return fmt.Errorf("source commit is not a full lowercase Git SHA")
	}
	if !utcTimestampPattern.MatchString(createdAt) {
		return fmt.Errorf("created_at is not strict UTC")
	}
	parsedTime, err := time.Parse("2006-01-02T15:04:05Z", createdAt)
	if err != nil || parsedTime.Format("2006-01-02T15:04:05Z") != createdAt {
		return fmt.Errorf("created_at is not a real UTC timestamp")
	}
	return nil
}

func compareSemver(left string, right string) int {
	leftParts := strings.Split(left, ".")
	rightParts := strings.Split(right, ".")
	for index := 0; index < 3; index++ {
		leftNumber, _ := strconv.Atoi(leftParts[index])
		rightNumber, _ := strconv.Atoi(rightParts[index])
		if leftNumber < rightNumber {
			return -1
		}
		if leftNumber > rightNumber {
			return 1
		}
	}
	return 0
}

func buildIDFor(
	appVersion string,
	channel ReleaseChannel,
	artifactType ArtifactType,
	commit string,
) string {
	return fmt.Sprintf(
		"filterest-%s-%s-%s-%s",
		appVersion,
		channel,
		artifactType,
		commit[:12],
	)
}

func validateReleaseLedgerBinding(root string, identity buildIdentityV1) error {
	ledgerBytes, err := readBoundedIdentityFile(
		filepath.Join(root, releaseLedgerFilename),
		maxReleaseLedgerBytes,
	)
	if err != nil {
		return err
	}
	if !bytes.HasSuffix(ledgerBytes, []byte("\n")) {
		return fmt.Errorf("release ledger does not end with LF")
	}

	recordIDs := map[string]struct{}{}
	buildIDs := map[string]struct{}{}
	publishedStableVersions := map[string]struct{}{}
	previousDigest := ""
	matchingRecords := 0

	for _, line := range bytes.SplitAfter(ledgerBytes, []byte("\n")) {
		if len(line) == 0 {
			continue
		}
		if bytes.Equal(line, []byte("\n")) || bytes.HasSuffix(line, []byte("\r\n")) {
			return fmt.Errorf("release ledger has an invalid line")
		}

		record := releaseLedgerRecordV1{}
		lineJSON := bytes.TrimSuffix(line, []byte("\n"))
		if err := decodeStrictJSONObject(lineJSON, &record, releaseLedgerRecordV1Keys()); err != nil {
			return err
		}
		if err := validateReleaseLedgerRecord(record); err != nil {
			return err
		}
		if previousDigest == "" {
			if record.PreviousRecordSHA256 != nil {
				return fmt.Errorf("first ledger record has a previous digest")
			}
		} else if record.PreviousRecordSHA256 == nil || *record.PreviousRecordSHA256 != previousDigest {
			return fmt.Errorf("release ledger hash chain is invalid")
		}
		if _, exists := recordIDs[record.RecordID]; exists {
			return fmt.Errorf("release ledger has a duplicate record ID")
		}
		if _, exists := buildIDs[record.BuildID]; exists {
			return fmt.Errorf("release ledger has a duplicate build ID")
		}
		if record.Channel == ReleaseChannelStable && record.Maturity == ReleaseMaturityPublished {
			if _, exists := publishedStableVersions[record.AppVersion]; exists {
				return fmt.Errorf("release ledger has a duplicate published stable version")
			}
			publishedStableVersions[record.AppVersion] = struct{}{}
		}

		digestBytes := sha256.Sum256(line)
		digest := hex.EncodeToString(digestBytes[:])
		if record.RecordID == identity.LedgerRecordID {
			matchingRecords++
			if digest != identity.LedgerRecordSHA256 || !ledgerRecordMatchesIdentity(record, identity) {
				return fmt.Errorf("build identity does not match its ledger record")
			}
		}
		recordIDs[record.RecordID] = struct{}{}
		buildIDs[record.BuildID] = struct{}{}
		previousDigest = digest
	}
	if matchingRecords != 1 {
		return fmt.Errorf("build identity ledger record is missing or duplicated")
	}
	return nil
}

func validateReleaseLedgerRecord(record releaseLedgerRecordV1) error {
	if record.SchemaVersion != 1 || record.RecordType != "build" || record.Product != "filterest" {
		return fmt.Errorf("unsupported release ledger record")
	}
	if record.PreviousRecordSHA256 != nil && !sha256Pattern.MatchString(*record.PreviousRecordSHA256) {
		return fmt.Errorf("invalid previous ledger digest")
	}
	if err := validateBuildDimensions(
		record.AppVersion,
		record.ArtifactType,
		record.Channel,
		record.Maturity,
		record.Source,
		record.Database,
		record.CreatedAt,
	); err != nil {
		return err
	}
	expectedBuildID := buildIDFor(
		record.AppVersion,
		record.Channel,
		record.ArtifactType,
		record.Source.Commit,
	)
	if record.BuildID != expectedBuildID || record.RecordID != "build:"+expectedBuildID {
		return fmt.Errorf("release ledger identifiers do not match dimensions")
	}
	return nil
}

func ledgerRecordMatchesIdentity(record releaseLedgerRecordV1, identity buildIdentityV1) bool {
	return record.Product == identity.Product &&
		record.BuildID == identity.BuildID &&
		record.RecordID == identity.LedgerRecordID &&
		record.AppVersion == identity.AppVersion &&
		record.ArtifactType == identity.ArtifactType &&
		record.Channel == identity.Channel &&
		record.Maturity == identity.Maturity &&
		record.Source == identity.Source &&
		record.Database == identity.Database &&
		record.CreatedAt == identity.CreatedAt
}
