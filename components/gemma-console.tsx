"use client";

import { useState } from "react";

export type GemmaExchangeLike = {
  request: {
    endpoint: string;
    model: string;
    state: unknown;
    messages: { role: string; content: string }[];
    schema: unknown;
    params: { temperature: number; max_tokens: number; enable_thinking: boolean };
  };
  response: {
    model: string;
    parsed: unknown;
    raw: string;
    finishReason: string;
    usage: { prompt_tokens: number; completion_tokens: number };
  };
  elapsedMs: number;
};

const TABS = ["助言（生JSON）", "送信プロンプト", "受信 JSON"] as const;

/** components/jev-console.tsx と同じ構造。送った内容・返ってきた内容をそのまま開示する。 */
export function GemmaConsole({ exchange }: { exchange: GemmaExchangeLike | null }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>(TABS[0]);

  if (!exchange) {
    return <p className="text-sm text-muted">まだローカル LLM による生成を行っていません。</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 border-b border-border text-sm">
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
          {exchange.response.model} · {exchange.elapsedMs}ms · 入力{exchange.response.usage.prompt_tokens} / 出力
          {exchange.response.usage.completion_tokens} トークン · finish_reason={exchange.response.finishReason}
        </span>
      </div>

      {tab === "助言（生JSON）" ? (
        <pre className="max-h-96 overflow-auto rounded-md bg-surface p-3 text-xs">{JSON.stringify(exchange.response.parsed, null, 2)}</pre>
      ) : null}

      {tab === "送信プロンプト" ? (
        <div className="space-y-2">
          {exchange.request.messages.map((m, i) => (
            <div key={i} className="rounded-md border border-border p-2">
              <div className="mb-1 font-mono text-xs text-muted">{m.role}</div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{m.content}</pre>
            </div>
          ))}
        </div>
      ) : null}

      {tab === "受信 JSON" ? (
        <pre className="max-h-96 overflow-auto rounded-md bg-surface p-3 text-xs">{JSON.stringify(exchange.response, null, 2)}</pre>
      ) : null}
    </div>
  );
}
