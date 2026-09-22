import type { Signal, Trend } from "@/lib/growth";
import { formatHours } from "@/lib/analytics";
import { formatInt } from "@/lib/format";

/** Signal.unit に応じた表示整形。lib/growth.ts と components/strata-compare.tsx の両方から使う。 */
export function formatSignalUnitValue(value: number, unit: Signal["unit"]): string {
  switch (unit) {
    case "rate":
      return `${Math.round(value * 100)}%`;
    case "level":
      return value.toFixed(2);
    case "loc":
      return `${Math.round(value)}行`;
    case "hours":
      return formatHours(value);
    case "count":
      return formatInt(Math.round(value));
  }
}

/** 観測事実（Signal[]）を「指標 / 値 / 根拠」の表にする。judged が false の行は
 *  値の代わりに「判定不能」を出し、根拠列を警告色にする。 */
export function SignalTable({ signals }: { signals: Signal[] }) {
  if (signals.length === 0) return <p className="text-sm text-muted">データがありません</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface text-left text-xs text-muted">
          <tr>
            <th className="px-3 py-2">指標</th>
            <th className="px-3 py-2">値</th>
            <th className="px-3 py-2">根拠</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {signals.map((s) => (
            <tr key={s.key}>
              <td className="px-3 py-2">{s.label}</td>
              <td className="px-3 py-2 font-mono">{s.judged && s.value != null ? formatSignalUnitValue(s.value, s.unit) : "判定不能"}</td>
              <td className={`px-3 py-2 text-xs ${s.judged ? "text-muted" : "text-warn-fg"}`}>{s.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatTrendValue(key: string, value: number): string {
  if (key === "size") return `${Math.round(value)}行`;
  if (key === "tests_by_path") return `${Math.round(value * 100)}%`;
  return value.toFixed(2);
}

function formatTrendDelta(key: string, delta: number): string {
  const sign = delta >= 0 ? "+" : "";
  if (key === "size") return `${sign}${Math.round(delta)}行`;
  if (key === "tests_by_path") return `${sign}${Math.round(delta * 100)}pt`;
  return `${sign}${delta.toFixed(2)}`;
}

/** 前半 → 直近の推移。「伸びている/停滞している」とは書かず、数値の推移だけを出す。 */
export function TrendTable({ trends }: { trends: Trend[] }) {
  if (trends.length === 0) return <p className="text-sm text-muted">データがありません</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface text-left text-xs text-muted">
          <tr>
            <th className="px-3 py-2">指標</th>
            <th className="px-3 py-2">前半</th>
            <th className="px-3 py-2">直近</th>
            <th className="px-3 py-2">差分</th>
            <th className="px-3 py-2">根拠</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {trends.map((t) => (
            <tr key={t.key}>
              <td className="px-3 py-2">{t.label}</td>
              <td className="px-3 py-2 font-mono">{t.judged && t.early != null ? formatTrendValue(t.key, t.early) : "—"}</td>
              <td className="px-3 py-2 font-mono">{t.judged && t.recent != null ? formatTrendValue(t.key, t.recent) : "—"}</td>
              <td className="px-3 py-2 font-mono">{t.judged && t.delta != null ? formatTrendDelta(t.key, t.delta) : "—"}</td>
              <td className={`px-3 py-2 text-xs ${t.judged ? "text-muted" : "text-warn-fg"}`}>{t.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
