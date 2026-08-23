// password_editor.go
// Changes one user's password against an expected authentication generation.
// Bridges verified web recovery/profile flows with the shared password policy and session revocation.
// Exists so every password change invalidates older sessions and pending verification codes atomically.
package credentials

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"golang.org/x/crypto/bcrypt"
)

// ErrCredentialStateChanged means the user's credentials changed after the caller verified them.
var ErrCredentialStateChanged = errors.New("credential state changed")

// ChangePassword updates a password only when the caller's verified generation is still current.
func ChangePassword(ctx context.Context, db *sql.DB, userID int, newPassword string, expectedGeneration int64) (int64, error) {
	if db == nil {
		return 0, errors.New("database is not initialized")
	}
	if userID <= 1 || expectedGeneration < 1 {
		return 0, ErrCredentialStateChanged
	}
	if err := ValidatePassword(newPassword); err != nil {
		return 0, err
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return 0, fmt.Errorf("hash password: %w", err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin password change: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	var newGeneration int64
	err = tx.QueryRowContext(ctx, `
		UPDATE restricted.users_restricted
		SET password = $1,
		    authentication_generation = authentication_generation + 1
		WHERE id = $2
		  AND authentication_generation = $3
		RETURNING authentication_generation
	`, string(passwordHash), userID, expectedGeneration).Scan(&newGeneration)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrCredentialStateChanged
	}
	if err != nil {
		return 0, fmt.Errorf("update password: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `
		DELETE FROM restricted.verification_codes
		WHERE user_id = $1
		  AND used IS FALSE
	`, userID); err != nil {
		return 0, fmt.Errorf("invalidate pending verification codes: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit password change: %w", err)
	}
	committed = true
	return newGeneration, nil
}
