// front_page_presentation_store.go
// Saves the one Home layout under an independent optimistic revision.
// Connects the admin request transaction to system_config and shared validation.
// Serializes first writes and refuses stale editors without touching hero copy or boxes.
package system_table_tools

import (
	"database/sql"
	"encoding/json"

	backend "easelect/backend/core_components"
	presentation "easelect/frontend/shared/front_page_presentation"
)

func saveFrontPagePresentation(tx *sql.Tx, raw json.RawMessage, expected string) (string, error) {
	value, err := presentation.Parse(raw)
	if err != nil {
		return "", errFrontPageInput
	}
	if _, err := tx.Exec(`SELECT pg_advisory_xact_lock(hashtextextended('front_page_presentation',0))`); err != nil {
		return "", err
	}
	var currentRaw []byte
	var updated string
	// A row written through the generic settings editor may carry no timestamp.
	err = tx.QueryRow(`SELECT json_value,COALESCE(updated::text,'') FROM public.system_config WHERE key='front_page_presentation' FOR UPDATE`).Scan(&currentRaw, &updated)
	if err != nil && err != sql.ErrNoRows {
		return "", err
	}
	exists := err == nil
	current := "none"
	if exists {
		current = backend.FrontPagePresentationRevision(currentRaw, updated)
	}
	if current != expected {
		return "", errFrontPageConflict
	}
	data, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	beforeFrontPagePresentationWrite()
	if exists {
		// The row is locked above, so no other writer can have changed it since the revision check.
		err = tx.QueryRow(`UPDATE public.system_config SET json_value=$1::jsonb,value_type=5,updated=clock_timestamp()
        WHERE key='front_page_presentation' RETURNING json_value,COALESCE(updated::text,'')`, string(data)).Scan(&currentRaw, &updated)
		if err != nil {
			return "", err
		}
		return backend.FrontPagePresentationRevision(currentRaw, updated), nil
	}
	// An absent row has nothing to lock: the generic settings editor may create it meanwhile without the advisory
	// lock, and that row is then a conflict, never overwritten. The first save stamps the row it creates.
	err = tx.QueryRow(`INSERT INTO public.system_config(key,json_value,value_type,creation_spec,updated)
        VALUES('front_page_presentation',$1::jsonb,5,'Home title and description layout.',clock_timestamp())
        ON CONFLICT(key) DO NOTHING
        RETURNING json_value,COALESCE(updated::text,'')`, string(data)).Scan(&currentRaw, &updated)
	if err == sql.ErrNoRows {
		return "", errFrontPageConflict
	}
	if err != nil {
		return "", err
	}
	return backend.FrontPagePresentationRevision(currentRaw, updated), nil
}

// beforeFrontPagePresentationWrite runs between the revision check and the write; tests use it to commit a competing
// row from another connection at exactly that point.
var beforeFrontPagePresentationWrite = func() {}
