export interface CheckinFormValues {
  sleepHours: string;
  soreness: string;
  energy: string;
  note: string;
}

export interface CheckinInput {
  sleepHours: string;
  soreness: number;
  energy: number;
  note: string | null;
}

export function readCheckinFormValues(formData: FormData): CheckinFormValues {
  return {
    sleepHours: String(formData.get('sleepHours') ?? ''),
    soreness: String(formData.get('soreness') ?? ''),
    energy: String(formData.get('energy') ?? ''),
    note: String(formData.get('note') ?? ''),
  };
}

export function parseCheckinForm(values: CheckinFormValues): CheckinInput | null {
  const sleepHours = Number(values.sleepHours);
  if (!values.sleepHours.trim() || !Number.isFinite(sleepHours) || sleepHours < 0 || sleepHours > 24) return null;

  const soreness = Number(values.soreness);
  if (!Number.isInteger(soreness) || soreness < 1 || soreness > 5) return null;

  const energy = Number(values.energy);
  if (!Number.isInteger(energy) || energy < 1 || energy > 5) return null;

  return {
    sleepHours: sleepHours.toFixed(2),
    soreness,
    energy,
    note: values.note.trim() || null,
  };
}
