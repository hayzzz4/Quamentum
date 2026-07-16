export default function OnboardingEmailPage() {
  return (
    <main>
      <h1>One more thing</h1>
      <p>Strava doesn&apos;t share your email with us — add it so we can send your daily digest.</p>
      <form action="/api/onboarding/email" method="post">
        <input type="email" name="email" required placeholder="you@example.com" />
        <button type="submit">Continue</button>
      </form>
    </main>
  );
}
