import { describe, expect, it } from 'vitest';
import { formatDateParam, isEditableDate, mondayOf, parseDateParam } from './plan';

describe('mondayOf', () => {
  it('returns the same date when given a Monday', () => {
    expect(formatDateParam(mondayOf(new Date('2026-07-20T00:00:00Z')))).toBe('2026-07-20');
  });

  it('rolls back to Monday when given a Sunday', () => {
    expect(formatDateParam(mondayOf(new Date('2026-07-26T00:00:00Z')))).toBe('2026-07-20');
  });

  it('rolls back across a month boundary', () => {
    expect(formatDateParam(mondayOf(new Date('2026-08-02T00:00:00Z')))).toBe('2026-07-27');
  });

  it('rolls back across a year boundary', () => {
    expect(formatDateParam(mondayOf(new Date('2026-01-01T00:00:00Z')))).toBe('2025-12-29');
  });
});

describe('parseDateParam', () => {
  it('parses a valid YYYY-MM-DD string', () => {
    const date = parseDateParam('2026-07-20');
    expect(date && formatDateParam(date)).toBe('2026-07-20');
  });

  it('rejects a malformed string', () => {
    expect(parseDateParam('not-a-date')).toBeNull();
  });

  it('rejects a string with an invalid calendar date', () => {
    expect(parseDateParam('2026-02-30')).toBeNull();
  });
});

describe('isEditableDate', () => {
  const now = new Date('2026-07-20T15:00:00Z');

  it('treats today as editable', () => {
    expect(isEditableDate(new Date('2026-07-20'), now)).toBe(true);
  });

  it('treats a future date as editable', () => {
    expect(isEditableDate(new Date('2026-07-21'), now)).toBe(true);
  });

  it('treats a past date as not editable', () => {
    expect(isEditableDate(new Date('2026-07-19'), now)).toBe(false);
  });
});
