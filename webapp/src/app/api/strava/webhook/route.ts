import { NextRequest, NextResponse } from 'next/server';
import { syncActivity } from '@/lib/activity-sync';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && challenge && token === process.env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
    return NextResponse.json({ 'hub.challenge': challenge });
  }
  return NextResponse.json({ error: 'invalid verify token' }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const payload = await request.json();

  if (payload.object_type === 'activity' && payload.aspect_type === 'create') {
    try {
      await syncActivity(payload.owner_id, payload.object_id);
    } catch (error) {
      console.error('Strava webhook activity sync failed:', error);
    }
  }

  return NextResponse.json({}, { status: 200 });
}
