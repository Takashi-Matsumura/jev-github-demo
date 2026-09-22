import "server-only";
import { createHash } from "node:crypto";
import { formatHours } from "@/lib/analytics";
import { STRATA_DISCLAIMER, DOMAIN_LABELS, type Signal, type Trend, type Strata, type GrowthSignals, type DomainStat, type PrSignals } from "@/lib/growth";
import { LEARNING_CATALOG } from "@/lib/learning-catalog";
import type { GemmaMessage, GemmaSchema } from "@/lib/gemma";
import type { AdviceScope } from "@/lib/queries";

/**
 * Gemma へ送る内容の組み立て（lib/questions.ts の buildQuestions/questionsVersion と同じ役割）。
 * 応答の解釈は lib/advice.ts（lib/classify.ts と同じ役割）が行う。
 *
 * 設計の要点:
 * - 数値はここで文章に変換するだけで、判断は一切しない（「伸びている」等とは書かない）。
 * - 学習テーマは id + title + summary のみをカタログとして渡す。refs の URL は一切渡さない
 *   ── モデルに見せなければ写し間違えようがない、というのが捏造防止の本命。
 * - signals は JSON.stringify せず行指向のテキストにする（括弧と引用符はトークンを食うだけ）。
 * - 実測 0.66 tok/文字（日本語）を踏まえ、プロンプト全体を6,000トークン（≈9,000文字）以内に収める。
 */

export const ADVICE_SYSTEM_RULES = `あなたは日本語で書くソフトウェア開発のコーチです。次の規則を必ず守ってください。
1. 与えられた観測事実の数値だけを根拠にすること。数値を作り出さない、誇張して言い換えない。
2. 「判定不能」と書かれた指標には一切言及しないこと。それは判定できなかったものであって、あなたが埋めてよい空欄ではない。
3. 人物を評価しない。「優秀」「能力が低い」「向いていない」のような語を使わない。
4. 因果を主張しない。相関を原因のように書かない。
5. 学習テーマは与えられたカタログの id からのみ選ぶ。URL・書名・記事名を自分では書かない。
6. 断定できないことは「〜の可能性がある」と書く。`;

/** プロンプトに渡すカタログはこの3項目のみ。refs は含めない。 */
const CATALOG_TEXT = LEARNING_CATALOG.map((t) => `- ${t.id}: ${t.title} — ${t.summary}`).join("\n");
const CATALOG_IDS = LEARNING_CATALOG.map((t) => t.id);

/** advice の各項目が「どの観測事実から出た話か」を必ず紐づけさせるための enum。
 *  lib/growth.ts の Signal.key / Trend.key / Strata.key に現れる文字列と揃えること。 */
export const SIGNAL_KEYS = [
  "domain_coverage",
  "domain_concentration",
  "domain_effective",
  "complexity",
  "impact",
  "size",
  "tests_by_path",
  "tests_by_jev",
  "scope_coherence",
  "title_matches_diff",
  "reviews_given",
  "read_write_ratio",
  "substantial_review_share",
  "distinct_authors_reviewed",
  "changes_requested_share",
  "size_median",
  "lead_time_median",
  "lead_time",
  "changes_requested",
] as const;

const PR_CHECK_FOCUS = ["設計判断", "影響範囲", "失敗時の挙動", "テスト", "代替案", "依存関係"] as const;

// ─── 観測事実 → 文章（判断はしない、数値の言い換えだけ） ────────────────

function fmtVal(value: number, unit: Signal["unit"]): string {
  switch (unit) {
    case "rate":
      return `${Math.round(value * 100)}%`;
    case "level":
      return value.toFixed(2);
    case "loc":
      return `${Math.round(value)}行`;
    case "hours":
      return formatHours(value);
    case "count":
      return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
}

/** note は「判定不能（理由）」の形で既に自己完結している場合と、理由だけの場合がある
 *  （lib/growth.ts 側で統一されていない）。ここで正規化し、常に「判定不能（理由）」の
 *  一重の括弧書きにする ── 二重に包むと「判定不能（判定不能（…))」になってしまう。 */
function unjudgedNote(note: string): string {
  const m = note.match(/^判定不能[（(](.*)[)）]$/);
  return `判定不能（${m ? m[1] : note}）`;
}

function signalLine(s: Signal): string {
  if (!s.judged || s.value == null) return `${s.label}: ${unjudgedNote(s.note)}`;
  return `${s.label}: ${fmtVal(s.value, s.unit)}（${s.note}）`;
}

function trendLine(t: Trend): string {
  if (!t.judged || t.early == null || t.recent == null || t.delta == null) return `${t.label}: ${unjudgedNote(t.note)}`;
  const sign = t.delta >= 0 ? "+" : "";
  return `${t.label}: 前半${t.early.toFixed(2)} → 直近${t.recent.toFixed(2)}（${sign}${t.delta.toFixed(2)}、${t.note}）`;
}

function strataLine(s: Strata): string {
  if (!s.judged || s.ai.value == null || s.nonAi.value == null) return `${s.label}: ${unjudgedNote(s.note)}`;
  return `${s.label}: AI併走${fmtVal(s.ai.value, s.unit)} / 非併走${fmtVal(s.nonAi.value, s.unit)}（${s.note}）`;
}

function domainLine(stats: DomainStat[]): string {
  if (stats.length === 0) return "（変更ファイルの情報がありません）";
  return stats.map((d) => `${d.label} ${Math.round(d.share * 100)}%`).join("・");
}

/** GrowthSignals を行指向のテキストに変換する。dev/repo 両スコープで共用。 */
export function renderSignalsText(signals: GrowthSignals): string {
  const lines: string[] = [];
  lines.push(`リポジトリ: ${signals.repo || "(不明)"}`);
  lines.push(`対象: ${signals.scope === "dev" ? `開発者 ${signals.login}` : "リポジトリ全体"}`);
  lines.push(`PR数: ${signals.prCount} 件（分類済み ${signals.classifiedCount} 件）`);
  if (signals.periodFrom && signals.periodTo) {
    lines.push(`対象期間: ${signals.periodFrom.slice(0, 10)} 〜 ${signals.periodTo.slice(0, 10)}`);
  }

  lines.push("", "# 技術領域");
  lines.push(signalLine(signals.domains.coverage));
  lines.push(signalLine(signals.domains.effectiveDomains));
  lines.push(signalLine(signals.domains.concentration));
  lines.push(`領域内訳: ${domainLine(signals.domains.stats)}`);
  if (signals.domains.newDomains.length > 0) {
    lines.push(`直近半分で初めて触れた領域: ${signals.domains.newDomains.map((d) => DOMAIN_LABELS[d]).join("・")}`);
  }

  lines.push("", "# 推移（前半→直近）");
  for (const t of signals.trends) lines.push(trendLine(t));

  lines.push("", "# 品質（テスト・説明力）");
  for (const s of signals.quality) lines.push(signalLine(s));

  lines.push("", "# レビュー活動（他人のコードを読む量）");
  for (const s of signals.review) lines.push(signalLine(s));

  lines.push("", "# AI併走の有無で見た違い");
  lines.push(STRATA_DISCLAIMER);
  for (const s of signals.strata) lines.push(strataLine(s));

  if (signals.members && signals.members.length > 0) {
    lines.push("", "# 主なメンバー（上位8名）");
    lines.push(signals.members.map((m) => `${m.login}（PR${m.prCount}件・スコア${m.total.toFixed(1)}）`).join("・"));
  }

  return lines.join("\n");
}

function renderPrSignalsText(p: PrSignals): string {
  const lines: string[] = [];
  lines.push(`リポジトリ: ${p.repo}`);
  lines.push(`PR #${p.number}: ${p.title}`);
  lines.push(`本文抜粋: ${p.state.body_excerpt || "(本文なし)"}`);
  lines.push(
    `変更ファイル(${p.state.changed_file_count}件${p.state.changed_files_omitted > 0 ? `・${p.state.changed_files_omitted}件省略` : ""}): ${
      p.state.changed_files.join(", ") || "(なし)"
    }`,
  );
  lines.push(`追加/削除: +${p.state.additions}/-${p.state.deletions}`);
  lines.push(`コミット数: ${p.state.commit_count}`);
  lines.push(`触れた領域: ${p.domains.map((d) => DOMAIN_LABELS[d]).join("・") || "(判定不能)"}`);
  lines.push(`分類: ${p.classification.classified ? p.classification.category : "未分類"}`);
  return lines.join("\n");
}

// ─── json_schema ────────────────────────────────────────────────

function pointItemSchema() {
  return {
    type: "object",
    properties: { signal: { type: "string", enum: SIGNAL_KEYS }, text: { type: "string" } },
    required: ["signal", "text"],
    additionalProperties: false,
  };
}

function themeItemSchema() {
  return {
    type: "object",
    properties: { id: { type: "string", enum: CATALOG_IDS }, reason: { type: "string" } },
    required: ["id", "reason"],
    additionalProperties: false,
  };
}

const DEVELOPER_ADVICE_SCHEMA: GemmaSchema = {
  name: "developer_advice",
  schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      strengths: { type: "array", items: pointItemSchema(), minItems: 1, maxItems: 3 },
      watchpoints: { type: "array", items: pointItemSchema(), minItems: 1, maxItems: 3 },
      themes: { type: "array", items: themeItemSchema(), minItems: 1, maxItems: 3 },
      questions_for_1on1: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3 },
    },
    required: ["summary", "strengths", "watchpoints", "themes", "questions_for_1on1"],
    additionalProperties: false,
  },
};

const REPO_ADVICE_SCHEMA: GemmaSchema = {
  name: "repo_advice",
  schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      team_patterns: { type: "array", items: pointItemSchema(), minItems: 1, maxItems: 4 },
      themes: { type: "array", items: themeItemSchema(), minItems: 1, maxItems: 3 },
      // 判定不能だった論点をモデル自身に列挙させる。画面が黙って穴を埋める誘惑を断つため。
      undetermined: { type: "array", items: { type: "string" } },
    },
    required: ["summary", "team_patterns", "themes", "undetermined"],
    additionalProperties: false,
  },
};

const PR_CHECK_SCHEMA: GemmaSchema = {
  name: "pr_check",
  schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: { text: { type: "string" }, focus: { type: "string", enum: PR_CHECK_FOCUS } },
          required: ["text", "focus"],
          additionalProperties: false,
        },
        // 採点も正解も出力させない。スキーマに正解欄が存在しないので、構造的に出せない。
        minItems: 3,
        maxItems: 3,
      },
    },
    required: ["questions"],
    additionalProperties: false,
  },
};

function systemMessage(): GemmaMessage {
  return {
    role: "system",
    content: `${ADVICE_SYSTEM_RULES}\n\n# 学習テーマのカタログ（id と概要のみ。これ以外のテーマを作らないこと）\n${CATALOG_TEXT}`,
  };
}

export type BuiltPrompt<S> = { state: S; messages: GemmaMessage[]; schema: GemmaSchema; maxTokens: number };

export function buildDeveloperAdvicePrompt(signals: GrowthSignals): BuiltPrompt<GrowthSignals> {
  const text = renderSignalsText(signals);
  const body = `以下は開発者 ${signals.login} の観測事実です。summary/strengths/watchpoints/themes/questions_for_1on1 を JSON で返してください。\n\n${text}`;
  return {
    state: signals,
    messages: [systemMessage(), { role: "user", content: body }],
    schema: DEVELOPER_ADVICE_SCHEMA,
    maxTokens: 900,
  };
}

export function buildRepoAdvicePrompt(signals: GrowthSignals): BuiltPrompt<GrowthSignals> {
  const text = renderSignalsText(signals);
  const body = `以下はリポジトリ全体の観測事実です。summary/team_patterns/themes/undetermined を JSON で返してください。判定不能だった指標があれば undetermined に短く列挙してください。\n\n${text}`;
  return {
    state: signals,
    messages: [systemMessage(), { role: "user", content: body }],
    schema: REPO_ADVICE_SCHEMA,
    maxTokens: 900,
  };
}

export function buildPrCheckPrompt(prSignals: PrSignals): BuiltPrompt<PrSignals> {
  const text = renderPrSignalsText(prSignals);
  const body = `以下の Pull Request について、著者が答えられるべき理解度チェックの問いを3つ作ってください。\n採点や正解は出力しないでください（questions のみを返す）。\n\n${text}`;
  return {
    state: prSignals,
    messages: [systemMessage(), { role: "user", content: body }],
    schema: PR_CHECK_SCHEMA,
    maxTokens: 400,
  };
}

/** questionsVersion（lib/questions.ts）と同じ作法。文言・スキーマ・カタログの id 集合を
 *  変えると自動で版が変わり、保存済みの助言が再生成の対象になる。カタログの説明文の推敲
 *  だけでは版を変えない（id の増減のみ反映）── 1件40〜60秒かかる再生成を推敲のたびに
 *  誘発しないため。 */
export function advicePromptVersion(scope: AdviceScope): string {
  const schema = scope === "dev" ? DEVELOPER_ADVICE_SCHEMA : scope === "repo" ? REPO_ADVICE_SCHEMA : PR_CHECK_SCHEMA;
  const literal = JSON.stringify({
    system: ADVICE_SYSTEM_RULES,
    signalKeys: SIGNAL_KEYS,
    catalogIds: CATALOG_IDS,
    schema,
  });
  return createHash("sha256").update(literal).digest("hex").slice(0, 12) + "-" + scope;
}
