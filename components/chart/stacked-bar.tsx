import { ChartLegend, type LegendItem } from "./legend";

export type StackedBarSegment = { key: string; label: string; value: number; color: string };

/** 部分-全体（part-to-whole）を示す横積み上げバー。2px のサーフェスギャップで区切る。 */
export function StackedBar({ segments, legend }: { segments: StackedBarSegment[]; legend?: LegendItem[] }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return <p className="text-sm text-muted">データがありません</p>;

  return (
    <div className="space-y-2">
      <div className="flex h-4 w-full gap-0.5 overflow-hidden rounded-full border border-border">
        {segments
          .filter((seg) => seg.value > 0)
          .map((seg) => (
            <div key={seg.key} style={{ width: `${(seg.value / total) * 100}%`, backgroundColor: seg.color }} title={`${seg.label}: ${seg.value}`} />
          ))}
      </div>
      {legend ? <ChartLegend items={legend} /> : null}
    </div>
  );
}
