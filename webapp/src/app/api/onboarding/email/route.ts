import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { getCurrentUserId } from '@/lib/session';

export async function POST(request: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.redirect(new URL('/sign-in', request.url), 303);
  }

  const formData = await request.formData();
  const email = String(formData.get('email') ?? '').trim();
  if (!email || !email.includes('@')) {
    return NextResponse.redirect(new URL('/onboarding/email?error=invalid_email', request.url), 303);
  }

  await db.update(users).set({ email, updatedAt: new Date() }).where(eq(users.id, userId));
  return NextResponse.redirect(new URL('/', request.url), 303);
}
