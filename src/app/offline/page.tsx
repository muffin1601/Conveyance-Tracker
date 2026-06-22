export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold">You&apos;re offline</h1>
        <p className="mt-2 text-sm text-muted max-w-sm">
          Watcon Tracker needs a connection to verify GPS punches and compute distances.
          Your last loaded route is still visible. Reconnect to sync.
        </p>
      </div>
    </main>
  );
}
