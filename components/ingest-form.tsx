"use client";

import { useState, useCallback } from "react";
import Link from "next/link";

type LogLine = { text: string; kind: "info" | "warn" | "error" | "done" };

async function streamNdjson(url: string, body: unknown, onLine: (obj: Record<string, unknown>) => void): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      onLine(JSON.parse(line) as Record<string, unknown>);
    }
  }
  if (buffer.trim()) onLine(JSON.parse(buffer) as Record<string, unknown>);
}

export function IngestForm({ defaultOwner, defaultRepo }: { defaultOwner: string; defaultRepo: string }) {
  const [owner, setOwner] = useState(defaultOwner);
  const [repo, setRepo] = useState(defaultRepo);
  const [limit, setLimit] = useState(20);
  const [ingesting, setIngesting] = useState(false);
  const [ingested, setIngested] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [dryRunPreview, setDryRunPreview] = useState<Record<string, unknown>[] | null>(null);

  const pushLog = useCallback((text: string, kind: LogLine["kind"] = "info") => {
    setLogs((prev) => [...prev.slice(-49), { text, kind }]);
  }, []);

  const runIngest = useCallback(async () => {
    setIngesting(true);
    setIngested(false);
    setLogs([]);
    try {
      await streamNdjson("/api/ingest", { owner, repo, limit }, (obj) => {
        if (obj.kind === "pr") pushLog(`#${obj.number} ${obj.title}`, "info");
        else if (obj.kind === "warn") pushLog(String(obj.message), "warn");
        else if (obj.kind === "rate") pushLog(`レート残量 ${obj.remaining}（${obj.transport}）`, "info");
        else if (obj.kind === "done") {
          pushLog(`取り込み完了: ${obj.count} 件`, "done");
          setIngested(true);
        } else if (obj.kind === "error") pushLog(`エラー: ${obj.message}`, "error");
      });
    } catch (e) {
      pushLog(`取り込みに失敗しました: ${e instanceof Error ? e.message : "不明なエラー"}`, "error");
    } finally {
      setIngesting(false);
    }
  }, [owner, repo, limit, pushLog]);

  const runClassify = useCallback(
    async (dryRun: boolean) => {
      setClassifying(true);
      setDryRunPreview(dryRun ? [] : null);
      if (!dryRun) setLogs([]);
      try {
        await streamNdjson("/api/classify", { owner, repo, limit, dryRun }, (obj) => {
          if (obj.kind === "plan") {
            pushLog(`対象 ${obj.total} 件中 ${obj.toClassify} 件を処理します（${obj.skipped} 件は既に分類済み）`, "info");
          } else if (obj.kind === "dry_run") {
            setDryRunPreview((prev) => [...(prev ?? []), obj]);
            pushLog(`[dryRun] #${obj.number} ${obj.title}`, "info");
          } else if (obj.kind === "pr") {
            pushLog(`#${obj.number} → ${obj.category}（${obj.categorySource}）${obj.needsReview ? " ⚠要確認" : ""}`, "info");
          } else if (obj.kind === "pr_error") {
            pushLog(`#${obj.number}: ${obj.message}`, "error");
          } else if (obj.kind === "done") {
            if (dryRun) pushLog("dryRun 完了（Jev は呼んでいません）", "done");
            else pushLog(`分類完了: ${obj.classified} 件（入力 ${obj.inputTokens} / 出力 ${obj.outputTokens} トークン）`, "done");
          } else if (obj.kind === "error") {
            pushLog(`エラー: ${obj.message}`, "error");
          }
        });
      } catch (e) {
        pushLog(`分類に失敗しました: ${e instanceof Error ? e.message : "不明なエラー"}`, "error");
      } finally {
        setClassifying(false);
      }
    },
    [owner, repo, limit, pushLog],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <label className="block text-sm">
          <span className="mb-1 block text-muted">owner</span>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">repo</span>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">取得件数</span>
          <select
            className="w-full rounded-md border border-border bg-background px-3 py-2"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            {[5, 10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                最新 {n} 件
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={runIngest}
          disabled={ingesting || !owner || !repo}
          className="rounded-md bg-cat-feat px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {ingesting ? "取り込み中…" : "取り込む"}
        </button>
        <button
          type="button"
          onClick={() => runClassify(true)}
          disabled={classifying || !owner || !repo}
          className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
        >
          送信内容を確認だけする（dryRun）
        </button>
        <button
          type="button"
          onClick={() => runClassify(false)}
          disabled={classifying || !owner || !repo}
          className="rounded-md bg-cat-refactor px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {classifying ? "分類中…" : "分類する（Jev を呼びます）"}
        </button>
        {ingested ? (
          <Link href={`/repos/${owner}/${repo}`} className="ml-auto text-sm text-cat-feat underline">
            ダッシュボードへ →
          </Link>
        ) : null}
      </div>

      {logs.length > 0 ? (
        <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-surface p-3 font-mono text-xs">
          {logs.map((l, i) => (
            <div
              key={i}
              className={
                l.kind === "error" ? "text-cat-fix" : l.kind === "warn" ? "text-warn-fg" : l.kind === "done" ? "text-cat-test" : ""
              }
            >
              {l.text}
            </div>
          ))}
        </div>
      ) : null}

      {dryRunPreview && dryRunPreview.length > 0 ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm font-medium">送信予定の内容（プレビュー・未送信）</p>
          {dryRunPreview.map((p, i) => (
            <details key={i} className="rounded border border-border p-2 text-xs">
              <summary className="cursor-pointer">
                #{String(p.number)} {String(p.title)}
              </summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(p.state, null, 1)}</pre>
            </details>
          ))}
        </div>
      ) : null}
    </div>
  );
}
