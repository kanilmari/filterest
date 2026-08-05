import { describe, test, expect } from 'vitest';
import { rowMatchesFilters } from './row_filter_checker.js';

describe('rowMatchesFilters', () => {
  test('returns true when no filters', () => {
    expect(rowMatchesFilters({ name: 'test' }, {})).toBe(true);
    expect(rowMatchesFilters({ name: 'test' }, null)).toBe(true);
  });

  test('returns true for null/undefined row', () => {
    expect(rowMatchesFilters(null, { name: 'x' })).toBe(true);
  });

  test('skips empty/null filter values', () => {
    expect(rowMatchesFilters({ name: 'test' }, { name: '', age: null })).toBe(true);
  });

  // Text matching
  test('text filter matches case-insensitively', () => {
    const row = { name: 'Hello World' };
    expect(rowMatchesFilters(row, { name: 'hello' })).toBe(true);
    expect(rowMatchesFilters(row, { name: 'WORLD' })).toBe(true);
    expect(rowMatchesFilters(row, { name: 'xyz' })).toBe(false);
  });

  test('text filter partial match', () => {
    expect(rowMatchesFilters({ city: 'Helsinki' }, { city: 'hels' })).toBe(true);
  });

  test('comma-separated include filters use exact value matching', () => {
    expect(rowMatchesFilters({ status: 'Done' }, { status: 'Done,Archived' })).toBe(true);
    expect(rowMatchesFilters({ status: 'Done Today' }, { status: 'Done,Archived' })).toBe(false);
  });

  test('null cell value fails text filter', () => {
    expect(rowMatchesFilters({ name: null }, { name: 'test' })).toBe(false);
  });

  test('exclude filter uses exact matching for single values', () => {
    expect(rowMatchesFilters({ status: 'Done' }, { status_exclude: 'done' })).toBe(false);
    expect(rowMatchesFilters({ status: 'Done Today' }, { status_exclude: 'done' })).toBe(true);
  });

  test('exclude filter rejects comma-separated exact matches', () => {
    expect(rowMatchesFilters({ status: 'Archived' }, { status_exclude: 'done,archived' })).toBe(false);
    expect(rowMatchesFilters({ status: 'In Progress' }, { status_exclude: 'done,archived' })).toBe(true);
  });

  // Table-prefixed keys
  test('strips tableName prefix from filter keys', () => {
    const row = { name: 'test' };
    expect(rowMatchesFilters(row, { users_name: 'test' }, 'users')).toBe(true);
  });

  // Numeric range filters
  test('numeric _from filter', () => {
    const types = { age: 'integer' };
    expect(rowMatchesFilters({ age: 25 }, { age_from: '20' }, '', types)).toBe(true);
    expect(rowMatchesFilters({ age: 15 }, { age_from: '20' }, '', types)).toBe(false);
  });

  test('numeric _to filter', () => {
    const types = { age: 'integer' };
    expect(rowMatchesFilters({ age: 25 }, { age_to: '30' }, '', types)).toBe(true);
    expect(rowMatchesFilters({ age: 35 }, { age_to: '30' }, '', types)).toBe(false);
  });

  test('numeric range both bounds', () => {
    const types = { price: 'numeric' };
    const filters = { price_from: '10', price_to: '50' };
    expect(rowMatchesFilters({ price: 25 }, filters, '', types)).toBe(true);
    expect(rowMatchesFilters({ price: 5 }, filters, '', types)).toBe(false);
    expect(rowMatchesFilters({ price: 55 }, filters, '', types)).toBe(false);
  });

  test('null row value fails range filter', () => {
    const types = { age: 'integer' };
    expect(rowMatchesFilters({ age: null }, { age_from: '10' }, '', types)).toBe(false);
  });

  test('unparsable filter value is ignored', () => {
    const types = { age: 'integer' };
    expect(rowMatchesFilters({ age: 25 }, { age_from: 'abc' }, '', types)).toBe(true);
  });

  // Date range filters
  test('date _from filter', () => {
    const types = { created: 'date' };
    expect(rowMatchesFilters(
      { created: '2026-03-15' },
      { created_from: '2026-03-01' }, '', types
    )).toBe(true);
    expect(rowMatchesFilters(
      { created: '2026-02-15' },
      { created_from: '2026-03-01' }, '', types
    )).toBe(false);
  });

  test('date-like value detected without type hint', () => {
    // No type hint but filter value looks like a date
    expect(rowMatchesFilters(
      { created: '2026-03-15' },
      { created_from: '2026-03-01' }
    )).toBe(true);
  });

  // Boolean filters
  test('boolean filter matches true/false', () => {
    const types = { active: 'boolean' };
    expect(rowMatchesFilters({ active: true }, { active: 'true' }, '', types)).toBe(true);
    expect(rowMatchesFilters({ active: false }, { active: 'true' }, '', types)).toBe(false);
    expect(rowMatchesFilters({ active: false }, { active: 'false' }, '', types)).toBe(true);
  });

  test('boolean "empty" filter matches null/undefined/empty', () => {
    const types = { active: 'boolean' };
    expect(rowMatchesFilters({ active: null }, { active: 'empty' }, '', types)).toBe(true);
    expect(rowMatchesFilters({ active: undefined }, { active: 'empty' }, '', types)).toBe(true);
    expect(rowMatchesFilters({ active: '' }, { active: 'empty' }, '', types)).toBe(true);
    expect(rowMatchesFilters({ active: true }, { active: 'empty' }, '', types)).toBe(false);
  });

  test('boolean exclude filter rejects matching values', () => {
    const types = { active: 'boolean' };
    expect(rowMatchesFilters({ active: true }, { active_exclude: 'true' }, '', types)).toBe(false);
    expect(rowMatchesFilters({ active: false }, { active_exclude: 'true' }, '', types)).toBe(true);
  });

  // Multiple filters (AND logic)
  test('all filters must match', () => {
    const row = { name: 'Matti', city: 'Helsinki' };
    expect(rowMatchesFilters(row, { name: 'matti', city: 'helsinki' })).toBe(true);
    expect(rowMatchesFilters(row, { name: 'matti', city: 'tampere' })).toBe(false);
  });

  // Type hint as object
  test('type hint can be an object with data_type', () => {
    const types = { age: { data_type: 'integer' } };
    expect(rowMatchesFilters({ age: 25 }, { age_from: '20' }, '', types)).toBe(true);
  });
});
