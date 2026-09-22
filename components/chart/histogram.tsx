import type { RectProps } from "./svg-title-attr";

export type HistogramBin = { label: string; count: number };

/** 単一系列の度数分布。凡例は不要（タイトルが系列を名乗る）。 */
export function Histogram({
  bins,
  height = 120,
  color = "var(--cat-feat)",
  emptyLabel = "データがありません",
}: {
  bins: HistogramBin[];
  height?: number;
  color?: string;
  emptyLabel?: string;
}) {
  const max = Math.max(1, ...bins.map((b) => b.count));
  if (bins.every((b) => b.count === 0)) {
    return <p className="text-sm text-muted">{emptyLabel}</p>;
  }

  const W = 1000;
  const H = height;
  const gap = 6;
  const colWidth = (W - gap * (bins.length - 1)) / bins.length;

  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img" aria-label="度数分布">
      <line x1={0} y1={H} x2={W} y2={H} stroke="var(--border)" strokeWidth={1} />
      {bins.map((b, i) => {
        const x = i * (colWidth + gap);
        const h = (b.count / max) * H;
        const rectProps: RectProps = {
          x,
          y: H - h,
          width: colWidth,
          height: Math.max(0, h),
          fill: color,
          rx: 3,
          title: `${b.label}: ${b.count} 件`,
        };
        return (
          <g key={b.label}>
            <rect {...rectProps} />
            {b.count > 0 ? (
              <text x={x + colWidth / 2} y={H - h - 6} textAnchor="middle" className="fill-muted" fontSize={11}>
                {b.count}
              </text>
            ) : null}
            <text x={x + colWidth / 2} y={H + 14} textAnchor="middle" className="fill-muted" fontSize={10}>
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
