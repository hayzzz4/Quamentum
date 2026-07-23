import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/session';
import { parseCheckinForm, readCheckinFormValues, todayUTC, upsertCheckin } from '@/lib/checkin';

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.redirect(new URL('/sign-in', request.url), 303);
  }

  const formData = await request.formData();
  const values = readCheckinFormValues(formData);
  const input = parseCheckinForm(values);
  if (!input) {
    const errorParams = new URLSearchParams({ error: 'invalid', ...values });
    return NextResponse.redirect(new URL(`/checkin?${errorParams.toString()}`, request.url), 303);
  }

  await upsertCheckin(userId, todayUTC(), input);
  return NextResponse.redirect(new URL('/checkin?saved=1', request.url), 303);
}
