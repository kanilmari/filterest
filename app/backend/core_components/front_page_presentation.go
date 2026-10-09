// front_page_presentation.go
// Reads Home's optional layout and opaque revision in one database snapshot.
// Connects public/admin Home responses to the shared browser/server validation.
// A missing row supplies the centred default; malformed stored layouts fail visibly.
package backend

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"

	presentation "easelect/frontend/shared/front_page_presentation"
)

// FrontPagePresentationRevision covers both content and the stored row revision.
func FrontPagePresentationRevision(raw []byte, updated string) string {
	return fmt.Sprintf("%x", sha256.Sum256(append(append([]byte{}, raw...), []byte(updated)...)))
}

// ReadFrontPagePresentation reads both fields together so a save never uses a mixed revision.
func ReadFrontPagePresentation(ctx context.Context, db *sql.DB) (*presentation.Value, string, error) {
	if db == nil {
		return nil, "", fmt.Errorf("Home presentation database unavailable")
	}
	var raw []byte
	var updated string
	var valueType int
	err := db.QueryRowContext(ctx, `SELECT json_value, COALESCE(updated::text, ''), value_type FROM public.system_config WHERE key='front_page_presentation'`).Scan(&raw, &updated, &valueType)
	if err == sql.ErrNoRows {
		value := presentation.Rules().Default
		return &value, "none", nil
	}
	if err != nil {
		return nil, "", err
	}
	if valueType != 5 {
		return nil, "", fmt.Errorf("Home layout requires JSON value type 5")
	}
	value, err := presentation.ParseStored(raw)
	if err != nil {
		return nil, "", err
	}
	return &value, FrontPagePresentationRevision(raw, updated), nil
}
