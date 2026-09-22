import { fetchPullRequests, githubTransport, GithubError, type ProgressEvent } from "@/lib/github";
import { upsertRepo, upsertPullRequest, touchIngest } from "@/lib/queries";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/same-origin";

const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

type IngestBody = {
  owner?: string;
  repo?: string;
  limit?: number;
};

function parseLimit(raw: unknown, fallback: number): number {
  const num = typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
  return Math.min(Math.max(Math.trunc(num), 1), 500);
}

export async function POST(request: Request) {
  const originRejection = rejectCrossOrigin(request);
  if (originRejection) return originRejection;

  let body: IngestBody;
  try {
    body = (await request.json()) as IngestBody;
  } catch {
    return Response.json({ error: "リクエストボディが JSON ではありません" }, { status: 400 });
  }

  const owner = body.owner?.trim() ?? "";
  const repo = body.repo?.trim() ?? "";
  const limit = parseLimit(body.limit, 20);

  if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) {
    return Response.json({ error: "owner / repo の形式が不正です" }, { status: 400 });
  }

  const transport = githubTransport();
  const db = getDb();
  const repoRow = upsertRepo(owner, repo);

  const runInsert = db
    .prepare(
      `INSERT INTO ingest_runs (repo_id, kind, transport, started_at, status)
       VALUES (:repo_id, 'github', :transport, :started_at, 'running')`,
    )
    .run({ repo_id: repoRow.id, transport, started_at: new Date().toISOString() });
  const runId = Number(runInsert.lastInsertRowid);

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ProgressEvent | { kind: "done"; count: number } | { kind: "error"; message: string }) => {
        controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      };

      let count = 0;
      let rateRemaining: number | null = null;
      try {
        for await (const pr of fetchPullRequests({
          owner,
          repo,
          limit,
          signal: abortController.signal,
          onProgress: (e) => {
            if (e.kind === "rate") rateRemaining = e.remaining;
            send(e);
          },
        })) {
          upsertPullRequest(repoRow.id, pr);
          count += 1;
        }

        touchIngest(repoRow.id);
        db.prepare(
          `UPDATE ingest_runs SET status = 'done', finished_at = :now, pr_done = :count,
             api_calls = api_calls, rate_remaining = :remaining WHERE id = :id`,
        ).run({ now: new Date().toISOString(), count, remaining: rateRemaining, id: runId });

        send({ kind: "done", count });
      } catch (err) {
        const message = err instanceof GithubError ? err.message : err instanceof Error ? err.message : "不明なエラー";
        db.prepare(
          `UPDATE ingest_runs SET status = 'error', finished_at = :now, pr_done = :count, error = :error WHERE id = :id`,
        ).run({ now: new Date().toISOString(), count, error: message, id: runId });
        send({ kind: "error", message });
      } finally {
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
