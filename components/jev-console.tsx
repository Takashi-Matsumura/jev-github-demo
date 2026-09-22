"use client";

import { useState } from "react";
import { ProbabilityBar, ConfidenceMark } from "@/components/probability-bar";

type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number };

export type JevExchangeLike = {
  request: { endpoint: string; model: string; state: unknown; questions: Record<string, unknown> };
  response: { model: string; answers: Record<string, Answer>; usage: { input_tokens: number; output_tokens: number } };
  elapsedMs: number;
};

const TABS = ["質問と回答", "送信 JSON", "受信 JSON"] as const;

export function JevConsole({ exchange }: { exchange: JevExchangeLike | null }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>(TABS[0]);

  if (!exchange) {
    return <p className="text-sm text-muted">この PR は Jev による判定をまだ取得していません。</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 border-b border-border text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-2 py-1 ${tab === t ? "border-cat-feat font-medium" : "border-transparent text-muted"}`}
          >
            {t}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted">
          {exchange.response.model} · {exchange.elapsedMs}ms · 入力{exchange.response.usage.input_tokens} / 出力
          {exchange.response.usage.output_tokens} トークン
        </span>
      </div>

      {tab === "質問と回答" ? (
        <div className="space-y-3">
          {Object.entries(exchange.response.answers).map(([key, answer]) => (
            <div key={key} className="rounded-md border border-border p-2">
              <div className="mb-1 font-mono text-xs text-muted">{key}</div>
              {answer.type === "noul" ? (
                <ProbabilityBar label="P(true)" value={answer.noul} />
              ) : answer.type === "choice" ? (
                <div className="space-y-1">
                  <div className="text-sm">
                    選択: <strong>{answer.choice}</strong>
                    <ConfidenceMark confidence={answer.confidence} />
                  </div>
                  {Object.entries(answer.probabilities)
                    .sort((a, b) => b[1] - a[1])
                    .map(([choice, p]) => (
                      <ProbabilityBar key={choice} label={choice} value={p} />
                    ))}
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="text-sm">
                    スコア: <strong>{answer.score}</strong> — {answer.legend[String(answer.score)] ?? ""}
                    <ConfidenceMark confidence={answer.confidence} />
                  </div>
                  {Object.entries(answer.probabilities)
                    .sort((a, b) => Number(a[0]) - Number(b[0]))
                    .map(([level, p]) => (
                      <ProbabilityBar key={level} label={level} value={p} />
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {tab === "送信 JSON" ? (
        <pre className="max-h-96 overflow-auto rounded-md bg-surface p-3 text-xs">{JSON.stringify(exchange.request, null, 2)}</pre>
      ) : null}

      {tab === "受信 JSON" ? (
        <pre className="max-h-96 overflow-auto rounded-md bg-surface p-3 text-xs">{JSON.stringify(exchange.response, null, 2)}</pre>
      ) : null}
    </div>
  );
}
