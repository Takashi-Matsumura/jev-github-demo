const LABELS: Record<string, string> = {
  feat: "feat",
  fix: "fix",
  perf: "perf",
  refactor: "refactor",
  test: "test",
  docs: "docs",
  ci: "ci",
  chore: "chore",
  revert: "revert",
  other: "other",
};

export function CategoryBadge({ category }: { category: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: `var(--cat-${category}, var(--cat-other))` }}
    >
      {LABELS[category] ?? category}
    </span>
  );
}

export function SourceBadge({ source }: { source: "rule" | "jev" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${
        source === "rule" ? "border-border text-muted" : "border-cat-refactor text-cat-refactor"
      }`}
    >
      {source === "rule" ? "ルール由来" : "Jev由来"}
    </span>
  );
}
