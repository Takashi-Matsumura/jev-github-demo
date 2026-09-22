import type { RectProps } from "./svg-title-attr";

/**
 * レビュー相互作用などの行×列ヒートマップ。sequential は1色相のアルファ合成で表現する
 * （0件のセルはサーフェス色そのものになるため、明側のコントラスト不足を気にせず済む）。
 * セル間の2pxギャップがグリッド構造を示すので、0件セルも境界だけは見える。
 * ホバーは title 属性（子要素の <title> は SSR で空になる — column-chart.tsx 参照）。
 */
export function Heatmap({
  rows,
  cols,
  value,
  hue = "var(--cat-feat)",
  cellSize = 34,
}: {
  rows: string[];
  cols: string[];
  value: (row: string, col: string) => number;
  hue?: string;
  cellSize?: number;
}) {
  if (rows.length === 0 || cols.length === 0) {
    return <p className="text-sm text-muted">データがありません</p>;
  }

  const max = Math.max(1, ...rows.flatMap((r) => cols.map((c) => value(r, c))));
  const labelColWidth = 96;
  const gap = 2;
  const W = labelColWidth + cols.length * (cellSize + gap);
  const H = 20 + rows.length * (cellSize + gap);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="レビュー相互作用マトリクス">
        {cols.map((c, ci) => (
          <text
            key={c}
            x={labelColWidth + ci * (cellSize + gap) + cellSize / 2}
            y={12}
            textAnchor="middle"
            className="fill-muted"
            fontSize={10}
          >
            {c.length > 10 ? c.slice(0, 9) + "…" : c}
          </text>
        ))}
        {rows.map((r, ri) => (
          <g key={r}>
            <text x={0} y={20 + ri * (cellSize + gap) + cellSize / 2 + 4} className="fill-muted" fontSize={11}>
              {r.length > 12 ? r.slice(0, 11) + "…" : r}
            </text>
            {cols.map((c, ci) => {
              const v = value(r, c);
              const alpha = v === 0 ? 0 : 0.15 + 0.75 * (v / max);
              const rectProps: RectProps = {
                x: labelColWidth + ci * (cellSize + gap),
                y: 20 + ri * (cellSize + gap),
                width: cellSize,
                height: cellSize,
                rx: 4,
                fill: v === 0 ? "var(--surface)" : hue,
                fillOpacity: v === 0 ? 1 : alpha,
                title: `${r} → ${c}: ${v} 件`,
              };
              return <rect key={c} {...rectProps} />;
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}
