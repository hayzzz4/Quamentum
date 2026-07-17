import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { getCurrentUserId } from '@/lib/session';

export default async function HomePage() {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect('/sign-in');
  }

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    redirect('/sign-in');
  }

  return (
    <main>
      {user.connectionStatus === 'disconnected' && (
        <p role="alert">
          Your Strava connection needs to be renewed — activities won&apos;t sync until you{' '}
          <a href="/api/auth/login">reconnect</a>.
        </p>
      )}
      <h1>Welcome, {user.name}</h1>
      <form action="/api/auth/logout" method="post">
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
