# Golden Sample: Go Service

This file serves as a reference implementation for Go backend services.
It is stored as a `.md` file to prevent build errors, but the code block below is valid Go code.

```go
package reference_implementations

/*
 * golden_sample_service.go
 *
 * Layer: Service / business logic.
 *
 * This service owns the "Golden Sample" business operation.
 * It does not know about HTTP, routing, request bodies, or response formatting.
 *
 * Transaction contract:
 * - This service opens, commits, and rolls back its own transaction.
 * - Callers should pass parsed input and handle returned errors.
 */

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

var (
	ErrInvalidComplexOperationInput = errors.New("invalid complex operation input")
	ErrGoldenSampleNotFound         = errors.New("golden sample not found")
)

// GoldenSampleService coordinates Golden Sample business operations.
type GoldenSampleService struct {
	db *sql.DB
}

// NewGoldenSampleService wires the database dependency into the service.
func NewGoldenSampleService(db *sql.DB) *GoldenSampleService {
	return &GoldenSampleService{
		db: db,
	}
}

// ComplexOperationInput contains already-parsed input from a handler, worker, or test.
type ComplexOperationInput struct {
	ID    string
	Value string
}

// PerformComplexOperation updates a Golden Sample record as one atomic business operation.
//
// Business contract:
// - ID and Value are required.
// - The database update must succeed inside a transaction.
// - A missing record is returned as ErrGoldenSampleNotFound.
// - HTTP status codes are mapped by the caller, not by this service.
func (s *GoldenSampleService) PerformComplexOperation(ctx context.Context, input ComplexOperationInput) error {
	if err := validateComplexOperationInput(input); err != nil {
		return err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin golden sample transaction: %w", err)
	}

	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	if err := s.updateDatabaseRecord(ctx, tx, input.ID, input.Value); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit golden sample transaction: %w", err)
	}

	committed = true
	return nil
}

func validateComplexOperationInput(input ComplexOperationInput) error {
	if input.ID == "" {
		return fmt.Errorf("%w: id is required", ErrInvalidComplexOperationInput)
	}

	if input.Value == "" {
		return fmt.Errorf("%w: value is required", ErrInvalidComplexOperationInput)
	}

	return nil
}

func (s *GoldenSampleService) updateDatabaseRecord(ctx context.Context, tx *sql.Tx, id string, value string) error {
	const query = `
		UPDATE sample_table
		SET value = $1
		WHERE id = $2
	`

	result, err := tx.ExecContext(ctx, query, value, id)
	if err != nil {
		return fmt.Errorf("update sample_table record %q: %w", id, err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read affected row count for sample_table record %q: %w", id, err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("%w: id=%s", ErrGoldenSampleNotFound, id)
	}

	return nil
}
```
