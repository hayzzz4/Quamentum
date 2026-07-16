import type { ActivitySport } from '@/db/schema';

const SPORT_TYPE_MAP: Record<string, ActivitySport> = {
  Run: 'run',
  TrailRun: 'trail_run',
  Ride: 'ride',
  GravelRide: 'ride',
  VirtualRide: 'ride',
  MountainBikeRide: 'mtb',
  EMountainBikeRide: 'mtb',
  Swim: 'swim',
};

export function mapStravaSportType(sportType: string): ActivitySport {
  return SPORT_TYPE_MAP[sportType] ?? 'other';
}
