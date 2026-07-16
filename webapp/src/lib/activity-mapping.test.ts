import { describe, expect, it } from 'vitest';
import type { StravaActivity } from './strava';
import { mapStravaActivityToRow } from './activity-mapping';

function baseActivity(overrides: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: 42,
    sport_type: 'Run',
    start_date_local: '2026-07-10T06:15:00Z',
    moving_time: 1800,
    distance: 5000,
    average_speed: 2.7778, // 5000m / 1800s
    ...overrides,
  };
}

describe('mapStravaActivityToRow', () => {
  it('maps common fields and the activity date from start_date_local', () => {
    const row = mapStravaActivityToRow(baseActivity(), 'user-1');

    expect(row.userId).toBe('user-1');
    expect(row.stravaActivityId).toBe(42);
    expect(row.date).toEqual(new Date('2026-07-10'));
    expect(row.sport).toBe('run');
    expect(row.duration).toBe(1800);
    expect(row.distance).toBe('5.00');
    expect(row.rawPayload).toEqual(baseActivity());
  });

  it('rounds average heart rate when present, null when absent', () => {
    expect(mapStravaActivityToRow(baseActivity({ average_heartrate: 152.6 }), 'user-1').avgHr).toBe(153);
    expect(mapStravaActivityToRow(baseActivity(), 'user-1').avgHr).toBeNull();
  });

  it('formats pace as min:sec/km for run/trail_run/swim', () => {
    const row = mapStravaActivityToRow(baseActivity({ average_speed: 2.7778 }), 'user-1');
    expect(row.avgPaceOrPower).toBe('6:00/km');
  });

  it('carries a rounded-to-60 seconds value into the next minute', () => {
    const row = mapStravaActivityToRow(baseActivity({ average_speed: 8.3682008 }), 'user-1');
    expect(row.avgPaceOrPower).toBe('2:00/km');
  });

  it('formats power in watts for ride/mtb', () => {
    const row = mapStravaActivityToRow(
      baseActivity({ sport_type: 'Ride', average_watts: 187.4 }),
      'user-1',
    );
    expect(row.avgPaceOrPower).toBe('187W');
  });

  it('leaves avgPaceOrPower null for unmapped ("other") sports', () => {
    const row = mapStravaActivityToRow(baseActivity({ sport_type: 'WeightTraining' }), 'user-1');
    expect(row.sport).toBe('other');
    expect(row.avgPaceOrPower).toBeNull();
  });

  it('uses relative effort (suffer_score) when present', () => {
    expect(mapStravaActivityToRow(baseActivity({ suffer_score: 87 }), 'user-1').relativeEffort).toBe(87);
    expect(mapStravaActivityToRow(baseActivity(), 'user-1').relativeEffort).toBeNull();
  });
});
