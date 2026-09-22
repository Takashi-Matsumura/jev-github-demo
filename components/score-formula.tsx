import type { ScoreFactor } from "@/lib/score";

export function ScoreFormula({ factors, score }: { factors: ScoreFactor[]; score: number }) {
  return (
    <div className="overflow-x-auto rounded-md bg-surface p-2 font-mono text-xs">
      <span>
        {factors.map((f, i) => (
          <span key={f.name}>
            {i > 0 ? " × " : ""}
            <span title={f.note}>{f.value.toFixed(2)}</span>
          </span>
        ))}{" "}
        = <strong>{score.toFixed(2)}</strong>
      </span>
      <div className="mt-1 text-muted">{factors.map((f) => f.note).filter(Boolean).join(" · ")}</div>
    </div>
  );
}
