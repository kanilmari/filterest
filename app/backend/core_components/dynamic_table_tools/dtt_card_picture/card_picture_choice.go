// card_picture_choice.go
// Chooses a row's card picture from its gallery and the picture the card shows now.
// Between the writer that stores the choice in cached_image and the classification
// that says what replacing the current picture would lose.
// Exists as one pure function so every writer, the startup alignment and the tests
// apply exactly the same precedence (owner decisions K120 and K121, 30.9.2026).
package dtt_card_picture

// CurrentClass says what the card's current picture is when no gallery row carries it.
type CurrentClass int

const (
	// CurrentNone: the card shows nothing of its own — the stored value is empty,
	// is carried by a gallery row (same value or same stored file), or is being
	// released on purpose by the operation.
	CurrentNone CurrentClass = iota
	// CurrentAdoptable: the only reference to a file that exists in the row's own
	// folder, and the gallery can keep it as a row. It counts as the gallery's first
	// picture; when a primary picture replaces it, it is kept as the first gallery row.
	CurrentAdoptable
	// CurrentKept: a picture the card can show but the rule cannot keep anywhere else:
	// a file in another row's folder (K121), an own-folder file of a gallery that cannot
	// adopt it, an external address, a media-library reference, or a value whose file
	// could not be checked. It stays until an administrator clears it.
	CurrentKept
	// CurrentBroken: a stored-file reference whose file is certainly missing, or a value
	// that names neither a stored file nor an address. It counts as no picture.
	CurrentBroken
)

// GalleryPicture is one picture of the gallery, in gallery order (GalleryOrderClause).
type GalleryPicture struct {
	Value   string
	Primary bool
}

// Choice is what the writer does: store Value in cached_image (empty clears it), and
// first keep the current picture as the gallery's first row when AdoptCurrent is set.
type Choice struct {
	Value        string
	AdoptCurrent bool
}

// ChooseCardPicture applies the precedence of the card picture:
//
//  1. a kept current picture stays — neither an upload nor a primary replaces it;
//  2. otherwise the primary gallery picture;
//  3. otherwise an adoptable current picture stays, as the gallery's first;
//  4. otherwise the gallery's first picture;
//  5. otherwise nothing.
//
// The rule never drops a picture it cannot keep. A new upload is appended to the
// gallery, so it becomes the card picture only when steps 1–4 find nothing, which is
// exactly "the row has no picture". gallery must already be in gallery order.
func ChooseCardPicture(current string, class CurrentClass, gallery []GalleryPicture) Choice {
	if class == CurrentKept {
		return Choice{Value: current}
	}
	if len(gallery) > 0 && gallery[0].Primary {
		return Choice{Value: gallery[0].Value, AdoptCurrent: class == CurrentAdoptable}
	}
	if class == CurrentAdoptable {
		return Choice{Value: current}
	}
	if len(gallery) > 0 {
		return Choice{Value: gallery[0].Value}
	}
	return Choice{}
}
