import "server-only";
import { LEARNING_CATALOG } from "@/lib/learning-catalog";

/**
 * Gemma の応答（JSON.parse 済みの unknown）を型付きの Advice に変換する。
 * lib/classify.ts の役割（Jev の回答を解釈する）と対になる層。
 *
 * 二重の安全網:
 * 1段目 — json_schema の enum（grammar で弾かれるので、存在しない id は文法的に出力できない）
 * 2段目 — ここで LEARNING_CATALOG に実在するか検査し、外れたものは捨てて needs_review を立てる
 *          （lib/classify.ts が確信度不足で needs_review を立てるのと同じ作法）
 */

export type AdvicePoint = { signal: string; text: string };
export type AdviceTheme = { id: string; reason: string };

export type DeveloperAdvice = {
  summary: string;
  strengths: AdvicePoint[];
  watchpoints: AdvicePoint[];
  themes: AdviceTheme[];
  questions_for_1on1: string[];
};

export type RepoAdvice = {
  summary: string;
  team_patterns: AdvicePoint[];
  themes: AdviceTheme[];
  undetermined: string[];
};

export type PrCheckQuestion = { text: string; focus: string };
export type PrCheck = { questions: PrCheckQuestion[] };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function isString(v: unknown): v is string {
  return typeof v === "string";
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}
function isPointArray(v: unknown): v is AdvicePoint[] {
  return Array.isArray(v) && v.every((x) => isObject(x) && isString(x.signal) && isString(x.text));
}
function isThemeArray(v: unknown): v is AdviceTheme[] {
  return Array.isArray(v) && v.every((x) => isObject(x) && isString(x.id) && isString(x.reason));
}

/** カタログに実在する id だけを残す。1件でも落ちたら needsReview を立てる。 */
function sanitizeThemes(themes: AdviceTheme[]): { themes: AdviceTheme[]; needsReview: boolean } {
  const valid = themes.filter((t) => LEARNING_CATALOG.some((c) => c.id === t.id));
  return { themes: valid, needsReview: valid.length !== themes.length };
}

export function interpretDeveloperAdvice(parsed: unknown): { advice: DeveloperAdvice; needsReview: boolean } {
  if (!isObject(parsed)) throw new Error("Gemma の応答がオブジェクトではありません");
  const { summary, strengths, watchpoints, themes, questions_for_1on1 } = parsed;
  if (!isString(summary) || !isPointArray(strengths) || !isPointArray(watchpoints) || !isThemeArray(themes) || !isStringArray(questions_for_1on1)) {
    throw new Error("Gemma の応答が期待した形と一致しません（開発者向け）");
  }
  const sanitized = sanitizeThemes(themes);
  return {
    advice: { summary, strengths, watchpoints, themes: sanitized.themes, questions_for_1on1 },
    needsReview: sanitized.needsReview,
  };
}

export function interpretRepoAdvice(parsed: unknown): { advice: RepoAdvice; needsReview: boolean } {
  if (!isObject(parsed)) throw new Error("Gemma の応答がオブジェクトではありません");
  const { summary, team_patterns, themes, undetermined } = parsed;
  if (!isString(summary) || !isPointArray(team_patterns) || !isThemeArray(themes) || !isStringArray(undetermined)) {
    throw new Error("Gemma の応答が期待した形と一致しません（リポジトリ向け）");
  }
  const sanitized = sanitizeThemes(themes);
  return {
    advice: { summary, team_patterns, themes: sanitized.themes, undetermined },
    needsReview: sanitized.needsReview,
  };
}

export function interpretPrCheck(parsed: unknown): { advice: PrCheck; needsReview: boolean } {
  if (!isObject(parsed) || !Array.isArray(parsed.questions)) {
    throw new Error("Gemma の応答が期待した形と一致しません（PR理解度チェック）");
  }
  const raw = parsed.questions as unknown[];
  const questions = raw.filter((q): q is PrCheckQuestion => isObject(q) && isString(q.text) && isString(q.focus));
  return { advice: { questions }, needsReview: questions.length !== raw.length };
}
