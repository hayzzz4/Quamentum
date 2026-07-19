import { NextRequest, NextResponse } from 'next/server';
import { getConnectedUsers } from '@/lib/users';
import { listRecentActivityIds } from '@/lib/strava-client';
import { syncActivity } from '@/lib/activity-sync';

const RECONCILE_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const users = await getConnectedUsers();
    const after = new Date(Date.now() - RECONCILE_WINDOW_MS);

    const results = await Promise.allSettled(
      users.map(async (user) => {
        const activityIds = await listRecentActivityIds(user, after);
        for (const activityId of activityIds) {
          await syncActivity(user.stravaAthleteId, activityId);
        }
      }),
    );

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`Reconciliation failed for user ${users[index].id}:`, result.reason);
      }
    });

    return NextResponse.json({ synced: users.length });
  } catch (error) {
    console.error('Reconciliation failed:', error);
    return NextResponse.json({ error: 'failed to reconcile' }, { status: 500 });
  }
}
