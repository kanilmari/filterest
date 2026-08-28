// asset_linking_formatter_test.go
// Verifies file_upload config encoding and decoding for the asset_linking scaffold.
// Bridges typed asset config and the persisted FK metadata JSON shape through regression tests.
// Exists to keep the shared asset config JSON stable as image and attachment handlers evolve.
package dtt_asset_linking

import "testing"

func TestBuildTargetInsertSpecsJSONRoundTrip(t *testing.T) {
	config := BuildImageFileUploadConfig("articles", 12, []string{"png", "webp"})

	specsJSON, err := BuildTargetInsertSpecsJSON(config)
	if err != nil {
		t.Fatalf("BuildTargetInsertSpecsJSON returned error: %v", err)
	}

	parsed, err := ParseFileUploadConfig(specsJSON)
	if err != nil {
		t.Fatalf("ParseFileUploadConfig returned error: %v", err)
	}

	if parsed.Enabled != true {
		t.Fatalf("parsed.Enabled = %#v, want true", parsed.Enabled)
	}
	if parsed.MaxFileSizeMB != 12 {
		t.Fatalf("parsed.MaxFileSizeMB = %#v, want 12", parsed.MaxFileSizeMB)
	}
	if parsed.FilenameColumn != "filename" {
		t.Fatalf("parsed.FilenameColumn = %#v, want filename", parsed.FilenameColumn)
	}
	if len(parsed.CacheTargets) != 1 {
		t.Fatalf("parsed.CacheTargets = %#v, want one target", parsed.CacheTargets)
	}
	if parsed.CacheTargets[0].Table != "articles" || parsed.CacheTargets[0].Column != "cached_image" {
		t.Fatalf("parsed.CacheTargets[0] = %#v, want articles.cached_image", parsed.CacheTargets[0])
	}
}

func TestBuildAttachmentTargetInsertSpecsJSONRoundTrip(t *testing.T) {
	config := BuildAttachmentFileUploadConfig("contracts", 25, []string{"pdf", "docx", "zip"})

	specsJSON, err := BuildTargetInsertSpecsJSON(config)
	if err != nil {
		t.Fatalf("BuildTargetInsertSpecsJSON returned error: %v", err)
	}

	parsed, err := ParseFileUploadConfig(specsJSON)
	if err != nil {
		t.Fatalf("ParseFileUploadConfig returned error: %v", err)
	}

	if parsed.Enabled != true {
		t.Fatalf("parsed.Enabled = %#v, want true", parsed.Enabled)
	}
	if parsed.TargetDirectory != "attachments" {
		t.Fatalf("parsed.TargetDirectory = %#v, want attachments", parsed.TargetDirectory)
	}
	if parsed.MaxFileSizeMB != 25 {
		t.Fatalf("parsed.MaxFileSizeMB = %#v, want 25", parsed.MaxFileSizeMB)
	}
	if parsed.ProfileKey != AssetProfileAttachment {
		t.Fatalf("parsed.ProfileKey = %#v, want attachment", parsed.ProfileKey)
	}
	if parsed.FilenameColumn != "filename" {
		t.Fatalf("parsed.FilenameColumn = %#v, want filename", parsed.FilenameColumn)
	}
	if len(parsed.AssetKinds) != 3 {
		t.Fatalf("parsed.AssetKinds = %#v, want grouped attachment kinds", parsed.AssetKinds)
	}
	if len(parsed.CacheTargets) != 0 {
		t.Fatalf("parsed.CacheTargets = %#v, want no cache targets", parsed.CacheTargets)
	}
}

func TestBuildSharedTargetInsertSpecsJSONRoundTrip(t *testing.T) {
	config := BuildImageFileUploadConfig("services", 10, []string{"png", "webp"})
	config = SetProfileUploadConfig(
		config,
		AssetProfileAttachment,
		BuildAttachmentProfileConfig("services", 25, []string{"pdf", "docx"}),
	)

	specsJSON, err := BuildTargetInsertSpecsJSON(config)
	if err != nil {
		t.Fatalf("BuildTargetInsertSpecsJSON returned error: %v", err)
	}

	parsed, err := ParseFileUploadConfig(specsJSON)
	if err != nil {
		t.Fatalf("ParseFileUploadConfig returned error: %v", err)
	}

	if parsed.ProfileKey != SharedAssetProfileKey {
		t.Fatalf("parsed.ProfileKey = %#v, want shared asset profile key", parsed.ProfileKey)
	}
	if len(parsed.Profiles) != 2 {
		t.Fatalf("parsed.Profiles = %#v, want image+attachment profiles", parsed.Profiles)
	}
	imageProfile, ok := parsed.Profiles[AssetProfileImage]
	if !ok {
		t.Fatalf("parsed.Profiles missing %q: %#v", AssetProfileImage, parsed.Profiles)
	}
	if !imageProfile.Enabled || len(imageProfile.CacheTargets) != 1 {
		t.Fatalf("imageProfile = %#v, want enabled cached_image profile", imageProfile)
	}
	attachmentProfile, ok := parsed.Profiles[AssetProfileAttachment]
	if !ok {
		t.Fatalf("parsed.Profiles missing %q: %#v", AssetProfileAttachment, parsed.Profiles)
	}
	if attachmentProfile.TargetDirectory != "attachments" {
		t.Fatalf("attachmentProfile.TargetDirectory = %#v, want attachments", attachmentProfile.TargetDirectory)
	}
}

func TestRemoveProfileUploadConfigKeepsImageProfileWhenAttachmentIsRemoved(t *testing.T) {
	config := SetProfileUploadConfig(
		BuildImageFileUploadConfig("services", 10, []string{"png"}),
		AssetProfileAttachment,
		BuildAttachmentProfileConfig("services", 25, []string{"pdf", "docx"}),
	)

	updatedConfig, ok := RemoveProfileUploadConfig(config, AssetProfileAttachment)
	if !ok {
		t.Fatal("RemoveProfileUploadConfig should keep the shared relation alive when image profile remains")
	}
	if updatedConfig.ProfileKey != AssetProfileImage {
		t.Fatalf("updatedConfig.ProfileKey = %#v, want image", updatedConfig.ProfileKey)
	}
	if len(updatedConfig.CacheTargets) != 1 || updatedConfig.CacheTargets[0].Column != "cached_image" {
		t.Fatalf("updatedConfig.CacheTargets = %#v, want cached_image target", updatedConfig.CacheTargets)
	}
	if len(updatedConfig.AssetKinds) != 1 || updatedConfig.AssetKinds[0] != AssetKindImage {
		t.Fatalf("updatedConfig.AssetKinds = %#v, want only image", updatedConfig.AssetKinds)
	}
}

func TestRemoveProfileUploadConfigKeepsAttachmentProfileWhenImageIsRemoved(t *testing.T) {
	config := SetProfileUploadConfig(
		BuildImageFileUploadConfig("services", 10, []string{"png"}),
		AssetProfileAttachment,
		BuildAttachmentProfileConfig("services", 25, []string{"pdf", "docx"}),
	)

	updatedConfig, ok := RemoveProfileUploadConfig(config, AssetProfileImage)
	if !ok {
		t.Fatal("RemoveProfileUploadConfig should keep the shared relation alive when attachment profile remains")
	}
	if updatedConfig.ProfileKey != AssetProfileAttachment {
		t.Fatalf("updatedConfig.ProfileKey = %#v, want attachment", updatedConfig.ProfileKey)
	}
	if len(updatedConfig.CacheTargets) != 0 {
		t.Fatalf("updatedConfig.CacheTargets = %#v, want no cache targets", updatedConfig.CacheTargets)
	}
	if len(updatedConfig.AssetKinds) != 3 {
		t.Fatalf("updatedConfig.AssetKinds = %#v, want grouped attachment kinds", updatedConfig.AssetKinds)
	}
}
