// card_image_settings_test.go
// Checks the storage contract's finite point and optimistic source version.
// Shared reader and writer validation must reject CSS-like and non-finite values.
package dtt_card_picture

import (
	"math"
	"testing"
)

func TestCardImageSettingsFinitePointAndClosedEnum(t *testing.T) {
	for _, n := range []float64{math.NaN(), math.Inf(1), math.Inf(-1), -0.01, 1.01} {
		if (CardImageSettings{Focal: &CardImageFocal{X: n, Y: 0.5}}).Validate() == nil {
			t.Fatal("invalid point accepted", n)
		}
	}
	invalid := "cover;background:red"
	if (CardImageSettings{Presentation: &invalid}).Validate() == nil {
		t.Fatal("invalid presentation accepted")
	}
	if (CardImageSettings{Focal: &CardImageFocal{X: 0, Y: 1}}).Validate() != nil {
		t.Fatal("boundary point refused")
	}
}

func TestCardImageVersionIncludesBothRowsAndDisplayedSource(t *testing.T) {
	version := CardImageVersion("1", "2", "shown.png")
	for _, other := range []string{CardImageVersion("3", "2", "shown.png"), CardImageVersion("1", "3", "shown.png"), CardImageVersion("1", "2", "new.png")} {
		if version == other {
			t.Fatal("changed source accepted the old version")
		}
	}
}
