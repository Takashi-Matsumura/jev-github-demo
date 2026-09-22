import "server-only";
import { getGemmaEndpoint, getGemmaModel, isGemmaDisabled } from "@/lib/env";

/**
 * 手元の llama.cpp サーバー（OpenAI 互換 API）のクライアント。
 *
 * lib/jev.ts と同じ形（Exchange に送った内容そのものを持ち、DB に丸ごと保存して UI で
 * 開示する）にしてあるが、性質は正反対である ── Jev は型安全な確率を返す。Gemma は文章を
 * 返す。文章は検証できないので、数値の判断には一切使わない。数値は lib/growth.ts が
 * 決定論的に確定させ、Gemma には「その数値の読み方」と「カタログからの選択」だけをさせる。
 *
 * **外部送信ではない。** 呼び先は既定で 127.0.0.1 固定で、API キーも要らない。
 *
 * 実測（gemma-4-12b-it Q4_K_M、-c 32768 --parallel 2）: prefill 約338 tok/s、
 * 生成 約15 tok/s、日本語 約0.66 tok/文字。入力2,700+出力500 で約42秒かかる。
 * Jev の8秒とは桁が違うのでタイムアウトは180秒にしてある。
 *
 * **このモデルは既定で「思考」を吐き、それが構造化出力を壊す。** response_format:
 * json_schema を付けても、思考は grammar の制約外なので max_tokens を食い潰し、
 * content が空で finish_reason:"length" になることがある。chat_template_kwargs の
 * enable_thinking: false を必須パラメータとして常に送る。
 */

const TIMEOUT_MS = 180_000;
const COOL_DOWN_AFTER = 2; // 起動し忘れが最頻の失敗なので Jev(3) より早く諦める
const COOL_DOWN_MS = 60_000; // 起動し直したらすぐ試せるよう1分

export type GemmaMessage = { role: "system" | "user"; content: string };

export type GemmaSchema = { name: string; schema: unknown };

export type GemmaRequest<S> = {
  state: S;
  messages: GemmaMessage[];
  schema: GemmaSchema;
  maxTokens: number;
  /** 既定 0.2。カタログからの選択・観測事実の言い換えという用途上、創造性は要らない。 */
  temperature?: number;
};

/**
 * 1 回のやり取りの記録。**送った内容をそのまま持つ**のが要点（lib/jev.ts の JevExchange と同じ）。
 * 画面に出しているものが実際に送信したものと一致していないと、「外に出ているのはこれだけです」
 * と言えなくなる。呼び出し側は組み立て直さないこと。
 */
export type GemmaExchange<S> = {
  request: {
    endpoint: string;
    model: string;
    state: S; // プロンプトに詰めた集計値。画面に出すのはこれ
    messages: GemmaMessage[]; // 実際に送った本文。組み立て直さない
    schema: unknown;
    params: { temperature: number; max_tokens: number; enable_thinking: false };
  };
  response: {
    model: string;
    parsed: unknown; // JSON.parse 済み。型の確定は lib/advice.ts が行う
    raw: string; // 生の content。parsed と食い違っていないか目で確かめられるよう残す
    finishReason: string;
    usage: { prompt_tokens: number; completion_tokens: number };
  };
  elapsedMs: number;
};

export type GemmaErrorKind =
  | "disabled"
  | "breaker"
  | "timeout"
  | "network" // ECONNREFUSED が最頻（llama-server が起動していない）
  | "invalid"
  | "server"
  | "truncated" // finish_reason: "length"。出力が途中で切れた
  | "empty" // content が空（enable_thinking の取りこぼし）
  | "parse"; // JSON にならなかった

export class GemmaError extends Error {
  constructor(
    message: string,
    readonly kind: GemmaErrorKind,
  ) {
    super(message);
    this.name = "GemmaError";
  }
}

// ─── 回路ブレーカ（lib/jev.ts と同じ考え方） ─────────────────────────

const breaker = { failures: 0, coolUntil: 0 };

function recordFailure(): void {
  breaker.failures += 1;
  if (breaker.failures >= COOL_DOWN_AFTER) {
    breaker.coolUntil = Date.now() + COOL_DOWN_MS;
    breaker.failures = 0;
  }
}

function recordSuccess(): void {
  breaker.failures = 0;
  breaker.coolUntil = 0;
}

export function gemmaBreakerState(): { coolingDown: boolean; retryAfterMs: number } {
  const retryAfterMs = Math.max(0, breaker.coolUntil - Date.now());
  return { coolingDown: retryAfterMs > 0, retryAfterMs };
}

/** /api/health 用。2秒でモデル一覧エンドポイントを叩くだけで、失敗しても例外を投げない。 */
export async function gemmaReachable(): Promise<boolean> {
  if (isGemmaDisabled()) return false;
  try {
    const modelsUrl = getGemmaEndpoint().replace(/\/chat\/completions$/, "/models");
    const res = await fetch(modelsUrl, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** state と json_schema を1回のコールで送る。ストリーミングはしない（呼び出し側が
 *  NDJSON の心拍で沈黙を埋める。usage が正確に取れ、この Exchange の形とも対応する）。 */
export async function postGemma<S extends object>(req: GemmaRequest<S>, signal?: AbortSignal): Promise<GemmaExchange<S>> {
  if (isGemmaDisabled()) throw new GemmaError("GEMMA_DISABLED=1 のため呼び出しません", "disabled");

  const { coolingDown, retryAfterMs } = gemmaBreakerState();
  if (coolingDown) {
    throw new GemmaError(`Gemma が連続で失敗したため休止中です（あと ${Math.ceil(retryAfterMs / 1000)} 秒）`, "breaker");
  }

  const endpoint = getGemmaEndpoint();
  const model = getGemmaModel();
  const temperature = req.temperature ?? 0.2;
  const params = { temperature, max_tokens: req.maxTokens, enable_thinking: false as const };

  const body = {
    model,
    messages: req.messages,
    response_format: { type: "json_schema", json_schema: { name: req.schema.name, schema: req.schema.schema, strict: true } },
    temperature,
    max_tokens: req.maxTokens,
    chat_template_kwargs: { enable_thinking: false },
  };

  const startedAt = performance.now();
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: combined,
    });
  } catch (e) {
    if (timeout.aborted) {
      recordFailure();
      throw new GemmaError(`Gemma が ${TIMEOUT_MS / 1000} 秒以内に応答しませんでした`, "timeout");
    }
    if (signal?.aborted) throw e; // 呼び出し側の中断はそのまま伝播する（失敗として数えない）
    recordFailure();
    throw new GemmaError(
      `Gemma (${endpoint}) に接続できません。llama-server が起動しているか確認してください: ${
        e instanceof Error ? e.message : "不明なエラー"
      }`,
      "network",
    );
  }

  if (!res.ok) {
    recordFailure();
    const bodyText = await res.text().catch(() => "");
    throw new GemmaError(`Gemma API が ${res.status} を返しました: ${bodyText.slice(0, 300)}`, res.status >= 500 ? "server" : "invalid");
  }

  const json = (await res.json()) as {
    model: string;
    choices: { message: { content: string }; finish_reason: string }[];
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  const choice = json.choices?.[0];
  const raw = choice?.message?.content ?? "";
  const finishReason = choice?.finish_reason ?? "unknown";

  if (raw.trim() === "") {
    recordFailure();
    if (finishReason === "length") {
      throw new GemmaError("出力が空のまま max_tokens に達しました（enable_thinking が効いていない可能性があります）", "truncated");
    }
    throw new GemmaError("Gemma の応答が空でした", "empty");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    recordFailure();
    throw new GemmaError("Gemma の応答が JSON として解釈できませんでした", "parse");
  }

  recordSuccess();
  return {
    request: { endpoint, model, state: req.state, messages: req.messages, schema: req.schema, params },
    response: { model: json.model, parsed, raw, finishReason, usage: json.usage },
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}
