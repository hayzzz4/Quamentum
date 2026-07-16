import type { NewActivity } from '@/db/schema';
import { mapStravaSportType } from './sport-mapping';
import type { StravaActivity } from './strava';

function formatPaceOrPower(raw: StravaActivity, sport: NewActivity['sport']): string | null {
  if (sport === 'ride' || sport === 'mtb') {
    return raw.average_watts != null ? `${Math.round(raw.average_watts)}W` : null;
  }
  if ((sport === 'run' || sport === 'trail_run' || sport === 'swim') && raw.average_speed > 0) {
    const secondsPerKm = 1000 / raw.average_speed;
    let minutes = Math.floor(secondsPerKm / 60);
    let seconds = Math.round(secondsPerKm % 60);

    if (seconds === 60) {
      minutes += 1;
      seconds = 0;
    }

    const secondsStr = seconds.toString().padStart(2, '0');
    return `${minutes}:${secondsStr}/km`;
  }
  return null;
}

export function mapStravaActivityToRow(raw: StravaActivity, userId: string): NewActivity {
  const sport = mapStravaSportType(raw.sport_type);

  return {
    userId,
    stravaActivityId: raw.id,
    date: new Date(raw.start_date_local.slice(0, 10)),
    sport,
    duration: raw.moving_time,
    distance: (raw.distance / 1000).toFixed(2),
    avgHr: raw.average_heartrate != null ? Math.round(raw.average_heartrate) : null,
    avgPaceOrPower: formatPaceOrPower(raw, sport),
    relativeEffort: raw.suffer_score ?? null,
    rawPayload: raw,
  };
}
