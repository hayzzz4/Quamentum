import { describe, expect, it } from 'vitest';
import { formatDateParam, isEditableDate, mondayOf, parseDateParam, parseWorkoutForm, readWorkoutFormValues, targetFieldsValid, type WorkoutFormValues } from './plan';

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

describe('targetFieldsValid', () => {
  it('is valid when neither field is set', () => {
    expect(targetFieldsValid(null, null)).toBe(true);
  });

  it('is valid when both fields are set', () => {
    expect(targetFieldsValid('pace', '5:00/km')).toBe(true);
  });

  it('is invalid when only targetMetric is set', () => {
    expect(targetFieldsValid('pace', null)).toBe(false);
  });

  it('is invalid when only targetValue is set', () => {
    expect(targetFieldsValid(null, '5:00/km')).toBe(false);
  });
});

describe('parseWorkoutForm', () => {
  function values(overrides: Partial<WorkoutFormValues> = {}): WorkoutFormValues {
    return {
      sport: 'run',
      workoutType: 'easy',
      targetDurationMin: '',
      targetDistance: '',
      targetMetric: '',
      targetValue: '',
      notes: '',
      ...overrides,
    };
  }

  it('parses a minimal valid submission', () => {
    expect(parseWorkoutForm(values())).toEqual({
      sport: 'run',
      workoutType: 'easy',
      targetDurationMin: null,
      targetDistance: null,
      targetMetric: null,
      targetValue: null,
      notes: null,
    });
  });

  it('parses a fully populated submission', () => {
    const input = parseWorkoutForm(
      values({
        targetDurationMin: '45',
        targetDistance: '10',
        targetMetric: 'pace',
        targetValue: '5:00/km',
        notes: 'Keep it easy',
      }),
    );
    expect(input).toEqual({
      sport: 'run',
      workoutType: 'easy',
      targetDurationMin: 45,
      targetDistance: '10.00',
      targetMetric: 'pace',
      targetValue: '5:00/km',
      notes: 'Keep it easy',
    });
  });

  it('rejects an invalid sport', () => {
    expect(parseWorkoutForm(values({ sport: 'skiing' }))).toBeNull();
  });

  it('rejects a missing workout type', () => {
    expect(parseWorkoutForm(values({ workoutType: '' }))).toBeNull();
  });

  it('rejects an invalid target metric', () => {
    expect(parseWorkoutForm(values({ targetMetric: 'vibes', targetValue: 'good' }))).toBeNull();
  });

  it('rejects targetMetric set without targetValue', () => {
    expect(parseWorkoutForm(values({ targetMetric: 'pace' }))).toBeNull();
  });

  it('rejects targetValue set without targetMetric', () => {
    expect(parseWorkoutForm(values({ targetValue: '5:00/km' }))).toBeNull();
  });

  it('rejects a non-positive duration', () => {
    expect(parseWorkoutForm(values({ targetDurationMin: '0' }))).toBeNull();
  });
});

describe('readWorkoutFormValues', () => {
  it('reads every field as a string, defaulting missing fields to empty', () => {
    const formData = new FormData();
    formData.set('sport', 'run');
    formData.set('workoutType', 'easy');

    expect(readWorkoutFormValues(formData)).toEqual({
      sport: 'run',
      workoutType: 'easy',
      targetDurationMin: '',
      targetDistance: '',
      targetMetric: '',
      targetValue: '',
      notes: '',
    });
  });
});
