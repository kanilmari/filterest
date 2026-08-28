// update_notice_handler.go
// Persists and streams the fixed administrator production-update notice contract.
// Bridges lifecycle-manager commands, system_config, and authenticated admin browsers.
// Exists so administrators can save work before a controlled deployment begins.

package router

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/event_bus"
	"easelect/backend/core_components/httpresponse"
)

const (
	productionUpdateNoticeConfigKey     = "production_update_notice"
	productionUpdateNoticeSchemaVersion = 1
	productionUpdateNoticeAnnounced     = "announced"
	productionUpdateNoticeDraining      = "draining"
	productionUpdateNoticeCleared       = "cleared"
	productionUpdateNoticeEventName     = "update_notice"
	productionUpdateNoticeRevokedEvent  = "access_revoked"
)

var (
	productionUpdateNoticeIDPattern        = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`)
	productionUpdateNoticeNow              = func() time.Time { return time.Now().UTC() }
	productionUpdateNoticeHeartbeat        = 15 * time.Second
	productionUpdateNoticeSnapshotInterval = 15 * time.Second
	productionUpdateNoticeRecheck          = 15 * time.Second
	productionUpdateNoticeLifetime         = 60 * time.Second
	readProductionUpdateNotice             = readProductionUpdateNoticeFromDatabase
	applyProductionUpdateNotice            = applyProductionUpdateNoticeToDatabase
	productionUpdateNoticeAdminOK          = productionUpdateNoticeAdminStillAllowed
	readProductionUpdateNoticeAdminFlags   = readProductionUpdateNoticeAdminFlagsFromDatabase
)

type productionUpdateNotice struct {
	SchemaVersion int    `json:"schema_version"`
	NoticeID      string `json:"notice_id"`
	State         string `json:"state"`
	AnnouncedAt   string `json:"announced_at"`
	StartsAt      string `json:"starts_at"`
	ExpiresAt     string `json:"expires_at"`
	UpdatedAt     string `json:"updated_at"`
}

type productionUpdateNoticeSnapshot struct {
	productionUpdateNotice
	ServerTime string `json:"server_time"`
}

type productionUpdateNoticeRequest struct {
	SchemaVersion int     `json:"schema_version"`
	NoticeID      string  `json:"notice_id"`
	State         string  `json:"state"`
	StartsAt      *string `json:"starts_at"`
	ExpiresAt     *string `json:"expires_at"`
}

var errProductionUpdateNoticeConflict = errors.New("production update notice conflict")

// systemUpdateNoticeHandler accepts only manager-authenticated lifecycle writes.
// The public route profile is intentional: the bearer/peer guard is narrower
// than browser authentication and keeps this endpoint usable during API drain.
func systemUpdateNoticeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if rejectDisallowedSystemDrainManagerRequest(w, r) {
		return
	}

	request, err := decodeProductionUpdateNoticeRequest(w, r)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "Invalid update notice request")
		return
	}

	snapshot, changed, err := applyProductionUpdateNotice(r.Context(), request, productionUpdateNoticeNow())
	if errors.Is(err, errProductionUpdateNoticeConflict) {
		httpresponse.RespondWithError(w, http.StatusConflict, "Update notice conflicts with current state")
		return
	}
	if err != nil {
		log.Printf("\033[31merror: apply production update notice: %v\033[0m", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Update notice unavailable")
		return
	}

	if changed {
		event_bus.Bus.Publish(event_bus.InternalUpdateNoticeTopic, event_bus.Event{
			Action: snapshot.State,
		})
	}
	w.Header().Set("Cache-Control", "no-store")
	httpresponse.RespondWithJSON(w, http.StatusOK, snapshot)
}

func decodeProductionUpdateNoticeRequest(w http.ResponseWriter, r *http.Request) (productionUpdateNoticeRequest, error) {
	request := productionUpdateNoticeRequest{}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return request, errors.New("request must contain one JSON value")
	}
	if err := validateProductionUpdateNoticeRequest(request, productionUpdateNoticeNow()); err != nil {
		return request, err
	}
	return request, nil
}

func validateProductionUpdateNoticeRequest(request productionUpdateNoticeRequest, now time.Time) error {
	if request.SchemaVersion != productionUpdateNoticeSchemaVersion ||
		!productionUpdateNoticeIDPattern.MatchString(request.NoticeID) {
		return errors.New("invalid schema version or notice id")
	}

	switch request.State {
	case productionUpdateNoticeAnnounced, productionUpdateNoticeDraining:
		if request.StartsAt == nil || request.ExpiresAt == nil {
			return errors.New("active notice requires starts_at and expires_at")
		}
		startsAt, startsErr := time.Parse(time.RFC3339, *request.StartsAt)
		expiresAt, expiresErr := time.Parse(time.RFC3339, *request.ExpiresAt)
		if startsErr != nil || expiresErr != nil {
			return errors.New("notice timestamps must use RFC3339")
		}
		if !expiresAt.After(startsAt) || !expiresAt.After(now) {
			return errors.New("expires_at must be after starts_at and server time")
		}
		if startsAt.Before(now.Add(-24*time.Hour)) || startsAt.After(now.Add(7*24*time.Hour)) ||
			expiresAt.After(startsAt.Add(24*time.Hour)) {
			return errors.New("notice timestamps outside allowed window")
		}
	case productionUpdateNoticeCleared:
		if request.StartsAt != nil || request.ExpiresAt != nil {
			return errors.New("clear request accepts only schema_version, notice_id, and state")
		}
	default:
		return errors.New("invalid notice state")
	}
	return nil
}

func normalizeProductionUpdateNoticeRequest(request productionUpdateNoticeRequest) productionUpdateNoticeRequest {
	if request.StartsAt != nil {
		parsed, _ := time.Parse(time.RFC3339, *request.StartsAt)
		normalized := parsed.UTC().Format(time.RFC3339)
		request.StartsAt = &normalized
	}
	if request.ExpiresAt != nil {
		parsed, _ := time.Parse(time.RFC3339, *request.ExpiresAt)
		normalized := parsed.UTC().Format(time.RFC3339)
		request.ExpiresAt = &normalized
	}
	return request
}

func transitionProductionUpdateNotice(current productionUpdateNotice, request productionUpdateNoticeRequest, now time.Time) (productionUpdateNotice, bool, error) {
	request = normalizeProductionUpdateNoticeRequest(request)
	effectiveCurrent := effectiveProductionUpdateNotice(current, now)
	nowText := now.UTC().Format(time.RFC3339Nano)

	if request.State == productionUpdateNoticeCleared {
		if effectiveCurrent.NoticeID == "" || effectiveCurrent.NoticeID != request.NoticeID {
			return current, false, errProductionUpdateNoticeConflict
		}
		if effectiveCurrent.State == productionUpdateNoticeCleared {
			return current, false, nil
		}
		current.State = productionUpdateNoticeCleared
		current.UpdatedAt = nowText
		return current, true, nil
	}

	requestedStartsAt := *request.StartsAt
	requestedExpiresAt := *request.ExpiresAt
	if effectiveCurrent.State != productionUpdateNoticeCleared {
		if effectiveCurrent.NoticeID != request.NoticeID ||
			effectiveCurrent.StartsAt != requestedStartsAt ||
			effectiveCurrent.ExpiresAt != requestedExpiresAt {
			return current, false, errProductionUpdateNoticeConflict
		}
		if effectiveCurrent.State == request.State {
			return current, false, nil
		}
		if effectiveCurrent.State != productionUpdateNoticeAnnounced || request.State != productionUpdateNoticeDraining {
			return current, false, errProductionUpdateNoticeConflict
		}
		current.State = productionUpdateNoticeDraining
		current.UpdatedAt = nowText
		return current, true, nil
	}

	if current.NoticeID != "" && current.NoticeID == request.NoticeID {
		return current, false, errProductionUpdateNoticeConflict
	}
	return productionUpdateNotice{
		SchemaVersion: productionUpdateNoticeSchemaVersion,
		NoticeID:      request.NoticeID,
		State:         request.State,
		AnnouncedAt:   nowText,
		StartsAt:      requestedStartsAt,
		ExpiresAt:     requestedExpiresAt,
		UpdatedAt:     nowText,
	}, true, nil
}

func effectiveProductionUpdateNotice(notice productionUpdateNotice, now time.Time) productionUpdateNotice {
	if notice.State != productionUpdateNoticeAnnounced && notice.State != productionUpdateNoticeDraining {
		return notice
	}
	expiresAt, err := time.Parse(time.RFC3339, notice.ExpiresAt)
	if err == nil && !now.Before(expiresAt) {
		// This is intentionally a read-only projection. Keeping the original ID
		// in storage prevents an expired deployment ID from being reused even
		// though clients fail soft to the cleared state.
		notice.State = productionUpdateNoticeCleared
	}
	return notice
}

func validateStoredProductionUpdateNotice(notice productionUpdateNotice) error {
	if notice.SchemaVersion != productionUpdateNoticeSchemaVersion {
		return errors.New("unsupported stored notice schema")
	}
	if notice.State == productionUpdateNoticeCleared && notice.NoticeID == "" {
		return nil
	}
	if !productionUpdateNoticeIDPattern.MatchString(notice.NoticeID) {
		return errors.New("invalid stored notice id")
	}
	if notice.State != productionUpdateNoticeAnnounced && notice.State != productionUpdateNoticeDraining && notice.State != productionUpdateNoticeCleared {
		return errors.New("invalid stored notice state")
	}
	if notice.AnnouncedAt == "" || notice.UpdatedAt == "" || notice.StartsAt == "" || notice.ExpiresAt == "" {
		return errors.New("stored notice timestamps missing")
	}
	for _, value := range []string{notice.AnnouncedAt, notice.UpdatedAt, notice.StartsAt, notice.ExpiresAt} {
		if _, err := time.Parse(time.RFC3339, value); err != nil {
			return fmt.Errorf("invalid stored notice timestamp: %w", err)
		}
	}
	return nil
}

func decodeStoredProductionUpdateNotice(raw string) (productionUpdateNotice, error) {
	notice := productionUpdateNotice{}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&notice); err != nil {
		return notice, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return notice, errors.New("stored notice contains trailing JSON")
	}
	return notice, validateStoredProductionUpdateNotice(notice)
}

func snapshotProductionUpdateNotice(notice productionUpdateNotice, now time.Time) productionUpdateNoticeSnapshot {
	return productionUpdateNoticeSnapshot{
		productionUpdateNotice: effectiveProductionUpdateNotice(notice, now),
		ServerTime:             now.UTC().Format(time.RFC3339Nano),
	}
}

func readProductionUpdateNoticeFromDatabase(ctx context.Context, now time.Time) (productionUpdateNoticeSnapshot, error) {
	var raw string
	err := backend.Db.QueryRowContext(ctx, `
		SELECT json_value::text
		FROM public.system_config
		WHERE key = $1`, productionUpdateNoticeConfigKey).Scan(&raw)
	if err != nil {
		return productionUpdateNoticeSnapshot{}, err
	}
	notice, err := decodeStoredProductionUpdateNotice(raw)
	if err != nil {
		return productionUpdateNoticeSnapshot{}, err
	}
	return snapshotProductionUpdateNotice(notice, now), nil
}

func applyProductionUpdateNoticeToDatabase(ctx context.Context, request productionUpdateNoticeRequest, now time.Time) (productionUpdateNoticeSnapshot, bool, error) {
	tx, err := backend.Db.BeginTx(ctx, &sql.TxOptions{})
	if err != nil {
		return productionUpdateNoticeSnapshot{}, false, err
	}
	defer tx.Rollback()

	var raw string
	if err := tx.QueryRowContext(ctx, `
		SELECT json_value::text
		FROM public.system_config
		WHERE key = $1
		FOR UPDATE`, productionUpdateNoticeConfigKey).Scan(&raw); err != nil {
		return productionUpdateNoticeSnapshot{}, false, err
	}
	current, err := decodeStoredProductionUpdateNotice(raw)
	if err != nil {
		return productionUpdateNoticeSnapshot{}, false, err
	}
	next, changed, err := transitionProductionUpdateNotice(current, request, now)
	if err != nil {
		return productionUpdateNoticeSnapshot{}, false, err
	}
	if changed {
		encoded, encodeErr := json.Marshal(next)
		if encodeErr != nil {
			return productionUpdateNoticeSnapshot{}, false, encodeErr
		}
		result, updateErr := tx.ExecContext(ctx, `
			UPDATE public.system_config
			SET json_value = $2::jsonb,
			    updated = now()
			WHERE key = $1`, productionUpdateNoticeConfigKey, encoded)
		if updateErr != nil {
			return productionUpdateNoticeSnapshot{}, false, updateErr
		}
		if rows, rowsErr := result.RowsAffected(); rowsErr != nil || rows != 1 {
			return productionUpdateNoticeSnapshot{}, false, errors.New("update notice config row missing")
		}
	}
	if err := tx.Commit(); err != nil {
		return productionUpdateNoticeSnapshot{}, false, err
	}
	return snapshotProductionUpdateNotice(next, now), changed, nil
}

// adminUpdateNoticeStreamHandler streams snapshots, not operator-supplied events.
// Subscribing before the first read prevents a local write between snapshot and
// subscription from being missed; periodic snapshots cover other app nodes.
func adminUpdateNoticeStreamHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "Streaming not supported")
		return
	}
	actor, ok := dbutils.GetRequestActorContext(r.Context())
	if !ok || !actor.IsAdmin || actor.UserID <= 1 {
		httpresponse.RespondWithAuthFailure(w, "403 - Forbidden")
		return
	}

	wakeEvents, unsubscribe := event_bus.Bus.Subscribe(event_bus.InternalUpdateNoticeTopic)
	defer unsubscribe()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-store")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	writeSnapshot := func() bool {
		snapshot, err := readProductionUpdateNotice(r.Context(), productionUpdateNoticeNow())
		if err != nil {
			log.Printf("\033[31merror: read production update notice snapshot: %v\033[0m", err)
			return false
		}
		payload, err := json.Marshal(snapshot)
		if err != nil {
			return false
		}
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", productionUpdateNoticeEventName, payload)
		flusher.Flush()
		return true
	}
	if !writeSnapshot() {
		return
	}

	heartbeat := time.NewTicker(productionUpdateNoticeHeartbeat)
	defer heartbeat.Stop()
	snapshotTicker := time.NewTicker(productionUpdateNoticeSnapshotInterval)
	defer snapshotTicker.Stop()
	recheckTicker := time.NewTicker(productionUpdateNoticeRecheck)
	defer recheckTicker.Stop()
	lifetime := time.NewTimer(productionUpdateNoticeLifetime)
	defer lifetime.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-lifetime.C:
			return
		case <-heartbeat.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		case <-snapshotTicker.C:
			if !writeSnapshot() {
				return
			}
		case <-wakeEvents:
			if !writeSnapshot() {
				return
			}
		case <-recheckTicker.C:
			allowed, err := productionUpdateNoticeAdminOK(r.Context(), actor.UserID)
			if err != nil || !allowed {
				fmt.Fprintf(w, "event: %s\ndata: {}\n\n", productionUpdateNoticeRevokedEvent)
				flusher.Flush()
				return
			}
		}
	}
}

func productionUpdateNoticeAdminStillAllowed(ctx context.Context, userID int) (bool, error) {
	enabled, adminAllowed, adminsMember, err := readProductionUpdateNoticeAdminFlags(ctx, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return enabled && adminAllowed && adminsMember, err
}

func readProductionUpdateNoticeAdminFlagsFromDatabase(ctx context.Context, userID int) (bool, bool, bool, error) {
	var enabled bool
	var adminAllowed bool
	var adminsMember bool
	err := backend.Db.QueryRowContext(ctx, `
		SELECT
			COALESCE(users.enabled, FALSE),
			COALESCE(users.admin_access_allowed, FALSE),
			EXISTS (
				SELECT 1
				FROM public.system_user_group_memberships AS memberships
				JOIN public.system_user_groups AS groups
				  ON groups.id = memberships.group_id
				WHERE memberships.user_id = users.id
				  AND groups.name = 'admins'
			)
		FROM public.system_users AS users
		WHERE users.id = $1`, userID).Scan(&enabled, &adminAllowed, &adminsMember)
	return enabled, adminAllowed, adminsMember, err
}
