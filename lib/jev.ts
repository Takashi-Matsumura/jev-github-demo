import "server-only";
import { getTypesafeApiKey } from "@/lib/env";

/**
 * TypeSafe AI / Jev (System One) のクライアント。https://docs.typesafe.ai/api
 *
 * **server 専用。** API キーはここから先へ出さない。
 *
 * Jev はテキストを生成しない。`state` と型つきの質問を送ると、各質問に
 * 確率つきの型安全な答えだけを返す。全質問は並列評価されるので、質問を足しても
 * レイテンシはほぼ増えない（1 PR 1 リクエストに詰める）。
 *
 * **外部送信であることに注意。** state に入れたものは TypeSafe のサーバへ送られる。
 */

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";

const TIMEOUT_MS = 8_000;
const COOL_DOWN_AFTER = 3;
const COOL_DOWN_MS = 5 * 60_000;

// ─── ワイヤ形式 ────────────────────────────────────────────────

export type JevNoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
};

export type JevChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

export type JevScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};

export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion;

export type JevNoulAnswer = { type: "noul"; noul: number };
export type JevChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
export type JevScoreAnswer = {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
};
export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export type JevResponse = {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
};

/**
 * 1 回のやり取りの記録。**送った内容をそのまま持つ**のが要点。
 * 画面に出しているものが実際に送信したものと一致していないと、
 * 「外に出ているのはこれだけです」と言えなくなる。呼び出し側は組み立て直さないこと。
 */
export type JevExchange<S> = {
  request: {
    endpoint: string;
    model: string;
    state: S;
    questions: Record<string, JevQuestion>;
  };
  response: JevResponse;
  elapsedMs: number;
};

export type JevErrorKind =
  | "config"
  | "breaker"
  | "timeout"
  | "network"
  | "auth"
  | "invalid"
  | "rate_limit"
  | "overloaded"
  | "server";

export class JevError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: JevErrorKind,
  ) {
    super(message);
    this.name = "JevError";
  }
}

// ─── 回路ブレーカ ────────────────────────────────────────────

const breaker = { failures: 0, coolUntil: 0 };

/** 一時的な失敗（回復しうるもの）だけを数える。401/422 は設定・実装の誤りなので数えない。 */
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

export function jevBreakerState(): { coolingDown: boolean; retryAfterMs: number } {
  const retryAfterMs = Math.max(0, breaker.coolUntil - Date.now());
  return { coolingDown: retryAfterMs > 0, retryAfterMs };
}

function classify(status: number): JevErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 422 || status === 400) return "invalid";
  if (status === 429) return "rate_limit";
  if (status === 529) return "overloaded";
  return "server";
}

function isTransient(status: number): boolean {
  return status === 429 || status === 529 || status >= 500;
}

export function hasJevApiKey(): boolean {
  return !!getTypesafeApiKey();
}

/** state と型つき質問群を 1 回のコールで並列評価させる。 */
export async function postJev<S extends object>(
  state: S,
  questions: Record<string, JevQuestion>,
  signal?: AbortSignal,
): Promise<JevExchange<S>> {
  const apiKey = getTypesafeApiKey();
  if (!apiKey) throw new JevError("TYPESAFE_API_KEY が設定されていません", 500, "config");

  const { coolingDown, retryAfterMs } = jevBreakerState();
  if (coolingDown) {
    throw new JevError(
      `Jev が連続で失敗したため休止中です（あと ${Math.ceil(retryAfterMs / 1000)} 秒）`,
      503,
      "breaker",
    );
  }

  const startedAt = performance.now();
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;

  let res: Response;
  try {
    res = await fetch(JEV_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal: combined,
    });
  } catch (e) {
    if (timeout.aborted) {
      recordFailure();
      throw new JevError(`Jev が ${TIMEOUT_MS / 1000} 秒以内に応答しませんでした`, 504, "timeout");
    }
    if (signal?.aborted) throw e;
    recordFailure();
    throw new JevError(
      `Jev に接続できません: ${e instanceof Error ? e.message : "不明なエラー"}`,
      502,
      "network",
    );
  }

  if (!res.ok) {
    if (isTransient(res.status)) recordFailure();
    const bodyText = await res.text().catch(() => "");
    throw new JevError(
      `Jev API が ${res.status} を返しました: ${bodyText.slice(0, 300)}`,
      res.status,
      classify(res.status),
    );
  }

  const response = (await res.json()) as JevResponse;
  recordSuccess();
  return {
    request: { endpoint: JEV_ENDPOINT, model: JEV_MODEL, state, questions },
    response,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}
