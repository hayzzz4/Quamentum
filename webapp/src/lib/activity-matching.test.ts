import { describe, expect, it } from 'vitest';
import type { PlannedWorkout } from '@/db/schema';
import { matchActivity } from './activity-matching';

function workout(overrides: Partial<PlannedWorkout> = {}): PlannedWorkout {
  return {
    id: 'w1',
    userId: 'u1',
    date: new Date('2026-07-10'),
    sport: 'run',
    workoutType: 'easy',
    targetDurationMin: null,
    targetDistance: null,
    targetMetric: null,
    targetValue: null,
    notes: null,
    status: 'planned',
    source: 'user',
    supersededBy: null,
    trainingBlockId: null,
    raceEventId: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

describe('matchActivity', () => {
  it('matches a same-day, same-sport planned workout', () => {
    const candidate = workout();
    const match = matchActivity({ date: new Date('2026-07-10'), sport: 'run' }, [candidate]);
    expect(match?.id).toBe('w1');
  });

  it('does not match a different day', () => {
    const candidate = workout({ date: new Date('2026-07-11') });
    expect(matchActivity({ date: new Date('2026-07-10'), sport: 'run' }, [candidate])).toBeNull();
  });

  it('does not match a different sport', () => {
    const candidate = workout({ sport: 'ride' });
    expect(matchActivity({ date: new Date('2026-07-10'), sport: 'run' }, [candidate])).toBeNull();
  });

  it('does not match a workout that is already completed', () => {
    const candidate = workout({ status: 'completed' });
    expect(matchActivity({ date: new Date('2026-07-10'), sport: 'run' }, [candidate])).toBeNull();
  });

  it('picks the most recently created candidate when several share day and sport', () => {
    const older = workout({ id: 'older', createdAt: new Date('2026-07-01T00:00:00Z') });
    const newer = workout({ id: 'newer', createdAt: new Date('2026-07-05T00:00:00Z') });
    const match = matchActivity({ date: new Date('2026-07-10'), sport: 'run' }, [older, newer]);
    expect(match?.id).toBe('newer');
  });

  it('never matches an activity with sport="other"', () => {
    const candidate = workout();
    expect(matchActivity({ date: new Date('2026-07-10'), sport: 'other' }, [candidate])).toBeNull();
  });

  it('returns null when there are no candidates', () => {
    expect(matchActivity({ date: new Date('2026-07-10'), sport: 'run' }, [])).toBeNull();
  });
});
