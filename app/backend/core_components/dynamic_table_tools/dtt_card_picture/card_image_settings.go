// card_image_settings.go
// Defines per-use card presentation and its optimistic source identity.
// Shared by authorized card reads and the ordinary row-update operation.
// A library asset or URL is never a writable usage identity.
package dtt_card_picture

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
)

type CardImageFocal struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type CardImageSettings struct {
	Presentation *string         `json:"presentation"`
	Focal        *CardImageFocal `json:"focal"`
}

// CardImageUse binds the displayed field to one gallery link, or to an explicit
// adoption candidate (LinkRowID zero). Version includes both source row versions.
type CardImageUse struct {
	Dataset    string `json:"dataset"`
	RowID      int64  `json:"row_id"`
	Column     string `json:"column"`
	RelationID int64  `json:"relation_id"`
	LinkRowID  int64  `json:"link_row_id"`
	Version    string `json:"version"`
}

func CardImageVersion(parentVersion, linkVersion string, sourceValue ...string) string {
	parts := append([]string{parentVersion, linkVersion}, sourceValue...)
	encoded, _ := json.Marshal(parts)
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}

func (settings CardImageSettings) Validate() error {
	if settings.Presentation != nil {
		switch *settings.Presentation {
		case "cover", "contain", "contain_blur":
		default:
			return errors.New("invalid card image presentation")
		}
	}
	if settings.Focal != nil {
		for _, number := range []float64{settings.Focal.X, settings.Focal.Y} {
			if math.IsNaN(number) || math.IsInf(number, 0) || number < 0 || number > 1 {
				return errors.New("card image focal coordinates must be finite numbers from 0 to 1")
			}
		}
	}
	return nil
}
