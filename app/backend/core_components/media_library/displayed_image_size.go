// Keeps the source's dimension hint on a new library use without copying provenance.
// Optional reads/writes cannot abort an otherwise successful attachment.
package media_library

import (
	"fmt"
	"log"

	"easelect/backend/core_components/media_utils"
	"github.com/lib/pq"
)

func copyImageSize(q media_utils.ImageSizeQuerier, table string, sourceID, targetID int64, filename string) {
	err := media_utils.WithImageSizeSavepoint(q, func() error {
		var raw []byte
		if err := q.QueryRow(fmt.Sprintf(`SELECT metadata_json FROM public.%s WHERE id=$1`, pq.QuoteIdentifier(table)), sourceID).Scan(&raw); err != nil {
			return err
		}
		size := media_utils.CopyDisplayedImageSize(raw, filename)
		if size == nil {
			return nil
		}
		return media_utils.MergeImageSize(q, table, targetID, size, false)
	})
	if err != nil {
		log.Print("[image dimensions] optional library metadata copy unavailable")
	}
}
