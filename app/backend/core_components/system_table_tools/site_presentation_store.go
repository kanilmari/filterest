// site_presentation_store.go
// Reads and saves the site presentation configuration.
// Connects the typed allowlist with transaction-owned system_config writes.
// Preserves omitted site defaults and the separate article timestamp setting.
package system_table_tools

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"

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
 INSERT INTO public.system_config(key,json_value,creation_spec,updated)
 VALUES($1,$2::jsonb,'Admin-managed site values and overridable appearance defaults.',clock_timestamp())
 ON CONFLICT(key) DO UPDATE SET json_value=EXCLUDED.json_value,updated=clock_timestamp()
 RETURNING json_value::text,updated::text`

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

// Patches are validated before persistence; the exclusive site lock serializes
// missing rows too. No shared cover write or affected-tab mask scan exists.
var persistSitePresentationSettings = func(r *http.Request, patch SitePresentationSettingsPatch) (SitePresentationSettingsResponse, error) {
	// Direct Go adapters and decoded HTTP JSON use the same numeric representation.
	rawPatch, err := json.Marshal(patch)
	if err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	if err := json.Unmarshal(rawPatch, &patch); err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	if err := validateSitePresentationPatch(patch); err != nil {
		return SitePresentationSettingsResponse{}, &httpresponse.Refusal{Status: 400, LangKey: "dataset_appearance_invalid", Message: err.Error()}
	}
	tx, ok := dbutils.RequireTx(r.Context())
	if !ok {
		return SitePresentationSettingsResponse{}, errors.New("transaction unavailable")
	}
	if err := store.LockShared(tx, true); err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	settings, err := readSitePresentationSettingsWith(tx)
	if err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	if patch.Version == "" || patch.Version != settings.Version {
		return SitePresentationSettingsResponse{}, store.ErrDatasetAppearanceConflict
	}
	for path, value := range patch.Set {
		place, _ := appearance.Rules().PlaceForPath(path)
		if place == appearance.SiteOnly {
			settings.SiteValues[path] = value
		} else {
			settings.Defaults[path] = value
		}
	}
	if patch.RowArticleTimestampDisplayMode != nil {
		settings.RowArticleTimestampDisplayMode = *patch.RowArticleTimestampDisplayMode
	}
	if err := validateSitePresentationSettings(settings); err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	data, err := json.Marshal(store.SiteAppearanceValues{SchemaVersion: 2, SiteValues: settings.SiteValues, Defaults: settings.Defaults})
	if err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	var raw []byte
	var stamp string
	if err := tx.QueryRow(upsertDatasetCoverThemeSQL, datasetCoverThemeConfigKey, string(data)).Scan(&raw, &stamp); err != nil {
		return SitePresentationSettingsResponse{}, fmt.Errorf("save site appearance: %w", err)
	}
	if patch.RowArticleTimestampDisplayMode != nil {
		if _, err := tx.Exec(upsertRowArticleTimestampDisplaySQL, rowArticleTimestampDisplayKey, settings.RowArticleTimestampDisplayMode); err != nil {
			return SitePresentationSettingsResponse{}, err
		}
	}
	settings.Version = store.SharedRevision(raw, stamp)
	return settings, nil
}

func readSitePresentationSettingsFromDB() (SitePresentationSettingsResponse, error) {
	return readSitePresentationSettingsWith(backend.Db)
}

func readSitePresentationSettingsWith(q dbutils.Querier) (SitePresentationSettingsResponse, error) {
	settings := defaultSitePresentationSettings()
	var rawCover []byte
	var rawTimestamp sql.NullString
	var stamp string
	if err := q.QueryRow(readSitePresentationSettingsSQL, datasetCoverThemeConfigKey, rowArticleTimestampDisplayKey).Scan(&rawCover, &rawTimestamp, &stamp); err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	config, err := store.DecodeSiteAppearance(rawCover, os.Getenv("ENVIRONMENT_TYPE") == "dev")
	if err != nil {
		return SitePresentationSettingsResponse{}, err
	}
	settings.SiteValues = store.ValuesForPlace(config, appearance.SiteOnly)
	settings.Defaults = store.ValuesForPlace(config, appearance.SiteDefault)
	settings.Version = store.SharedRevision(rawCover, stamp)
	if rawTimestamp.Valid && validateTimestampDisplayMode(rawTimestamp.String) == nil {
		settings.RowArticleTimestampDisplayMode = rawTimestamp.String
	}
	return settings, nil
}
