import { classifyByRules } from "@/lib/classify";
import { interpretAnswers } from "@/lib/classify";
import { buildPrState, buildQuestions, questionsVersion } from "@/lib/questions";
import { postJev, JevError } from "@/lib/jev";
import {
  getRepo,
  listPullRequests,
  listPrFiles,
  getClassification,
  upsertClassification,
} from "@/lib/queries";
import { rejectCrossOrigin } from "@/lib/same-origin";

const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
const DEFAULT_CONCURRENCY = 2;

function parseLimit(raw: unknown, fallback: number): number {
  const num = typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
  return Math.min(Math.max(Math.trunc(num), 1), 500);
}

function parseConcurrency(raw: unknown, fallback: number): number {
  const num = typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
  return Math.min(Math.max(Math.trunc(num), 1), 4);
}

type ClassifyBody = {
  owner?: string;
  repo?: string;
  limit?: number;
  dryRun?: boolean;
  force?: boolean;
  concurrency?: number;
};

type ProgressLine =
  | { kind: "plan"; total: number; toClassify: number; skipped: number }
  | { kind: "dry_run"; number: number; title: string; askCategory: boolean; ruleEvidence: string[]; state: unknown; questions: unknown }
  | { kind: "pr"; number: number; title: string; category: string; categorySource: string; needsReview: boolean; done: number }
  | { kind: "pr_error"; number: number; title: string; message: string; done: number }
  | { kind: "done"; classified: number; skipped: number; inputTokens: number; outputTokens: number }
  | { kind: "error"; message: string };

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function POST(request: Request) {
  const originRejection = rejectCrossOrigin(request);
  if (originRejection) return originRejection;

  let body: ClassifyBody;
  try {
    body = (await request.json()) as ClassifyBody;
  } catch {
    return Response.json({ error: "リクエストボディが JSON ではありません" }, { status: 400 });
  }

  const owner = body.owner?.trim() ?? "";
  const repo = body.repo?.trim() ?? "";
  const limit = parseLimit(body.limit, 5);
  const dryRun = !!body.dryRun;
  const force = !!body.force;
  const concurrency = parseConcurrency(body.concurrency, DEFAULT_CONCURRENCY);

  if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) {
    return Response.json({ error: "owner / repo の形式が不正です" }, { status: 400 });
  }

  const repoRow = getRepo(owner, repo);
  if (!repoRow) {
    return Response.json({ error: "このリポジトリはまだ取り込まれていません。先に /api/ingest を実行してください" }, { status: 404 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ProgressLine) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));

      try {
        const allPrs = listPullRequests(repoRow.id).slice(0, limit);
        const withVersion = allPrs.map((pr) => {
          const files = listPrFiles(repoRow.id, pr.number);
          const rule = classifyByRules({
            title: pr.title,
            labels: JSON.parse(pr.labels_json) as string[],
            filePaths: files.filter((f) => !f.generated).map((f) => f.path),
          });
          const askCategory = !rule.category;
          const qVersion = questionsVersion(askCategory);
          const existing = getClassification(repoRow.id, pr.number);
          const needsWork = force || !existing || existing.questions_version !== qVersion;
          return { pr, files, rule, askCategory, qVersion, needsWork };
        });

        const toProcess = withVersion.filter((x) => x.needsWork);
        send({
          kind: "plan",
          total: allPrs.length,
          toClassify: toProcess.length,
          skipped: allPrs.length - toProcess.length,
        });

        let inputTokens = 0;
        let outputTokens = 0;
        let classified = 0;

        await mapWithConcurrency(toProcess, dryRun ? toProcess.length : concurrency, async ({ pr, files, rule, askCategory, qVersion }) => {
          const state = buildPrState({
            owner,
            repo,
            number: pr.number,
            title: pr.title,
            body: pr.body,
            labels: JSON.parse(pr.labels_json) as string[],
            files,
            additions: pr.additions,
            deletions: pr.deletions,
            changedFileCount: pr.changed_files,
            commitCount: pr.commit_count,
            commitTitles: JSON.parse(pr.commit_titles) as string[],
            reviewCount: pr.review_count,
          });
          const questions = buildQuestions({ askCategory });

          if (dryRun) {
            send({ kind: "dry_run", number: pr.number, title: pr.title, askCategory, ruleEvidence: rule.evidence, state, questions });
            return;
          }

          try {
            const exchange = await postJev(state, questions);
            inputTokens += exchange.response.usage.input_tokens;
            outputTokens += exchange.response.usage.output_tokens;

            const interpreted = interpretAnswers(rule, exchange.response.answers);
            upsertClassification(repoRow.id, pr.number, {
              ...interpreted,
              jevExchangeJson: JSON.stringify(exchange),
              jevInputTokens: exchange.response.usage.input_tokens,
              jevOutputTokens: exchange.response.usage.output_tokens,
              jevElapsedMs: exchange.elapsedMs,
              jevError: null,
              model: exchange.response.model,
              questionsVersion: qVersion,
            });
            classified += 1;
            send({
              kind: "pr",
              number: pr.number,
              title: pr.title,
              category: interpreted.category,
              categorySource: interpreted.categorySource,
              needsReview: interpreted.needsReview,
              done: classified,
            });
          } catch (err) {
            const message = err instanceof JevError ? `${err.kind}: ${err.message}` : err instanceof Error ? err.message : "不明なエラー";
            // Jev が失敗した場合も、ルール分類とニュートラル値で欠損なく1行保存する（等式の "中立値で計上" 表示のため）
            upsertClassification(repoRow.id, pr.number, {
              category: rule.category ?? "other",
              categorySource: rule.category ? "rule" : "jev",
              categoryEvidence: [...rule.evidence, `Jev 呼び出し失敗: ${message}`],
              categoryConfidence: rule.category ? 1 : null,
              categoryTopProb: null,
              needsReview: true,
              impact: null, impactConf: null,
              complexity: null, complexityConf: null,
              risk: null, riskConf: null,
              userFacing: null, breakingChange: null, testsIncluded: null,
              scopeCoherence: null, titleMatchesDiff: null,
              jevExchangeJson: null,
              jevAskedCategory: askCategory,
              jevInputTokens: null, jevOutputTokens: null, jevElapsedMs: null,
              jevError: message,
              model: null,
              questionsVersion: qVersion,
            });
            send({ kind: "pr_error", number: pr.number, title: pr.title, message, done: classified });
          }
        });

        if (!dryRun) {
          send({ kind: "done", classified, skipped: allPrs.length - toProcess.length, inputTokens, outputTokens });
        } else {
          send({ kind: "done", classified: 0, skipped: allPrs.length - toProcess.length, inputTokens: 0, outputTokens: 0 });
        }
      } catch (err) {
        send({ kind: "error", message: err instanceof Error ? err.message : "不明なエラー" });
      } finally {
        controller.close();
      }
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
