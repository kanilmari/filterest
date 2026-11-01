// category_filter_button_width_mode.go
// Reads the optional site-wide category button layout on every auth bootstrap.
// Connects system_config text storage to visitors and signed-in readers equally.
// Keeps missing, unreadable and unknown settings on the fill-row default.
package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

const categoryFilterButtonWidthModeKey = "category_filter_button_width_mode"
const defaultCategoryFilterButtonWidthMode = "fill_row_with_centered_label"

func readCategoryFilterButtonWidthMode(ctx context.Context, db *sql.DB) (string, error) {
	if db == nil {
		return defaultCategoryFilterButtonWidthMode, errors.New("settings database unavailable")
	}
	var value sql.NullString
	err := db.QueryRowContext(ctx, `SELECT text_value FROM system_config WHERE key = $1`, categoryFilterButtonWidthModeKey).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return defaultCategoryFilterButtonWidthMode, nil
	}
	if err != nil {
		return defaultCategoryFilterButtonWidthMode, err
	}
	switch value.String {
	case defaultCategoryFilterButtonWidthMode, "fit_to_label":
		return value.String, nil
	default:
		return defaultCategoryFilterButtonWidthMode, fmt.Errorf("unknown category button width mode")
	}
}
