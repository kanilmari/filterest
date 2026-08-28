// asset_linking_status_reader_test.go
// Verifies profile-key inference and filtering for shared asset_linking relation rows.
// Bridges legacy image rows, new attachment rows, and the future multi-profile status readers.
// Exists to keep image and attachment relations from colliding once both profiles can coexist.
package dtt_asset_linking

import "testing"

func TestResolveFileUploadProfileKeyPrefersLegacyImageSignals(t *testing.T) {
	status := FileUploadRelationStatus{
		ChildTable: "articles_gallery",
		UploadConfig: FileUploadConfig{
			Enabled:         true,
			TargetDirectory: "media",
			CacheTargets: []CacheTarget{
				{Table: "articles", Column: "cached_image"},
			},
		},
	}

	if got := ResolveFileUploadProfileKey(status); got != AssetProfileImage {
		t.Fatalf("ResolveFileUploadProfileKey() = %q, want %q", got, AssetProfileImage)
	}
}

func TestResolveFileUploadProfileKeyDoesNotLetImagesSuffixOverrideAttachmentMetadata(t *testing.T) {
	status := FileUploadRelationStatus{
		ChildTable: "articles_gallery",
		UploadConfig: FileUploadConfig{
			Enabled:         true,
			TargetDirectory: "attachments",
			AssetKinds:      []AssetKind{AssetKindPDF},
		},
	}

	if got := ResolveFileUploadProfileKey(status); got != AssetProfileAttachment {
		t.Fatalf("ResolveFileUploadProfileKey() = %q, want %q", got, AssetProfileAttachment)
	}
}

func TestFilterFileUploadRelationStatusesByProfileKeepsAttachmentRows(t *testing.T) {
	statuses := []FileUploadRelationStatus{
		{
			ChildTable: "articles_gallery",
			UploadConfig: FileUploadConfig{
				ProfileKey: AssetProfileImage,
				AssetKinds: []AssetKind{AssetKindImage},
			},
		},
		{
			ChildTable: "articles_assets",
			UploadConfig: FileUploadConfig{
				ProfileKey: AssetProfileAttachment,
				AssetKinds: []AssetKind{AssetKindPDF, AssetKindDocument, AssetKindArchive},
			},
		},
	}

	filtered := FilterFileUploadRelationStatusesByProfile(statuses, AssetProfileAttachment)
	if len(filtered) != 1 {
		t.Fatalf("len(filtered) = %d, want 1", len(filtered))
	}
	if filtered[0].ChildTable != "articles_assets" {
		t.Fatalf("filtered[0].ChildTable = %q, want articles_assets", filtered[0].ChildTable)
	}
}

func TestFilterFileUploadRelationStatusesByProfileKeepsSharedRowForBothProfiles(t *testing.T) {
	statuses := []FileUploadRelationStatus{
		{
			ChildTable: "services_assets",
			UploadConfig: SetProfileUploadConfig(
				BuildImageFileUploadConfig("services", 10, []string{"png"}),
				AssetProfileAttachment,
				BuildAttachmentProfileConfig("services", 25, []string{"pdf"}),
			),
		},
	}

	imageFiltered := FilterFileUploadRelationStatusesByProfile(statuses, AssetProfileImage)
	if len(imageFiltered) != 1 {
		t.Fatalf("len(imageFiltered) = %d, want 1", len(imageFiltered))
	}

	attachmentFiltered := FilterFileUploadRelationStatusesByProfile(statuses, AssetProfileAttachment)
	if len(attachmentFiltered) != 1 {
		t.Fatalf("len(attachmentFiltered) = %d, want 1", len(attachmentFiltered))
	}
}

func TestFilterFileUploadRelationStatusesByProfileDoesNotTreatImageOnlySharedRowAsAttachment(t *testing.T) {
	statuses := []FileUploadRelationStatus{
		{
			ChildTable:    "services_assets",
			UploadConfig:  BuildImageFileUploadConfig("services", 10, []string{"png"}),
			RelationID:    19,
			ParentTable:   "services",
			StorageDriver: StorageDriverLocalFilesystem,
		},
	}

	filtered := FilterFileUploadRelationStatusesByProfile(statuses, AssetProfileAttachment)
	if len(filtered) != 0 {
		t.Fatalf("len(filtered) = %d, want 0 for image-only shared row", len(filtered))
	}
}

func TestResolveProfileUploadConfigFromStatusUsesSharedProfileMap(t *testing.T) {
	status := FileUploadRelationStatus{
		ChildTable: "services_assets",
		UploadConfig: SetProfileUploadConfig(
			BuildImageFileUploadConfig("services", 10, []string{"png"}),
			AssetProfileAttachment,
			BuildAttachmentProfileConfig("services", 25, []string{"pdf", "docx"}),
		),
	}

	imageProfile, ok := ResolveProfileUploadConfigFromStatus(status, AssetProfileImage)
	if !ok {
		t.Fatal("expected image profile to resolve from shared config")
	}
	if imageProfile.TargetDirectory != "media" {
		t.Fatalf("imageProfile.TargetDirectory = %q, want media", imageProfile.TargetDirectory)
	}

	attachmentProfile, ok := ResolveProfileUploadConfigFromStatus(status, AssetProfileAttachment)
	if !ok {
		t.Fatal("expected attachment profile to resolve from shared config")
	}
	if attachmentProfile.TargetDirectory != "attachments" {
		t.Fatalf("attachmentProfile.TargetDirectory = %q, want attachments", attachmentProfile.TargetDirectory)
	}
}

func TestResolveRelationKindForProfileMarksSharedAssetRowsExplicitly(t *testing.T) {
	status := FileUploadRelationStatus{
		ChildTable: "services_assets",
		UploadConfig: SetProfileUploadConfig(
			BuildImageFileUploadConfig("services", 10, []string{"png"}),
			AssetProfileAttachment,
			BuildAttachmentProfileConfig("services", 25, []string{"pdf"}),
		),
	}

	if got := ResolveRelationKindForProfile(status, AssetProfileImage); got != RelationKindSharedAsset {
		t.Fatalf("ResolveRelationKindForProfile(shared image) = %q, want %q", got, RelationKindSharedAsset)
	}
	if got := ResolveRelationKindForProfile(status, AssetProfileAttachment); got != RelationKindSharedAsset {
		t.Fatalf("ResolveRelationKindForProfile(shared attachment) = %q, want %q", got, RelationKindSharedAsset)
	}
}

func TestResolveRelationKindForProfileMarksLegacyImageRows(t *testing.T) {
	status := FileUploadRelationStatus{
		ChildTable: "articles_gallery",
		UploadConfig: FileUploadConfig{
			Enabled:         true,
			TargetDirectory: "media",
			CacheTargets: []CacheTarget{
				{Table: "articles", Column: "cached_image"},
			},
		},
	}

	if got := ResolveRelationKindForProfile(status, AssetProfileImage); got != RelationKindImageAsset {
		t.Fatalf("ResolveRelationKindForProfile(legacy image) = %q, want %q", got, RelationKindImageAsset)
	}
}
