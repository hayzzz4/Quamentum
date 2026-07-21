import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/session';
import {
  createPlannedWorkout,
  isEditableDate,
  parseDateParam,
  parseWorkoutForm,
  readWorkoutFormValues,
} from '@/lib/plan';

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.redirect(new URL('/sign-in', request.url), 303);
  }

  const formData = await request.formData();
  const dateParam = String(formData.get('date') ?? '');
  const date = parseDateParam(dateParam);
  if (!date || !isEditableDate(date)) {
    return NextResponse.json({ error: 'invalid date' }, { status: 400 });
  }

  const values = readWorkoutFormValues(formData);
  const input = parseWorkoutForm(values);
  if (!input) {
    const errorParams = new URLSearchParams({ error: 'invalid', ...values });
    return NextResponse.redirect(new URL(`/plan/${dateParam}/new?${errorParams.toString()}`, request.url), 303);
  }

  await createPlannedWorkout(userId, date, input);
  return NextResponse.redirect(new URL(`/plan/${dateParam}`, request.url), 303);
}
