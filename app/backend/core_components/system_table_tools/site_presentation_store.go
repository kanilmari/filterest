// site_presentation_store.go
// Reads and saves the site presentation configuration.
// Connects the typed allowlist with transaction-owned system_config writes.
// Preserves newer stored choices when legacy clients omit them.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	backend "easelect/backend/core_components"
	store "easelect/backend/core_components/dataset_appearance_store"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	appearance "easelect/frontend/shared/dataset_appearance"
)

const readSitePresentationSettingsSQL = `
	SELECT
		COALESCE((
			SELECT COALESCE(json_value::text,'null')
			FROM public.system_config
			WHERE key = $1
		), ''),
		COALESCE((
			SELECT COALESCE(NULLIF(text_value, ''), json_value ->> 'value')
			FROM public.system_config
			WHERE key = $2
		), ''), COALESCE((SELECT updated::text FROM public.system_config WHERE key=$1),'')`

const upsertDatasetCoverThemeSQL = `
	INSERT INTO public.system_config (
		key,
		json_value,
		creation_spec, updated
	)
	VALUES (
		$1,
		$2::jsonb,
		'Admin-managed, theme-aware dataset cover presentation settings.', clock_timestamp()
	)
	ON CONFLICT (key) DO UPDATE
	SET json_value = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
		EXCLUDED.json_value,
		'{shared,card_show_all_fields}',
		CASE
			WHEN NOT $3::boolean THEN EXCLUDED.json_value #> '{shared,card_show_all_fields}'
			WHEN jsonb_typeof(public.system_config.json_value #> '{shared,card_show_all_fields}') = 'boolean'
				THEN public.system_config.json_value #> '{shared,card_show_all_fields}'
			ELSE 'true'::jsonb
		END
	), '{shared,card_style_variant}',
		CASE
			WHEN NOT $4::boolean THEN EXCLUDED.json_value #> '{shared,card_style_variant}'
			WHEN public.system_config.json_value #>> '{shared,card_style_variant}' IN ('standard', 'modern')
				THEN public.system_config.json_value #> '{shared,card_style_variant}'
			ELSE '"modern"'::jsonb
		END
	), '{shared,card_detail_columns}',
		CASE
			WHEN NOT $5::boolean THEN EXCLUDED.json_value #> '{shared,card_detail_columns}'
			WHEN public.system_config.json_value #> '{shared,card_detail_columns}' IN ('1'::jsonb, '2'::jsonb, '3'::jsonb, '4'::jsonb)
				THEN public.system_config.json_value #> '{shared,card_detail_columns}'
			ELSE '2'::jsonb
		END
	), '{shared,article_image_caption_position}',
		CASE
			WHEN NOT $6::boolean THEN EXCLUDED.json_value #> '{shared,article_image_caption_position}'
			WHEN public.system_config.json_value #>> '{shared,article_image_caption_position}' IN ('below', 'overlay')
				THEN public.system_config.json_value #> '{shared,article_image_caption_position}'
			ELSE '"below"'::jsonb
		END
	), '{shared,filterbar_content_top_space}',
		CASE
			WHEN NOT $7::boolean THEN EXCLUDED.json_value #> '{shared,filterbar_content_top_space}'
			WHEN jsonb_typeof(public.system_config.json_value #> '{shared,filterbar_content_top_space}') = 'number'
				THEN public.system_config.json_value #> '{shared,filterbar_content_top_space}'
			ELSE '40'::jsonb
		END
	), '{shared,label_value_layout}',
		CASE
			WHEN NOT $8::boolean THEN EXCLUDED.json_value #> '{shared,label_value_layout}'
			WHEN public.system_config.json_value #>> '{shared,label_value_layout}' IN ('stacked', 'inline')
				OR ($9::boolean AND public.system_config.json_value #>> '{shared,label_value_layout}' = 'auto')
				THEN public.system_config.json_value #> '{shared,label_value_layout}'
			ELSE '"stacked"'::jsonb
		END
	), '{shared,active_filter_remove_side}',
		CASE
			WHEN NOT $10::boolean THEN EXCLUDED.json_value #> '{shared,active_filter_remove_side}'
			WHEN public.system_config.json_value #>> '{shared,active_filter_remove_side}' IN ('start', 'end')
				THEN public.system_config.json_value #> '{shared,active_filter_remove_side}'
			ELSE '"start"'::jsonb
		END
	),
	    creation_spec = COALESCE(NULLIF(public.system_config.creation_spec, ''), EXCLUDED.creation_spec),
	    updated = clock_timestamp()
	RETURNING (json_value #>> '{shared,card_show_all_fields}')::boolean,
	          json_value #>> '{shared,card_style_variant}',
	          (json_value #>> '{shared,card_detail_columns}')::int,
	          json_value #>> '{shared,article_image_caption_position}',
	          (json_value #>> '{shared,filterbar_content_top_space}')::float8,
	          json_value #>> '{shared,label_value_layout}',
	          json_value #>> '{shared,active_filter_remove_side}'`

const upsertRowArticleTimestampDisplaySQL = `
	INSERT INTO public.system_config (
		key,
		json_value,
		text_value,
		creation_spec
	)
	VALUES (
		$1,
		jsonb_build_object('value', $2::text),
		$2,
		'Admin-managed row article timestamp display mode.'
	)
	ON CONFLICT (key) DO UPDATE
	SET json_value = EXCLUDED.json_value,
	    text_value = EXCLUDED.text_value,
	    creation_spec = COALESCE(NULLIF(public.system_config.creation_spec, ''), EXCLUDED.creation_spec),
	    updated = NOW()`

var readSitePresentationSettings = readSitePresentationSettingsFromDB

// Legacy clients omit newer presentation settings. Resolve those omissions under the
// upsert's row lock, then return the persisted value rather than the input default.
var persistSitePresentationSettings = func(r *http.Request, settings SitePresentationSettingsResponse) (SitePresentationSettingsResponse, error) {
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		return SitePresentationSettingsResponse{}, errors.New("transaction unavailable")
	}
	if err := store.LockShared(tx, true); err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	_, currentVersion, err := store.ReadShared(tx, os.Getenv("ENVIRONMENT_TYPE") == "dev")
	if err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	if settings.Version == "" || settings.Version != currentVersion {
		return SitePresentationSettingsResponse{}, store.ErrDatasetAppearanceConflict
	}
	coverJSON, err := json.Marshal(settings.DatasetCoverTheme)
	if err != nil {
		return SitePresentationSettingsResponse{}, fmt.Errorf("encode cover theme: %w", err)
	}
	err = tx.QueryRow(
		upsertDatasetCoverThemeSQL,
		datasetCoverThemeConfigKey,
		string(coverJSON),
		settings.preserveStoredCardShowAllFields,
		settings.preserveStoredCardStyleVariant,
		settings.preserveStoredCardDetailColumns,
		settings.preserveStoredArticleImageCaptionPosition,
		settings.preserveStoredFilterbarContentTopSpace,
		settings.preserveStoredLabelValueLayout,
		os.Getenv("ENVIRONMENT_TYPE") == "dev",
		settings.preserveStoredActiveFilterRemoveSide,
	).Scan(&settings.DatasetCoverTheme.Shared.CardShowAllFields, &settings.DatasetCoverTheme.Shared.CardStyleVariant, &settings.DatasetCoverTheme.Shared.CardDetailColumns, &settings.DatasetCoverTheme.Shared.ArticleImageCaptionPosition, &settings.DatasetCoverTheme.Shared.FilterbarContentTopSpace, &settings.DatasetCoverTheme.Shared.LabelValueLayout, &settings.DatasetCoverTheme.Shared.ActiveFilterRemoveSide)
	if err != nil {
		return SitePresentationSettingsResponse{}, fmt.Errorf("save cover theme: %w", err)
	}
	// Omitted legacy fields preserve storage under the lock, so validate the
	// actual shared result before commit. Retained dataset masks are outside K290.
	if err := validateSitePresentationSettings(settings); err != nil {
		return SitePresentationSettingsResponse{}, &httpresponse.Refusal{Status: 400, LangKey: "dataset_appearance_invalid", Message: "invalid persisted shared appearance"}
	}
	_, err = tx.Exec(
		upsertRowArticleTimestampDisplaySQL,
		rowArticleTimestampDisplayKey,
		settings.RowArticleTimestampDisplayMode,
	)
	if err != nil {
		return SitePresentationSettingsResponse{}, fmt.Errorf("save timestamp display mode: %w", err)
	}
	_, settings.Version, err = store.ReadShared(tx, os.Getenv("ENVIRONMENT_TYPE") == "dev")
	return settings, err
}

func readSitePresentationSettingsFromDB() (SitePresentationSettingsResponse, error) {
	settings := defaultSitePresentationSettings()
	var rawCover string
	var rawTimestamp sql.NullString
	var stamp string
	if err := backend.Db.QueryRow(
		readSitePresentationSettingsSQL,
		datasetCoverThemeConfigKey,
		rowArticleTimestampDisplayKey,
	).Scan(&rawCover, &rawTimestamp, &stamp); err != nil {
		return SitePresentationSettingsResponse{}, err
	}

	settings.Version = store.SharedRevision([]byte(rawCover), stamp)
	if strings.TrimSpace(rawCover) != "" {
		settings.DatasetCoverTheme = normalizedStoredDatasetCoverTheme(rawCover)
	}
	if rawTimestamp.Valid && validateTimestampDisplayMode(rawTimestamp.String) == nil {
		settings.RowArticleTimestampDisplayMode = rawTimestamp.String
	}
	return settings, nil
}

// normalizedStoredDatasetCoverTheme is the compatibility read boundary shared by
// the site endpoint and internal override saves. Invalid stored config falls back
// to defaults, while omitted legacy fields retain the existing read behavior.
func normalizedStoredDatasetCoverTheme(raw string) DatasetCoverThemeConfig {
	return appearance.NormalizeStoredConfig(raw, os.Getenv("ENVIRONMENT_TYPE") == "dev")
}
