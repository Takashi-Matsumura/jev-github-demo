export function ProbabilityBar({
  label,
  value,
  max = 1,
  sublabel,
}: {
  label: string;
  value: number;
  max?: number;
  sublabel?: string;
}) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="font-mono text-muted">{value.toFixed(2)}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface">
        <div className="h-full rounded-full bg-cat-feat" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      {sublabel ? <div className="text-xs text-muted">{sublabel}</div> : null}
    </div>
  );
}

export function ConfidenceMark({ confidence, threshold = 0.5 }: { confidence: number | null; threshold?: number }) {
  if (confidence == null) return null;
  const low = confidence < threshold;
  return (
    <span className={`ml-1 font-mono text-xs ${low ? "text-warn-fg" : "text-muted"}`}>
      確信 {confidence.toFixed(2)}
      {low ? " ⚠ 要確認" : ""}
    </span>
  );
}
