import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/session';
import {
  formatDateParam,
  getOwnedPlannedWorkout,
  isEditableDate,
  parseWorkoutForm,
  readWorkoutFormValues,
  updatePlannedWorkout,
} from '@/lib/plan';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.redirect(new URL('/sign-in', request.url), 303);
  }

  const { id } = await params;
  const existing = await getOwnedPlannedWorkout(userId, id);
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (!isEditableDate(existing.date)) {
    return NextResponse.json({ error: 'past date' }, { status: 400 });
  }
  if (existing.status === 'completed') {
    return NextResponse.json({ error: 'not editable' }, { status: 400 });
  }

  const dateParam = formatDateParam(existing.date);
  const formData = await request.formData();
  const values = readWorkoutFormValues(formData);
  const input = parseWorkoutForm(values);
  if (!input) {
    const errorParams = new URLSearchParams({ error: 'invalid', ...values });
    return NextResponse.redirect(
      new URL(`/plan/${dateParam}/${id}/edit?${errorParams.toString()}`, request.url),
      303,
    );
  }

  const updated = await updatePlannedWorkout(userId, id, input);
  if (!updated) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  return NextResponse.redirect(new URL(`/plan/${dateParam}`, request.url), 303);
}
