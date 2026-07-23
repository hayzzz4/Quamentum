import { redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/session';
import { getTodayCheckin, todayUTC } from '@/lib/checkin';

const SCALE = [1, 2, 3, 4, 5];

export default async function CheckinPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect('/sign-in');
  }

  const sp = await searchParams;
  const field = (key: string) => (typeof sp[key] === 'string' ? (sp[key] as string) : '');
  const hasError = sp.error === 'invalid';
  const saved = sp.saved === '1';

  const today = todayUTC();
  const existing = hasError ? null : await getTodayCheckin(userId, today);

  const values = {
    sleepHours: hasError ? field('sleepHours') : (existing?.sleepHours ?? ''),
    soreness: hasError ? field('soreness') : existing?.soreness != null ? String(existing.soreness) : '',
    energy: hasError ? field('energy') : existing?.energy != null ? String(existing.energy) : '',
    note: hasError ? field('note') : (existing?.note ?? ''),
  };

  return (
    <main>
      <p>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- plain anchor, no client JS by convention */}
        <a href="/">‹ Back to week</a>
      </p>
      <h1>Check in</h1>
      {saved && <p role="status">Saved.</p>}
      {hasError && <p role="alert">Please check the required fields and try again.</p>}
      <form action="/api/checkin" method="post">
        <div>
          <label htmlFor="sleepHours">Sleep (hours)</label>
          <input
            id="sleepHours"
            type="number"
            name="sleepHours"
            defaultValue={values.sleepHours}
            min="0"
            max="24"
            step="0.25"
            required
          />
        </div>
        <div>
          <span>Soreness</span>
          {SCALE.map((n) => (
            <label key={n}>
              <input type="radio" name="soreness" value={n} defaultChecked={values.soreness === String(n)} required />
              {n}
            </label>
          ))}
        </div>
        <div>
          <span>Energy</span>
          {SCALE.map((n) => (
            <label key={n}>
              <input type="radio" name="energy" value={n} defaultChecked={values.energy === String(n)} required />
              {n}
            </label>
          ))}
        </div>
        <div>
          <label htmlFor="note">Note</label>
          <textarea id="note" name="note" defaultValue={values.note} />
        </div>
        <button type="submit">Save</button>
      </form>
    </main>
  );
}
