import { ChartLegend, type LegendItem } from "./legend";
import type { RectProps } from "./svg-title-attr";

export type ColumnSegment = { key: string; value: number; color: string };
export type ColumnDatum = { label: string; segments: ColumnSegment[] };

/**
 * 積み上げ縦棒。サーバーコンポーネント・インライン SVG・依存ゼロ。
 * ホバーは title 属性によるブラウザネイティブのツールチップ。
 * （子要素の <title> は React のサーバーレンダラが HTML の document title と
 *   誤認して SSR 出力時に中身を空にしてしまう — ハイドレーション不一致の原因になるため使わない）
 */
export function ColumnChart({
  data,
  legend,
  height = 140,
  formatValue = (n: number) => String(Math.round(n)),
  emptyLabel = "データがありません",
}: {
  data: ColumnDatum[];
  legend?: LegendItem[];
  height?: number;
  formatValue?: (n: number) => string;
  emptyLabel?: string;
}) {
  const totals = data.map((d) => d.segments.reduce((s, seg) => s + seg.value, 0));
  const maxTotal = Math.max(1, ...totals);

  if (data.length === 0 || maxTotal === 0) {
    return <p className="text-sm text-muted">{emptyLabel}</p>;
  }

  const W = 1000;
  const H = height;
  const gap = 4; // 隣接カラム間のギャップ（サーフェス色の2pxスペーサーに相当する単位）
  const colWidth = (W - gap * (data.length - 1)) / data.length;
  const barWidth = Math.min(28, colWidth * 0.7);

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full" role="img" aria-label="週次の活動推移">
        <line x1={0} y1={H} x2={W} y2={H} stroke="var(--border)" strokeWidth={1} />
        {data.map((d, i) => {
          const cx = i * (colWidth + gap) + colWidth / 2;
          const total = totals[i];
          let yCursor = H;
          return (
            <g key={d.label}>
              {d.segments.map((seg, segIdx) => {
                if (seg.value <= 0) return null;
                const segH = (seg.value / maxTotal) * H;
                const y = yCursor - segH;
                yCursor = y - 2; // セグメント間の2pxサーフェスギャップ
                const isTop = segIdx === d.segments.filter((s) => s.value > 0).length - 1;
                const rectProps: RectProps = {
                  x: cx - barWidth / 2,
                  y,
                  width: barWidth,
                  height: Math.max(0, segH),
                  fill: seg.color,
                  rx: isTop ? 3 : 0,
                  title: `${d.label} · ${seg.key}: ${formatValue(seg.value)}`,
                };
                return <rect key={seg.key} {...rectProps} />;
              })}
              {total > 0 ? (
                <text x={cx} y={H - (total / maxTotal) * H - 6} textAnchor="middle" className="fill-muted" fontSize={11}>
                  {formatValue(total)}
                </text>
              ) : null}
              <text x={cx} y={H + 16} textAnchor="middle" className="fill-muted" fontSize={11}>
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {legend ? <ChartLegend items={legend} /> : null}
    </div>
  );
}
