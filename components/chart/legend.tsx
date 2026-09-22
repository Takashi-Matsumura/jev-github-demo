export type LegendItem = { key: string; label: string; color: string };

/** 2系列以上のチャートに常設する凡例。1系列のチャートには使わない（タイトルが名乗り済みのため）。 */
export function ChartLegend({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      {items.map((it) => (
        <span key={it.key} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
