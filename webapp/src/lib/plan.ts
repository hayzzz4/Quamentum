const DATE_PARAM_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateParam(raw: string): Date | null {
  if (!DATE_PARAM_RE.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Guards against JS rolling an invalid calendar date (e.g. Feb 30) into the next month.
  return date.toISOString().slice(0, 10) === raw ? date : null;
}

export function formatDateParam(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUTCDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function mondayOf(date: Date): Date {
  const start = startOfUTCDay(date);
  const weekday = start.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

export function isEditableDate(date: Date, now: Date = new Date()): boolean {
  return date.getTime() >= startOfUTCDay(now).getTime();
}
