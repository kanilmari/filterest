// front_page_settings.go
// Reads the site-wide front page switches and its one configured background.
// Connects public bootstrap, administrator configuration and protected storage delivery.
// Keeps malformed configuration visible to administrators and out of public responses.
package backend

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"path"
	"strings"
)

type FrontPageSettings struct {
	SeparateFrontPage            bool `json:"separate_front_page"`
	FrontPageButtonShowsSiteName bool `json:"front_page_button_shows_site_name"`
}

type FrontPageBackground struct {
	StorageKey   string  `json:"storage_key"`
	OriginalName string  `json:"original_name"`
	MIMEType     string  `json:"mime_type"`
	FocalX       float64 `json:"focal_x"`
	FocalY       float64 `json:"focal_y"`
}

// ReadFrontPageSettings defaults missing switches to off, never a malformed value.
func ReadFrontPageSettings(ctx context.Context, db *sql.DB) (FrontPageSettings, error) {
	settings := FrontPageSettings{}
	if db == nil {
		return settings, errors.New("front page settings database unavailable")
	}
	for _, item := range []struct {
		key   string
		value *bool
	}{{"separate_front_page", &settings.SeparateFrontPage}, {"front_page_button_shows_site_name", &settings.FrontPageButtonShowsSiteName}} {
		var value sql.NullBool
		err := db.QueryRowContext(ctx, `SELECT boolean_value FROM public.system_config WHERE key = $1`, item.key).Scan(&value)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return FrontPageSettings{}, err
		}
		if !value.Valid {
			return FrontPageSettings{}, fmt.Errorf("%s must be boolean", item.key)
		}
		*item.value = value.Bool
	}
	return settings, nil
}

// ReadFrontPageBackground returns nil for a missing or deliberately removed image.
func ReadFrontPageBackground(ctx context.Context, db *sql.DB) (*FrontPageBackground, error) {
	if db == nil {
		return nil, errors.New("front page background database unavailable")
	}
	var raw []byte
	err := db.QueryRowContext(ctx, `SELECT json_value FROM public.system_config WHERE key = 'front_page_background'`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if string(raw) == "null" {
		return nil, nil
	}
	var background FrontPageBackground
	if err := json.Unmarshal(raw, &background); err != nil {
		return nil, fmt.Errorf("invalid front_page_background: %w", err)
	}
	if err := ValidateFrontPageBackground(background); err != nil {
		return nil, err
	}
	return &background, nil
}

// ValidateFrontPageBackground confines configuration and cleanup to this feature's files.
func ValidateFrontPageBackground(background FrontPageBackground) error {
	key := background.StorageKey
	parts := strings.Split(key, "/")
	if len(parts) != 4 || parts[0] != "site_media" || parts[1] != "front_page" || parts[2] != "original" ||
		key != path.Clean(key) || strings.Contains(key, `\`) || strings.TrimSpace(parts[3]) != parts[3] {
		return errors.New("invalid front page background storage key")
	}
	mimeType := map[string]string{".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}[path.Ext(key)]
	if mimeType == "" || background.MIMEType != mimeType {
		return errors.New("invalid front page background image type")
	}
	if math.IsNaN(background.FocalX) || math.IsNaN(background.FocalY) || background.FocalX < 0 || background.FocalX > 1 || background.FocalY < 0 || background.FocalY > 1 {
		return errors.New("front page background focal point must be between 0 and 1")
	}
	return nil
}

// FrontPageBackgroundMatches accepts only the original and two display sizes of the configured file.
func FrontPageBackgroundMatches(background *FrontPageBackground, key string) bool {
	if background == nil || ValidateFrontPageBackground(*background) != nil || strings.Contains(key, `\`) || key != path.Clean(key) {
		return false
	}
	for _, variant := range []string{"original", "1000", "2160"} {
		if key == path.Join("site_media", "front_page", variant, path.Base(background.StorageKey)) {
			return true
		}
	}
	return false
}
