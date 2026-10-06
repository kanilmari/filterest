// card_picture_alias_test.go
// Proves K121 classification and gallery readers share the normalized file resolver.
// Uses the rule's existing pure file-state fixture, without a database or disk probes.
// Query/fragment aliases remain own files while equal-basename kept pictures stay distinct.
package dtt_asset_linking

import (
	"testing"

	"easelect/backend/core_components/dynamic_table_tools/dtt_card_picture"
)

func TestClassifyCardPictureSharesNormalizedFileIdentity(t *testing.T) {
	for _, test := range []struct {
		name, current string
		references    []string
		existing      []string
		want          dtt_card_picture.CurrentClass
	}{
		{"gallery fragment", "117_4_4.jpg#preview", []string{"117/4/original/117_4_4.jpg"}, nil, dtt_card_picture.CurrentNone},
		{"adoptable query and fragment", "/storage/117/4/300/117_4_4.jpg?size=300#preview", nil, []string{"117/4/original/117_4_4.jpg"}, dtt_card_picture.CurrentAdoptable},
		{"other row equal basename", "/storage/117/5/300/117_4_4.jpg#preview", []string{"117_4_4.jpg"}, []string{"117/5/original/117_4_4.jpg"}, dtt_card_picture.CurrentKept},
		{"external equal basename", "https://example.org/117_4_4.jpg#preview", []string{"117_4_4.jpg"}, nil, dtt_card_picture.CurrentKept},
	} {
		t.Run(test.name, func(t *testing.T) {
			class, reason := ClassifyCardPicture(test.current, test.references, "117", 4, true, cardPictureFiles(test.existing, nil))
			if class != test.want {
				t.Fatal(class, reason)
			}
		})
	}
}
