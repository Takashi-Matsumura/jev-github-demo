import { STRATA_DISCLAIMER, type Strata } from "@/lib/growth";
import { formatSignalUnitValue } from "@/components/signal-table";

/** AI併走/非併走の層別比較。判定不能な指標は数値を一切出さず、理由だけを見せる。
 *  因果の否定（STRATA_DISCLAIMER）は常に表の直前に出す。 */
export function StrataCompare({ strata }: { strata: Strata[] }) {
  if (strata.length === 0) return null;
  const anyJudged = strata.some((s) => s.judged);

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">{STRATA_DISCLAIMER}</p>
      {!anyJudged ? (
        <p className="rounded-lg border border-warn-border px-3 py-2 text-sm text-warn-fg">{strata[0].note}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2">指標</th>
                <th className="px-3 py-2">AI併走</th>
                <th className="px-3 py-2">非併走</th>
                <th className="px-3 py-2">差分</th>
                <th className="px-3 py-2">根拠</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {strata.map((s) => (
                <tr key={s.key}>
                  <td className="px-3 py-2">{s.label}</td>
                  <td className="px-3 py-2 font-mono">
                    {s.judged && s.ai.value != null ? formatSignalUnitValue(s.ai.value, s.unit) : `n=${s.ai.n}`}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {s.judged && s.nonAi.value != null ? formatSignalUnitValue(s.nonAi.value, s.unit) : `n=${s.nonAi.n}`}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {s.judged && s.delta != null ? formatSignalUnitValue(Math.abs(s.delta), s.unit) : "—"}
                  </td>
                  <td className={`px-3 py-2 text-xs ${s.judged ? "text-muted" : "text-warn-fg"}`}>{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
