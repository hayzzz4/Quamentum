import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/session';
import { deletePlannedWorkout, formatDateParam, getOwnedPlannedWorkout, isEditableDate } from '@/lib/plan';

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

  const result = await deletePlannedWorkout(userId, id);
  if (result === 'not_deletable') {
    return NextResponse.json({ error: 'workout already completed' }, { status: 400 });
  }
  if (result === 'not_found') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  return NextResponse.redirect(new URL(`/plan/${formatDateParam(existing.date)}`, request.url), 303);
}
