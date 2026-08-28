// public_bootstrap_media_completion_saver.go
// Reads and durably records one-time public starter-media completion revisions.
// Connects successful mutable storage creation to restart and downgrade behavior.
// Exists so ordinary releases never replay intentionally deleted starter media.
package startup

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"strconv"
	"strings"
)

func publicBootstrapMediaCompletionName(materializationRevision int) string {
	return fmt.Sprintf("%s%d%s", publicBootstrapMarkerPrefix, materializationRevision, publicBootstrapMarkerSuffix)
}

// publicBootstrapMediaCompletionAtOrAboveExists makes the revision monotonic:
// an older app may never replay bootstrap media after a newer revision completed.
// Only a manifest revision strictly above every durable marker can run again.
func publicBootstrapMediaCompletionAtOrAboveExists(
	bootstrapRoot *os.Root,
	materializationRevision int,
) (bool, error) {
	directory, err := bootstrapRoot.Open(".")
	if err != nil {
		return false, fmt.Errorf("open public bootstrap completion directory: %w", err)
	}
	entries, readErr := directory.ReadDir(-1)
	closeErr := directory.Close()
	if readErr != nil {
		return false, fmt.Errorf("read public bootstrap completion directory: %w", readErr)
	}
	if closeErr != nil {
		return false, fmt.Errorf("close public bootstrap completion directory: %w", closeErr)
	}

	highestCompletedRevision := 0
	for _, entry := range entries {
		name := entry.Name()
		revisionText, hasPrefix := strings.CutPrefix(name, publicBootstrapMarkerPrefix)
		if !hasPrefix {
			continue
		}
		revisionText, hasSuffix := strings.CutSuffix(revisionText, publicBootstrapMarkerSuffix)
		if !hasSuffix {
			continue
		}
		revision, conversionErr := strconv.Atoi(revisionText)
		if conversionErr != nil || revision < 1 {
			return false, fmt.Errorf(
				"public bootstrap media completion marker has invalid revision: %s",
				name,
			)
		}
		if revision >= materializationRevision && revision > highestCompletedRevision {
			highestCompletedRevision = revision
		}
	}
	if highestCompletedRevision == 0 {
		return false, nil
	}
	return publicBootstrapMediaCompletionExists(
		bootstrapRoot,
		highestCompletedRevision,
	)
}

// publicBootstrapMediaCompletionExists treats the explicit materialization
// revision as the durable one-time identity. The recorded manifest digest is
// evidence only: changing bytes without deliberately bumping the revision must
// never restore media that an operator removed after the completed first run.
func publicBootstrapMediaCompletionExists(
	bootstrapRoot *os.Root,
	materializationRevision int,
) (bool, error) {
	markerName := publicBootstrapMediaCompletionName(materializationRevision)
	markerInfo, err := bootstrapRoot.Lstat(markerName)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("inspect public bootstrap media completion marker: %w", err)
	}
	if markerInfo.Mode()&os.ModeSymlink != 0 || !markerInfo.Mode().IsRegular() {
		return false, fmt.Errorf(
			"public bootstrap media completion marker must be a regular file: %s",
			markerName,
		)
	}

	markerFile, err := openVerifiedRegularFile(
		bootstrapRoot,
		markerName,
		"public bootstrap media completion marker",
	)
	if err != nil {
		return false, err
	}
	defer markerFile.Close()

	decoder := json.NewDecoder(markerFile)
	decoder.DisallowUnknownFields()
	var completion publicBootstrapMediaCompletion
	if err := decoder.Decode(&completion); err != nil {
		return false, fmt.Errorf("decode public bootstrap media completion marker: %w", err)
	}
	var trailingValue any
	if err := decoder.Decode(&trailingValue); !errors.Is(err, io.EOF) {
		if err == nil {
			return false, fmt.Errorf(
				"decode public bootstrap media completion marker: unexpected trailing JSON value",
			)
		}
		return false, fmt.Errorf(
			"decode public bootstrap media completion marker trailing data: %w",
			err,
		)
	}
	if completion.SchemaVersion != publicBootstrapMarkerSchemaVersion ||
		completion.MaterializationRevision != materializationRevision ||
		!isLowerHexSHA256(completion.ManifestSHA256) {
		return false, fmt.Errorf(
			"public bootstrap media completion marker is invalid for materialization revision %d",
			materializationRevision,
		)
	}
	return true, nil
}

func writePublicBootstrapMediaCompletion(
	bootstrapRoot *os.Root,
	materializationRevision int,
	manifestSHA256 string,
) error {
	completionBytes, err := json.MarshalIndent(
		publicBootstrapMediaCompletion{
			SchemaVersion:           publicBootstrapMarkerSchemaVersion,
			MaterializationRevision: materializationRevision,
			ManifestSHA256:          manifestSHA256,
		},
		"",
		"  ",
	)
	if err != nil {
		return fmt.Errorf("encode public bootstrap media completion marker: %w", err)
	}
	completionBytes = append(completionBytes, '\n')
	markerName := publicBootstrapMediaCompletionName(materializationRevision)
	if _, err := installAtomicMissingFile(
		bootstrapRoot,
		markerName,
		bytes.NewReader(completionBytes),
		0o600,
	); err != nil {
		return fmt.Errorf("write public bootstrap media completion marker: %w", err)
	}
	completed, err := publicBootstrapMediaCompletionExists(
		bootstrapRoot,
		materializationRevision,
	)
	if err != nil {
		return err
	}
	if !completed {
		return fmt.Errorf(
			"public bootstrap media completion marker disappeared after materialization revision %d",
			materializationRevision,
		)
	}
	return nil
}
