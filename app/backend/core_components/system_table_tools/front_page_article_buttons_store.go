// front_page_article_buttons_store.go
// Reads and revision-protects the optional site-wide Home article setting.
// Connects the administrator request transaction to system_config without a migration.
// Locks first writes and hashes content, timestamp and type to reject stale editors.
package system_table_tools

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"

	"easelect/backend/core_components/dbutils"
	config "easelect/backend/core_components/system_config_checks"
)

func articleButtonsRevision(raw []byte, updated string, valueType int) string {
	return fmt.Sprintf("%x", sha256.Sum256([]byte(fmt.Sprintf("%d\n%s\n%s", valueType, updated, raw))))
}

func readFrontPageArticleButtons(ctx context.Context, q *sql.DB) (config.FrontPageArticleButtons, string, error) {
	if q == nil {
		return config.EmptyFrontPageArticleButtons(), "", fmt.Errorf("Home article settings unavailable")
	}
	var raw []byte
	var updated string
	var valueType int
	err := q.QueryRowContext(ctx, `SELECT json_value,COALESCE(updated::text,''),value_type
		FROM public.system_config WHERE key='front_page_article_buttons'`).Scan(&raw, &updated, &valueType)
	if err == sql.ErrNoRows {
		return config.EmptyFrontPageArticleButtons(), "none", nil
	}
	if err != nil {
		return config.EmptyFrontPageArticleButtons(), "", err
	}
	revision := articleButtonsRevision(raw, updated, valueType)
	if valueType != 5 {
		return config.EmptyFrontPageArticleButtons(), revision, fmt.Errorf("Home article buttons require JSON value type 5")
	}
	value, err := config.ParseFrontPageArticleButtons(raw)
	return value, revision, err
}

func saveFrontPageArticleButtons(ctx context.Context, raw []byte, expected string) (string, error) {
	if _, err := config.ParseFrontPageArticleButtons(raw); err != nil {
		return "", fmt.Errorf("%w: %v", errFrontPageInput, err)
	}
	tx, ok := dbutils.RequireTx(ctx)
	if !ok {
		return "", fmt.Errorf("request transaction unavailable")
	}
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('front_page_article_buttons',0))`); err != nil {
		return "", err
	}
	var currentRaw []byte
	var updated string
	var valueType int
	err := tx.QueryRowContext(ctx, `SELECT json_value,COALESCE(updated::text,''),value_type
		FROM public.system_config WHERE key='front_page_article_buttons' FOR UPDATE`).Scan(&currentRaw, &updated, &valueType)
	if err != nil && err != sql.ErrNoRows {
		return "", err
	}
	exists := err == nil
	current := "none"
	if exists {
		current = articleButtonsRevision(currentRaw, updated, valueType)
	}
	if current != expected {
		return "", errFrontPageConflict
	}
	if exists {
		err = tx.QueryRowContext(ctx, `UPDATE public.system_config SET json_value=$1::jsonb,value_type=5,
			updated=GREATEST(clock_timestamp(),updated+interval '1 microsecond')
			WHERE key='front_page_article_buttons' RETURNING json_value,COALESCE(updated::text,''),value_type`, string(raw)).Scan(&currentRaw, &updated, &valueType)
	} else {
		// A writer without our advisory lock can win creation; never overwrite it.
		err = tx.QueryRowContext(ctx, `INSERT INTO public.system_config(key,json_value,value_type,creation_spec,updated)
			VALUES('front_page_article_buttons',$1::jsonb,5,'Site-wide Home article links.',clock_timestamp())
			ON CONFLICT(key) DO NOTHING RETURNING json_value,COALESCE(updated::text,''),value_type`, string(raw)).Scan(&currentRaw, &updated, &valueType)
		if err == sql.ErrNoRows {
			return "", errFrontPageConflict
		}
	}
	if err != nil {
		return "", err
	}
	return articleButtonsRevision(currentRaw, updated, valueType), nil
}
