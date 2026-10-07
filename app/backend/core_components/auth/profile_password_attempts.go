// profile_password_attempts.go
// Counts rejected current passwords with the login-name change limit.
// Connects the profile's locked account transaction and persistent attempt events.
// Failed checks commit only the attempt; successful checks consume no failure slot.
package auth

import (
	"database/sql"
	"easelect/backend/core_components/otp"
	"time"
)

const profilePasswordAttemptPurpose = "profile_current_password"

// The caller holds the account row lock, so both count and failed-attempt writes
// serialize across replicas. Recording the event in this transaction also avoids
// a second connection waiting on the account lock for its foreign-key check.
func profilePasswordAttemptLimitReached(tx *sql.Tx, id int) (bool, error) {
	policy, _ := otp.GetProfile(otp.ProfileLoginNameChange)
	var count int
	err := tx.QueryRow(`SELECT count(*) FROM restricted.otp_send_events
        WHERE user_id=$1 AND purpose=$2 AND requested_at >= NOW()-($3*INTERVAL '1 second')`,
		id, profilePasswordAttemptPurpose, int(policy.UserSendWindow/time.Second)).Scan(&count)
	return count >= policy.UserSendLimit, err
}

func commitProfilePasswordFailure(tx *sql.Tx, id int) error {
	policy, _ := otp.GetProfile(otp.ProfileLoginNameChange)
	if _, err := tx.Exec(`DELETE FROM restricted.otp_send_events WHERE user_id=$1 AND purpose=$2
        AND requested_at < NOW()-($3*INTERVAL '1 second')`, id, profilePasswordAttemptPurpose, int(policy.UserSendWindow/time.Second)); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO restricted.otp_send_events(user_id,purpose,requested_at) VALUES($1,$2,NOW())`, id, profilePasswordAttemptPurpose); err != nil {
		return err
	}
	return tx.Commit()
}
