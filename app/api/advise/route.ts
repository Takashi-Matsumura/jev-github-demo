import { rejectCrossOrigin } from "@/lib/same-origin";
import { getRepo, getAdvice, upsertAdvice, type AdviceScope } from "@/lib/queries";
import { buildDeveloperSignals, buildRepoSignals, buildPrSignals, type GrowthSignals, type PrSignals } from "@/lib/growth";
import { buildDeveloperAdvicePrompt, buildRepoAdvicePrompt, buildPrCheckPrompt, advicePromptVersion, type BuiltPrompt } from "@/lib/advice-prompt";
import { interpretDeveloperAdvice, interpretRepoAdvice, interpretPrCheck } from "@/lib/advice";
import { postGemma, GemmaError, type GemmaErrorKind } from "@/lib/gemma";

const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
const PR_NUMBER_RE = /^[1-9][0-9]*$/;
const HEARTBEAT_MS = 2_000;

type AdviseBody = {
  owner?: string;
  repo?: string;
  scope?: AdviceScope;
  subject?: string;
  dryRun?: boolean;
  force?: boolean;
};

type ProgressLine =
  | { kind: "signals"; scope: AdviceScope; subject: string; signals: unknown }
  | { kind: "plan"; willCall: boolean; reason: string }
  | { kind: "dry_run"; state: unknown; messages: unknown; schema: unknown; promptChars: number }
  | { kind: "waiting"; elapsedMs: number }
  | { kind: "advice"; scope: AdviceScope; subject: string; themeIds: string[]; needsReview: boolean; elapsedMs: number }
  | { kind: "error"; message: string; errorKind?: GemmaErrorKind }
  | { kind: "done"; generated: number; skipped: number; inputTokens: number; outputTokens: number };

function promptChars(prompt: BuiltPrompt<unknown>): number {
  return prompt.messages.reduce((s, m) => s + m.content.length, 0);
}

export async function POST(request: Request) {
  const originRejection = rejectCrossOrigin(request);
  if (originRejection) return originRejection;

  let body: AdviseBody;
  try {
    body = (await request.json()) as AdviseBody;
  } catch {
    return Response.json({ error: "リクエストボディが JSON ではありません" }, { status: 400 });
  }

  const owner = body.owner?.trim() ?? "";
  const repo = body.repo?.trim() ?? "";
  const scope = body.scope;
  const dryRun = !!body.dryRun;
  const force = !!body.force;

  if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) {
    return Response.json({ error: "owner / repo の形式が不正です" }, { status: 400 });
  }
  if (scope !== "dev" && scope !== "pr" && scope !== "repo") {
    return Response.json({ error: "scope は dev / pr / repo のいずれかを指定してください" }, { status: 400 });
  }

  const subjectRaw = body.subject?.trim() ?? "";
  if (scope === "dev" && !NAME_RE.test(subjectRaw)) {
    return Response.json({ error: "dev スコープでは subject に開発者の login を指定してください" }, { status: 400 });
  }
  if (scope === "pr" && !PR_NUMBER_RE.test(subjectRaw)) {
    return Response.json({ error: "pr スコープでは subject に PR 番号を指定してください" }, { status: 400 });
  }
  const subject = scope === "repo" ? "" : subjectRaw;

  const repoRow = getRepo(owner, repo);
  if (!repoRow) {
    return Response.json({ error: "このリポジトリはまだ取り込まれていません。先に /api/ingest を実行してください" }, { status: 404 });
  }

  let signals: GrowthSignals | PrSignals;
  if (scope === "dev") {
    signals = buildDeveloperSignals(repoRow.id, subject);
  } else if (scope === "repo") {
    signals = buildRepoSignals(repoRow.id);
  } else {
    const built = buildPrSignals(repoRow.id, Number(subject));
    if (!built) {
      return Response.json({ error: `PR #${subject} が見つかりません` }, { status: 404 });
    }
    signals = built;
  }

  const promptVersion = advicePromptVersion(scope);
  const signalsVersion = signals.signalsVersion;

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ProgressLine) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));

      try {
        // 観測事実は LLM と無関係に確定しており、llama-server が落ちていても画面に出せる。
        // Gemma を呼ぶ前に必ず流す ── これが正しい degradation。
        send({ kind: "signals", scope, subject, signals });

        const existing = getAdvice(repoRow.id, scope, subject);
        const needsWork = force || !existing || existing.signals_version !== signalsVersion || existing.prompt_version !== promptVersion;
        send({
          kind: "plan",
          willCall: needsWork && !dryRun,
          reason: !needsWork
            ? "観測事実とプロンプトの版が前回生成時から変わっていないためスキップしました（force で強制再生成できます）"
            : dryRun
              ? "dryRun のため Gemma は呼びません"
              : "生成します",
        });

        const prompt: BuiltPrompt<GrowthSignals | PrSignals> =
          scope === "dev"
            ? buildDeveloperAdvicePrompt(signals as GrowthSignals)
            : scope === "repo"
              ? buildRepoAdvicePrompt(signals as GrowthSignals)
              : buildPrCheckPrompt(signals as PrSignals);

        if (dryRun) {
          send({ kind: "dry_run", state: prompt.state, messages: prompt.messages, schema: prompt.schema, promptChars: promptChars(prompt) });
          send({ kind: "done", generated: 0, skipped: 0, inputTokens: 0, outputTokens: 0 });
          return;
        }

        if (!needsWork) {
          send({ kind: "done", generated: 0, skipped: 1, inputTokens: 0, outputTokens: 0 });
          return;
        }

        const startedAt = Date.now();
        const beat = setInterval(() => send({ kind: "waiting", elapsedMs: Date.now() - startedAt }), HEARTBEAT_MS);

        try {
          const exchange = await postGemma(prompt, abortController.signal);

          try {
            const interpreted =
              scope === "dev"
                ? interpretDeveloperAdvice(exchange.response.parsed)
                : scope === "repo"
                  ? interpretRepoAdvice(exchange.response.parsed)
                  : interpretPrCheck(exchange.response.parsed);

            upsertAdvice(repoRow.id, scope, subject, {
              signalsJson: JSON.stringify(signals),
              signalsVersion,
              promptVersion,
              exchangeJson: JSON.stringify(exchange),
              adviceJson: JSON.stringify(interpreted.advice),
              model: exchange.response.model,
              inputTokens: exchange.response.usage.prompt_tokens,
              outputTokens: exchange.response.usage.completion_tokens,
              elapsedMs: exchange.elapsedMs,
              needsReview: interpreted.needsReview,
              error: null,
            });

            const themeIds = "themes" in interpreted.advice ? interpreted.advice.themes.map((t) => t.id) : [];
            send({ kind: "advice", scope, subject, themeIds, needsReview: interpreted.needsReview, elapsedMs: exchange.elapsedMs });
            send({ kind: "done", generated: 1, skipped: 0, inputTokens: exchange.response.usage.prompt_tokens, outputTokens: exchange.response.usage.completion_tokens });
          } catch (interpretErr) {
            // Gemma からは応答が来たが、期待した形と一致しなかった場合。exchange はそのまま保存し、
            // 何が返ってきたかを Gemma コンソールで開示できるようにする。
            const message = interpretErr instanceof Error ? interpretErr.message : "不明なエラー";
            upsertAdvice(repoRow.id, scope, subject, {
              signalsJson: JSON.stringify(signals),
              signalsVersion,
              promptVersion,
              exchangeJson: JSON.stringify(exchange),
              adviceJson: null,
              model: exchange.response.model,
              inputTokens: exchange.response.usage.prompt_tokens,
              outputTokens: exchange.response.usage.completion_tokens,
              elapsedMs: exchange.elapsedMs,
              needsReview: true,
              error: message,
            });
            send({ kind: "error", message });
            send({ kind: "done", generated: 0, skipped: 0, inputTokens: exchange.response.usage.prompt_tokens, outputTokens: exchange.response.usage.completion_tokens });
          }
        } catch (err) {
          // Gemma 呼び出し自体が失敗した場合も、観測事実だけは欠損なく1行保存する
          // （classify.ts が Jev 失敗時も中立値で1行保存するのと同じ作法）。
          const message = err instanceof GemmaError ? `${err.kind}: ${err.message}` : err instanceof Error ? err.message : "不明なエラー";
          const errorKind = err instanceof GemmaError ? err.kind : undefined;
          upsertAdvice(repoRow.id, scope, subject, {
            signalsJson: JSON.stringify(signals),
            signalsVersion,
            promptVersion,
            exchangeJson: null,
            adviceJson: null,
            model: null,
            inputTokens: null,
            outputTokens: null,
            elapsedMs: null,
            needsReview: true,
            error: message,
          });
          send({ kind: "error", message, errorKind });
          send({ kind: "done", generated: 0, skipped: 0, inputTokens: 0, outputTokens: 0 });
        } finally {
          clearInterval(beat);
        }
      } catch (err) {
        send({ kind: "error", message: err instanceof Error ? err.message : "不明なエラー" });
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
