/** 単一比率のメーター。トラックは同じ色相の淡色ステップ（同一ランプ）にする。 */
export function Meter({
  ratio,
  label,
  color = "var(--ai)",
  trackColor,
}: {
  ratio: number;
  label?: string;
  color?: string;
  trackColor?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  return (
    <div className="space-y-1">
      {label ? (
        <div className="flex items-baseline justify-between text-sm">
          <span>{label}</span>
          <span className="font-mono">{pct}%</span>
        </div>
      ) : null}
      <div
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: trackColor ?? "color-mix(in oklab, var(--ai) 18%, var(--surface))" }}
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}
