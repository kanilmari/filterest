// embedding_refresh_worker.go
// Claims durable embedding jobs with leases, calls the external provider outside transactions,
// and stores results only when the source fingerprint and queue generation are still current.
// Exists to make update-triggered embeddings restart-safe without holding row locks over network I/O.
package ai_features

import (
	"context"
	"crypto/md5"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/lib/pq"
	pgvector "github.com/pgvector/pgvector-go"
)

const (
	embeddingWorkerPollInterval  = 2 * time.Second
	embeddingWorkerLeaseDuration = 2 * time.Minute
	embeddingWorkerBatchSize     = 20
)

type embeddingRefreshJob struct {
	ID           int64
	TableUID     int64
	TableName    string
	RowID        int64
	Generation   int64
	AttemptCount int
	LeaseToken   string
}

type embeddingVectorSet struct {
	General    []float32
	ByLanguage map[string][]float32
}

type embeddingGenerateFunc func(context.Context, string) ([]float32, error)

var embeddingRefreshWorkerOnce sync.Once

// StartEmbeddingRefreshWorker starts one process-local claimant; DB leases make multiple app nodes safe.
func StartEmbeddingRefreshWorker(db *sql.DB) {
	if db == nil {
		return
	}
	if !embeddingRefreshQueueAvailable(db) {
		log.Printf("[embedding-refresh] worker disabled code=queue_unavailable")
		return
	}
	embeddingRefreshWorkerOnce.Do(func() {
		go func() {
			ticker := time.NewTicker(embeddingWorkerPollInterval)
			defer ticker.Stop()
			for {
				runEmbeddingRefreshPass(db, GenerateEmbedding)
				<-ticker.C
			}
		}()
	})
}

func embeddingRefreshQueueAvailable(db *sql.DB) bool {
	var available bool
	if err := db.QueryRow(
		`SELECT to_regclass('public.system_embedding_refresh_jobs') IS NOT NULL`,
	).Scan(&available); err != nil {
		return false
	}
	return available
}

func runEmbeddingRefreshPass(db *sql.DB, generate embeddingGenerateFunc) {
	for processed := 0; processed < embeddingWorkerBatchSize; processed++ {
		job, err := claimEmbeddingRefreshJob(db)
		if errors.Is(err, sql.ErrNoRows) {
			return
		}
		if err != nil {
			log.Printf("[embedding-refresh] claim failed code=queue_claim_error")
			return
		}
		if err := processEmbeddingRefreshJob(db, job, generate); err != nil {
			code := classifyEmbeddingRefreshError(err)
			logEmbeddingRefreshFailure(job, code)
			if retryErr := retryEmbeddingRefreshJob(db, job, code); retryErr != nil {
				log.Printf("[embedding-refresh] retry scheduling failed job_id=%d code=queue_retry_error", job.ID)
			}
		}
	}
}

func claimEmbeddingRefreshJob(db *sql.DB) (embeddingRefreshJob, error) {
	leaseToken, err := newEmbeddingLeaseToken()
	if err != nil {
		return embeddingRefreshJob{}, err
	}
	leaseExpiresAt := time.Now().UTC().Add(embeddingWorkerLeaseDuration)
	var job embeddingRefreshJob
	err = db.QueryRow(`
		WITH candidate AS (
			SELECT id
			FROM system_embedding_refresh_jobs
			WHERE available_at <= now()
			  AND (lease_token = '' OR lease_expires_at IS NULL OR lease_expires_at <= now())
			ORDER BY available_at, id
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		UPDATE system_embedding_refresh_jobs job
		SET lease_token = $1,
		    lease_expires_at = $2,
		    updated = now()
		FROM candidate, system_db_tables table_meta
		WHERE job.id = candidate.id
		  AND table_meta.table_uid = job.table_uid
		RETURNING job.id, job.table_uid, table_meta.table_name, job.row_id,
		          job.generation, job.attempt_count, job.lease_token`, leaseToken, leaseExpiresAt).Scan(
		&job.ID,
		&job.TableUID,
		&job.TableName,
		&job.RowID,
		&job.Generation,
		&job.AttemptCount,
		&job.LeaseToken,
	)
	return job, err
}

func processEmbeddingRefreshJob(db *sql.DB, job embeddingRefreshJob, generate embeddingGenerateFunc) error {
	capabilities, err := resolveEmbeddingCapabilities(db, job.TableName)
	if err != nil {
		return fmt.Errorf("capability: %w", err)
	}
	source, err := LoadAuthorizedEmbeddingSource(db, job.TableName, job.RowID, false)
	if errors.Is(err, sql.ErrNoRows) {
		return finishMissingEmbeddingRow(db, job)
	}
	if err != nil {
		return fmt.Errorf("source: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	vectors, err := generateEmbeddingVectorSet(ctx, source, capabilities, generate)
	if err != nil {
		return fmt.Errorf("provider: %w", err)
	}
	return storeEmbeddingRefreshResult(db, job, capabilities, source, vectors)
}

func generateEmbeddingVectorSet(
	ctx context.Context,
	source AuthorizedEmbeddingSource,
	capabilities embeddingCapabilities,
	generate embeddingGenerateFunc,
) (embeddingVectorSet, error) {
	result := embeddingVectorSet{ByLanguage: make(map[string][]float32)}
	if capabilities.General && strings.TrimSpace(source.General) != "" {
		vector, err := generate(ctx, source.General)
		if err != nil || len(vector) == 0 {
			if err == nil {
				err = errors.New("empty general embedding")
			}
			return embeddingVectorSet{}, err
		}
		result.General = vector
	}
	if capabilities.Multilingual {
		for _, language := range embeddingLanguages {
			text := strings.TrimSpace(source.ByLanguage[language])
			if text == "" {
				continue
			}
			vector, err := generate(ctx, text)
			if err != nil || len(vector) == 0 {
				if err == nil {
					err = errors.New("empty language embedding")
				}
				return embeddingVectorSet{}, err
			}
			result.ByLanguage[language] = vector
		}
	}
	return result, nil
}

func storeEmbeddingRefreshResult(
	db *sql.DB,
	job embeddingRefreshJob,
	claimedCapabilities embeddingCapabilities,
	claimedSource AuthorizedEmbeddingSource,
	vectors embeddingVectorSet,
) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("store begin: %w", err)
	}
	defer tx.Rollback()

	currentSource, err := LoadAuthorizedEmbeddingSource(tx, job.TableName, job.RowID, true)
	if errors.Is(err, sql.ErrNoRows) {
		if _, deleteErr := tx.Exec(
			`DELETE FROM system_embedding_refresh_jobs WHERE id=$1 AND lease_token=$2 AND generation=$3`,
			job.ID,
			job.LeaseToken,
			job.Generation,
		); deleteErr != nil {
			return fmt.Errorf("delete missing-row job: %w", deleteErr)
		}
		return tx.Commit()
	}
	if err != nil {
		return fmt.Errorf("store source: %w", err)
	}

	var currentGeneration int64
	var currentLeaseToken string
	if err := tx.QueryRow(`
		SELECT generation, lease_token
		FROM system_embedding_refresh_jobs
		WHERE id=$1
		FOR UPDATE`, job.ID).Scan(&currentGeneration, &currentLeaseToken); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return tx.Commit()
		}
		return fmt.Errorf("store generation: %w", err)
	}
	currentCapabilities, err := resolveEmbeddingCapabilities(tx, job.TableName)
	if err != nil {
		return fmt.Errorf("store capability: %w", err)
	}
	if !embeddingRefreshResultIsCurrent(
		job.Generation,
		currentGeneration,
		job.LeaseToken,
		currentLeaseToken,
		claimedSource.Fingerprint,
		currentSource.Fingerprint,
		claimedCapabilities,
		currentCapabilities,
	) {
		if _, err := tx.Exec(`
			UPDATE system_embedding_refresh_jobs
			SET lease_token='', lease_expires_at=NULL, available_at=now(), updated=now()
			WHERE id=$1 AND lease_token=$2`, job.ID, job.LeaseToken); err != nil {
			return fmt.Errorf("release stale embedding job: %w", err)
		}
		return tx.Commit()
	}

	if err := persistEmbeddingVectors(tx, job, currentCapabilities, currentSource, vectors); err != nil {
		return err
	}
	if _, err := tx.Exec(`
		DELETE FROM system_embedding_refresh_jobs
		WHERE id=$1 AND generation=$2 AND lease_token=$3`, job.ID, job.Generation, job.LeaseToken); err != nil {
		return fmt.Errorf("complete embedding job: %w", err)
	}
	return tx.Commit()
}

func persistEmbeddingVectors(
	tx *sql.Tx,
	job embeddingRefreshJob,
	capabilities embeddingCapabilities,
	source AuthorizedEmbeddingSource,
	vectors embeddingVectorSet,
) error {
	quotedTable := pq.QuoteIdentifier(job.TableName)
	if capabilities.General {
		if strings.TrimSpace(source.General) == "" {
			if _, err := tx.Exec(fmt.Sprintf(`UPDATE %s SET embedding_vector=NULL WHERE id=$1`, quotedTable), job.RowID); err != nil {
				return fmt.Errorf("clear general embedding: %w", err)
			}
		} else {
			if _, err := tx.Exec(
				fmt.Sprintf(`UPDATE %s SET embedding_vector=$1 WHERE id=$2`, quotedTable),
				pgvector.NewVector(vectors.General),
				job.RowID,
			); err != nil {
				return fmt.Errorf("store general embedding: %w", err)
			}
		}
	}

	if capabilities.Multilingual {
		embeddingTable := pq.QuoteIdentifier(job.TableName + "_lang_embeddings")
		for _, language := range embeddingLanguages {
			if _, err := tx.Exec(
				fmt.Sprintf(`DELETE FROM %s WHERE host_row_id=$1 AND language_code=$2`, embeddingTable),
				job.RowID,
				language,
			); err != nil {
				return fmt.Errorf("clear language embedding: %w", err)
			}
			text := strings.TrimSpace(source.ByLanguage[language])
			if text == "" {
				continue
			}
			contentMD5 := fmt.Sprintf("%x", md5.Sum([]byte(text)))
			if _, err := tx.Exec(fmt.Sprintf(`
				INSERT INTO %s (host_row_id, language_code, embedding, updated, content_md5)
				VALUES ($1, $2, $3, now(), $4)`, embeddingTable),
				job.RowID,
				language,
				pgvector.NewVector(vectors.ByLanguage[language]),
				contentMD5,
			); err != nil {
				return fmt.Errorf("store language embedding: %w", err)
			}
		}
	}
	return nil
}

func finishMissingEmbeddingRow(db *sql.DB, job embeddingRefreshJob) error {
	_, err := db.Exec(
		`DELETE FROM system_embedding_refresh_jobs WHERE id=$1 AND lease_token=$2 AND generation=$3`,
		job.ID,
		job.LeaseToken,
		job.Generation,
	)
	return err
}

func retryEmbeddingRefreshJob(db *sql.DB, job embeddingRefreshJob, errorCode string) error {
	nextAttempt := job.AttemptCount + 1
	availableAt := time.Now().UTC().Add(embeddingRetryDelay(nextAttempt))
	_, err := db.Exec(`
		UPDATE system_embedding_refresh_jobs
		SET attempt_count=$1,
		    available_at=$2,
		    lease_token='',
		    lease_expires_at=NULL,
		    last_error_code=$3,
		    updated=now()
		WHERE id=$4 AND generation=$5 AND lease_token=$6`,
		nextAttempt,
		availableAt,
		errorCode,
		job.ID,
		job.Generation,
		job.LeaseToken,
	)
	return err
}

func embeddingRetryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if attempt > 8 {
		attempt = 8
	}
	return time.Duration(1<<uint(attempt-1)) * 5 * time.Second
}

func embeddingRefreshResultIsCurrent(
	claimedGeneration int64,
	currentGeneration int64,
	claimedLeaseToken string,
	currentLeaseToken string,
	claimedFingerprint string,
	currentFingerprint string,
	claimedCapabilities embeddingCapabilities,
	currentCapabilities embeddingCapabilities,
) bool {
	return claimedGeneration == currentGeneration &&
		claimedLeaseToken != "" &&
		claimedLeaseToken == currentLeaseToken &&
		claimedFingerprint == currentFingerprint &&
		claimedCapabilities == currentCapabilities
}

func classifyEmbeddingRefreshError(err error) string {
	message := err.Error()
	switch {
	case strings.HasPrefix(message, "provider:"):
		return "provider_error"
	case strings.HasPrefix(message, "source:"):
		return "source_read_error"
	case strings.HasPrefix(message, "capability:"):
		return "capability_error"
	default:
		return "store_error"
	}
}

func logEmbeddingRefreshFailure(job embeddingRefreshJob, errorCode string) {
	log.Printf(
		"[embedding-refresh] job failed job_id=%d table_uid=%d row_id=%d generation=%d code=%s",
		job.ID,
		job.TableUID,
		job.RowID,
		job.Generation,
		errorCode,
	)
}

func newEmbeddingLeaseToken() (string, error) {
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	return hex.EncodeToString(random), nil
}
