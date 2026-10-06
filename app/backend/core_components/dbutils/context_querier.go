// context_querier.go
// Binds legacy Querier-shaped helpers to a consumer's cancellation deadline.
// Workers use this adapter for every database phase while holding drain admission.
// A blocked query cannot outlive its phase and strand a startup transition.
package dbutils

import (
	"context"
	"database/sql"
)

type ContextSQL interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}
type contextQuerier struct {
	ctx context.Context
	q   ContextSQL
}

func BindQueryContext(ctx context.Context, q ContextSQL) Querier { return contextQuerier{ctx, q} }
func (q contextQuerier) Exec(query string, args ...any) (sql.Result, error) {
	return q.q.ExecContext(q.ctx, query, args...)
}
func (q contextQuerier) Query(query string, args ...any) (*sql.Rows, error) {
	return q.q.QueryContext(q.ctx, query, args...)
}
func (q contextQuerier) QueryRow(query string, args ...any) *sql.Row {
	return q.q.QueryRowContext(q.ctx, query, args...)
}
