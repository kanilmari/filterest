package media_utils

import (
	"reflect"
	"testing"
)

func TestFallbackOrderPrefersSizedSiblingsBeforeOriginal(t *testing.T) {
	cases := []struct {
		requested string
		want      []string
	}{
		{requested: "2160", want: []string{"2160", "1000", "300", "original"}},
		{requested: "1000", want: []string{"1000", "300", "2160", "original"}},
		{requested: "300", want: []string{"300", "1000", "2160", "original"}},
		{requested: "original", want: []string{"original"}},
		{requested: "640", want: []string{"1000", "300", "2160", "original"}},
		{requested: "", want: []string{"1000", "300", "2160", "original"}},
	}
	for _, testCase := range cases {
		got := FallbackOrder(testCase.requested)
		if !reflect.DeepEqual(got, testCase.want) {
			t.Errorf("FallbackOrder(%q) = %#v, want %#v", testCase.requested, got, testCase.want)
		}
	}
}

func TestReplaceVariantFolderRewritesKnownStorageShapes(t *testing.T) {
	cases := []struct {
		rel     string
		variant string
		want    string
	}{
		{rel: "104/7/original/104_7_9.png", variant: "300", want: "104/7/300/104_7_9.png"},
		{rel: "104/dataset_media/background/2160/background.webp", variant: "1000", want: "104/dataset_media/background/1000/background.webp"},
		{rel: "media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/original/image.png", variant: "1000", want: "media/174668a1-2efa-45a6-aa6c-d8a4ee8ec069/1000/image.png"},
	}
	for _, testCase := range cases {
		got, ok := ReplaceVariantFolder(testCase.rel, testCase.variant)
		if !ok || got != testCase.want {
			t.Errorf("ReplaceVariantFolder(%q, %q) = %q, %v, want %q, true", testCase.rel, testCase.variant, got, ok, testCase.want)
		}
	}
}

func TestReplaceVariantFolderRejectsUnknownOrMalformedPaths(t *testing.T) {
	for _, rel := range []string{"project_logo.png", "104/7/640/file.png", "nested/original/file.png"} {
		if got, ok := ReplaceVariantFolder(rel, "1000"); ok {
			t.Errorf("ReplaceVariantFolder(%q, 1000) = %q, want rejection", rel, got)
		}
	}
	if got, ok := ReplaceVariantFolder("104/7/original/file.png", "640"); ok {
		t.Errorf("ReplaceVariantFolder with unknown variant = %q, want rejection", got)
	}
}
