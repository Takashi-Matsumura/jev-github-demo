"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-8">
      <h1 className="text-xl font-semibold text-cat-fix">エラーが発生しました</h1>
      <p className="text-sm text-muted">{error.message}</p>
      <button type="button" onClick={reset} className="rounded-md border border-border px-4 py-2 text-sm">
        再試行
      </button>
    </main>
  );
}
