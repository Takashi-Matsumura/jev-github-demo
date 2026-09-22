export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-8">
      <div className="h-8 w-64 animate-pulse rounded bg-surface" />
      <div className="h-40 animate-pulse rounded-lg bg-surface" />
      <div className="h-24 animate-pulse rounded-lg bg-surface" />
    </main>
  );
}
