// public_bootstrap_media_manifest_reader.go
// Reads the reviewed public starter-media manifest from immutable app source.
// Connects the app-owned fixture document to startup materialization inputs.
// Exists so decoding and manifest identity stay separate from mutable writes.
package startup

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
)

func loadPublicBootstrapMediaManifest(
	applicationRoot *os.Root,
) (publicBootstrapMediaManifestDocument, error) {
	manifestRelativePath := path.Join(
		publicBootstrapFixtureRootRelative,
		publicBootstrapMediaManifestName,
	)
	manifestFile, err := openVerifiedRegularFile(
		applicationRoot,
		manifestRelativePath,
		"public bootstrap media manifest",
	)
	if err != nil {
		return publicBootstrapMediaManifestDocument{}, err
	}
	defer manifestFile.Close()

	manifestBytes, err := io.ReadAll(manifestFile)
	if err != nil {
		return publicBootstrapMediaManifestDocument{}, fmt.Errorf(
			"read public bootstrap media manifest: %w",
			err,
		)
	}
	decoder := json.NewDecoder(bytes.NewReader(manifestBytes))
	decoder.DisallowUnknownFields()
	var manifest publicBootstrapMediaManifest
	if err := decoder.Decode(&manifest); err != nil {
		return publicBootstrapMediaManifestDocument{}, fmt.Errorf("decode public bootstrap media manifest: %w", err)
	}
	var trailingValue any
	if err := decoder.Decode(&trailingValue); !errors.Is(err, io.EOF) {
		if err == nil {
			return publicBootstrapMediaManifestDocument{}, fmt.Errorf(
				"decode public bootstrap media manifest: unexpected trailing JSON value",
			)
		}
		return publicBootstrapMediaManifestDocument{}, fmt.Errorf(
			"decode public bootstrap media manifest trailing data: %w",
			err,
		)
	}

	return publicBootstrapMediaManifestDocument{
		Manifest: manifest,
		SHA256:   fmt.Sprintf("%x", sha256.Sum256(manifestBytes)),
	}, nil
}
