import { describe, expect, it } from 'vitest';
import { parseCheckinForm, readCheckinFormValues, type CheckinFormValues } from './checkin';

describe('parseCheckinForm', () => {
  function values(overrides: Partial<CheckinFormValues> = {}): CheckinFormValues {
    return {
      sleepHours: '7.5',
      soreness: '3',
      energy: '3',
      note: '',
      ...overrides,
    };
  }

  it('parses a fully valid submission', () => {
    expect(parseCheckinForm(values())).toEqual({
      sleepHours: '7.50',
      soreness: 3,
      energy: 3,
      note: null,
    });
  });

  it('rejects a missing sleepHours', () => {
    expect(parseCheckinForm(values({ sleepHours: '' }))).toBeNull();
  });

  it('rejects a negative sleepHours', () => {
    expect(parseCheckinForm(values({ sleepHours: '-1' }))).toBeNull();
  });

  it('rejects sleepHours above 24', () => {
    expect(parseCheckinForm(values({ sleepHours: '25' }))).toBeNull();
  });

  it('rejects a missing soreness', () => {
    expect(parseCheckinForm(values({ soreness: '' }))).toBeNull();
  });

  it('rejects soreness below the 1-5 range', () => {
    expect(parseCheckinForm(values({ soreness: '0' }))).toBeNull();
  });

  it('rejects soreness above the 1-5 range', () => {
    expect(parseCheckinForm(values({ soreness: '6' }))).toBeNull();
  });

  it('accepts soreness at the boundary values 1 and 5', () => {
    expect(parseCheckinForm(values({ soreness: '1' }))?.soreness).toBe(1);
    expect(parseCheckinForm(values({ soreness: '5' }))?.soreness).toBe(5);
  });

  it('rejects a missing energy', () => {
    expect(parseCheckinForm(values({ energy: '' }))).toBeNull();
  });

  it('rejects energy below the 1-5 range', () => {
    expect(parseCheckinForm(values({ energy: '0' }))).toBeNull();
  });

  it('rejects energy above the 1-5 range', () => {
    expect(parseCheckinForm(values({ energy: '6' }))).toBeNull();
  });

  it('accepts energy at the boundary values 1 and 5', () => {
    expect(parseCheckinForm(values({ energy: '1' }))?.energy).toBe(1);
    expect(parseCheckinForm(values({ energy: '5' }))?.energy).toBe(5);
  });

  it('trims a whitespace-only note to null', () => {
    expect(parseCheckinForm(values({ note: '   ' }))?.note).toBeNull();
  });

  it('keeps a non-empty note', () => {
    expect(parseCheckinForm(values({ note: 'Felt great' }))?.note).toBe('Felt great');
  });
});

describe('readCheckinFormValues', () => {
  it('reads every field as a string, defaulting missing fields to empty', () => {
    const formData = new FormData();
    formData.set('sleepHours', '7.5');
    formData.set('soreness', '3');

    expect(readCheckinFormValues(formData)).toEqual({
      sleepHours: '7.5',
      soreness: '3',
      energy: '',
      note: '',
    });
  });
});
