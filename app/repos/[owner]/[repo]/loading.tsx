export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-4 px-4 py-8">
      <div className="h-8 w-96 animate-pulse rounded bg-surface" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-surface" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-surface" />
    </main>
  );
}
