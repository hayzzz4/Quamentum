import { describe, expect, it } from 'vitest';
import { mapStravaSportType } from './sport-mapping';

describe('mapStravaSportType', () => {
  it.each([
    ['Run', 'run'],
    ['TrailRun', 'trail_run'],
    ['Ride', 'ride'],
    ['GravelRide', 'ride'],
    ['VirtualRide', 'ride'],
    ['MountainBikeRide', 'mtb'],
    ['EMountainBikeRide', 'mtb'],
    ['Swim', 'swim'],
  ])('maps Strava sport_type %s to %s', (input, expected) => {
    expect(mapStravaSportType(input)).toBe(expected);
  });

  it('maps unrecognized sport types to "other"', () => {
    expect(mapStravaSportType('Hike')).toBe('other');
    expect(mapStravaSportType('WeightTraining')).toBe('other');
    expect(mapStravaSportType('Yoga')).toBe('other');
  });
});
