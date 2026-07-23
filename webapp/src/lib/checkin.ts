import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { checkins, type Checkin } from '@/db/schema';

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

export function todayUTC(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function upsertCheckin(userId: string, date: Date, fields: CheckinInput): Promise<Checkin> {
  const [row] = await db
    .insert(checkins)
    .values({ userId, date, ...fields })
    .onConflictDoUpdate({
      target: [checkins.userId, checkins.date],
      set: { ...fields },
    })
    .returning();
  return row;
}

export async function getTodayCheckin(userId: string, date: Date): Promise<Checkin | null> {
  const [row] = await db
    .select()
    .from(checkins)
    .where(and(eq(checkins.userId, userId), eq(checkins.date, date)));
  return row ?? null;
}
