"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { streamNdjson } from "@/components/ndjson-stream";

type LogLine = { text: string; kind: "info" | "warn" | "error" | "done" };
type AdviceScope = "dev" | "pr" | "repo";

export function AdviceButton({ owner, repo, scope, subject }: { owner: string; repo: string; scope: AdviceScope; subject: string }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [dryRunPreview, setDryRunPreview] = useState<{ messages: unknown; schema: unknown; promptChars: number } | null>(null);

  const pushLog = useCallback((text: string, kind: LogLine["kind"] = "info") => {
    setLogs((prev) => [...prev.slice(-49), { text, kind }]);
  }, []);

  const run = useCallback(
    async (opts: { dryRun?: boolean; force?: boolean }) => {
      setRunning(true);
      setElapsedMs(null);
      setLogs([]);
      if (opts.dryRun) setDryRunPreview(null);
      let generated = 0;
      try {
        await streamNdjson("/api/advise", { owner, repo, scope, subject, ...opts }, (obj) => {
          if (obj.kind === "signals") {
            pushLog("観測事実を計算しました（LLM は未使用）", "info");
          } else if (obj.kind === "plan") {
            pushLog(String(obj.reason), "info");
          } else if (obj.kind === "dry_run") {
            setDryRunPreview({ messages: obj.messages, schema: obj.schema, promptChars: Number(obj.promptChars) });
            pushLog(`送信予定のプロンプト長: ${obj.promptChars} 文字（Gemma は呼んでいません）`, "info");
          } else if (obj.kind === "waiting") {
            setElapsedMs(Number(obj.elapsedMs));
          } else if (obj.kind === "advice") {
            const themeIds = Array.isArray(obj.themeIds) ? (obj.themeIds as string[]) : [];
            pushLog(
              `生成完了（${obj.elapsedMs}ms）${themeIds.length > 0 ? ` テーマ: ${themeIds.join(", ")}` : ""}${
                obj.needsReview ? " ⚠要確認" : ""
              }`,
              "done",
            );
            generated += 1;
          } else if (obj.kind === "error") {
            pushLog(`エラー${obj.errorKind ? `（${obj.errorKind}）` : ""}: ${obj.message}`, "error");
          } else if (obj.kind === "done") {
            if (obj.skipped && !obj.generated) pushLog("前回から変わっていないためスキップしました", "info");
          }
        });
      } catch (e) {
        pushLog(`失敗しました: ${e instanceof Error ? e.message : "不明なエラー"}`, "error");
      } finally {
        setRunning(false);
        if (generated > 0) router.refresh();
      }
    },
    [owner, repo, scope, subject, router, pushLog],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => run({})}
          disabled={running}
          className="rounded-md bg-cat-refactor px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {running ? "生成中…" : "助言を生成する（ローカル LLM を呼びます・数十秒かかります）"}
        </button>
        <button
          type="button"
          onClick={() => run({ dryRun: true })}
          disabled={running}
          className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
        >
          送信内容を確認だけする（dryRun）
        </button>
        <button
          type="button"
          onClick={() => run({ force: true })}
          disabled={running}
          className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
        >
          作り直す（force）
        </button>
        {running && elapsedMs != null ? <span className="text-xs text-muted">生成中… {Math.round(elapsedMs / 1000)}秒経過</span> : null}
      </div>

      {logs.length > 0 ? (
        <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-surface p-3 font-mono text-xs">
          {logs.map((l, i) => (
            <div
              key={i}
              className={l.kind === "error" ? "text-cat-fix" : l.kind === "warn" ? "text-warn-fg" : l.kind === "done" ? "text-cat-test" : ""}
            >
              {l.text}
            </div>
          ))}
        </div>
      ) : null}

      {dryRunPreview ? (
        <details className="rounded-md border border-border p-2 text-xs">
          <summary className="cursor-pointer">送信予定のプロンプト（プレビュー・未送信・{dryRunPreview.promptChars}文字）</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(dryRunPreview.messages, null, 1)}</pre>
        </details>
      ) : null}
    </div>
  );
}
