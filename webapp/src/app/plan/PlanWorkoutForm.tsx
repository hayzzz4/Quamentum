export interface PlanWorkoutFormValues {
  sport: string;
  workoutType: string;
  targetDurationMin: string;
  targetDistance: string;
  targetMetric: string;
  targetValue: string;
  notes: string;
}

const SPORT_OPTIONS = ['run', 'trail_run', 'ride', 'mtb', 'swim', 'rest'] as const;
const WORKOUT_TYPE_OPTIONS = ['easy', 'tempo', 'interval', 'long', 'recovery', 'technique', 'rest'] as const;
const TARGET_METRIC_OPTIONS = ['pace', 'power', 'hr_zone'] as const;

export function PlanWorkoutForm({
  action,
  values,
  hasError,
  cancelHref,
  submitLabel,
  dateFieldValue,
}: {
  action: string;
  values: PlanWorkoutFormValues;
  hasError: boolean;
  cancelHref: string;
  submitLabel: string;
  dateFieldValue?: string;
}) {
  return (
    <form action={action} method="post">
      {hasError && <p role="alert">Please check the required fields and try again.</p>}
      {dateFieldValue && <input type="hidden" name="date" value={dateFieldValue} />}
      <div>
        <label htmlFor="sport">Sport</label>
        <select id="sport" name="sport" defaultValue={values.sport} required>
          <option value="">Select a sport</option>
          {SPORT_OPTIONS.map((sport) => (
            <option key={sport} value={sport}>
              {sport}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="workoutType">Workout type</label>
        <select id="workoutType" name="workoutType" defaultValue={values.workoutType} required>
          <option value="">Select a type</option>
          {WORKOUT_TYPE_OPTIONS.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="targetDurationMin">Duration (minutes)</label>
        <input id="targetDurationMin" type="number" name="targetDurationMin" defaultValue={values.targetDurationMin} min="1" />
      </div>
      <div>
        <label htmlFor="targetDistance">Distance (km)</label>
        <input id="targetDistance" type="number" name="targetDistance" defaultValue={values.targetDistance} min="0" step="0.01" />
      </div>
      <div>
        <label htmlFor="targetMetric">Target metric</label>
        <select id="targetMetric" name="targetMetric" defaultValue={values.targetMetric}>
          <option value="">None</option>
          {TARGET_METRIC_OPTIONS.map((metric) => (
            <option key={metric} value={metric}>
              {metric}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="targetValue">Target value</label>
        <input id="targetValue" type="text" name="targetValue" defaultValue={values.targetValue} placeholder="e.g. 5:00/km" />
      </div>
      <div>
        <label htmlFor="notes">Notes</label>
        <textarea id="notes" name="notes" defaultValue={values.notes} />
      </div>
      <button type="submit">{submitLabel}</button> <a href={cancelHref}>Cancel</a>
    </form>
  );
}
