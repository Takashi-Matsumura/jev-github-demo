import "server-only";
import type { JevAnswer, JevChoiceAnswer, JevScoreAnswer } from "@/lib/jev";
import type { ClassificationInput } from "@/lib/queries";

/** カテゴリ判定を無条件で採用する下限。これ未満は保存するが「確認待ち」の印を付ける。 */
export const CATEGORY_APPLY_PROB = 0.7;
export const CATEGORY_APPLY_CONF = 0.5;
/** score / noul をスコアに反映する際に信頼できるとみなす confidence の下限。 */
export const JUDGEMENT_TRUST_CONF = 0.5;

export const CATEGORIES = [
  "feat",
  "fix",
  "perf",
  "refactor",
  "test",
  "docs",
  "ci",
  "chore",
  "revert",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type RuleResult = {
  /** 単一カテゴリに確定した場合のみ値が入る。複数ルールが競合、または何も当たらなければ null。 */
  category: Category | null;
  evidence: string[];
};

const LABEL_MAP: Record<string, Category> = {
  bug: "fix",
  fix: "fix",
  bugfix: "fix",
  security: "fix",
  enhancement: "feat",
  feature: "feat",
  performance: "perf",
  perf: "perf",
  refactor: "refactor",
  refactoring: "refactor",
  documentation: "docs",
  docs: "docs",
  test: "test",
  tests: "test",
  testing: "test",
  ci: "ci",
  "ci/cd": "ci",
  build: "ci",
  dependencies: "ci",
  chore: "chore",
  maintenance: "chore",
  revert: "revert",
};

/** Conventional Commits の接頭辞。`feat:` だけでなくブランチ名由来の `feat/` も拾う。 */
const TITLE_PREFIX_RE = /^(feat|feature|fix|bugfix|perf|refactor|test|docs|doc|ci|build|chore|revert)(\([^)]*\))?[:/]/i;
const TITLE_PREFIX_MAP: Record<string, Category> = {
  feat: "feat",
  feature: "feat",
  fix: "fix",
  bugfix: "fix",
  perf: "perf",
  refactor: "refactor",
  test: "test",
  docs: "docs",
  doc: "docs",
  ci: "ci",
  build: "ci",
  chore: "chore",
  revert: "revert",
};

function fromLabels(labels: string[]): Category | null {
  const found = new Set<Category>();
  for (const label of labels) {
    const cat = LABEL_MAP[label.toLowerCase().trim()];
    if (cat) found.add(cat);
  }
  return found.size === 1 ? [...found][0] : null;
}

function fromTitle(title: string): Category | null {
  const m = title.trim().match(TITLE_PREFIX_RE);
  if (!m) return null;
  return TITLE_PREFIX_MAP[m[1].toLowerCase()] ?? null;
}

function fromFilePaths(paths: string[]): Category | null {
  if (paths.length === 0) return null;
  if (paths.every((p) => /\.mdx?$/i.test(p) || /^docs\//i.test(p))) return "docs";
  if (paths.every((p) => /\.(test|spec)\.[jt]sx?$/i.test(p) || /(^|\/)(__tests__)\//i.test(p))) return "test";
  if (paths.every((p) => /^\.github\/workflows\//i.test(p))) return "ci";
  return null;
}

/**
 * 決定的ルールでカテゴリを判定する。複数の判定源が食い違う場合は確定させず、
 * Jev の判断に委ねる（`category: null`）。
 */
export function classifyByRules(input: { title: string; labels: string[]; filePaths: string[] }): RuleResult {
  const evidence: string[] = [];
  const candidates = new Set<Category>();

  const byLabel = fromLabels(input.labels);
  if (byLabel) {
    candidates.add(byLabel);
    evidence.push(`ラベル一致 → ${byLabel}`);
  }

  const byTitle = fromTitle(input.title);
  if (byTitle) {
    candidates.add(byTitle);
    evidence.push(`タイトル接頭辞一致 → ${byTitle}`);
  }

  const byFiles = fromFilePaths(input.filePaths);
  if (byFiles) {
    candidates.add(byFiles);
    evidence.push(`変更ファイルのパターン一致 → ${byFiles}`);
  }

  if (candidates.size === 1) {
    return { category: [...candidates][0], evidence };
  }
  if (candidates.size > 1) {
    evidence.push(`判定源が競合（${[...candidates].join(" / ")}）のため Jev に判定させます`);
    return { category: null, evidence };
  }
  evidence.push("ルールでは判定できないため Jev に判定させます");
  return { category: null, evidence };
}

function isChoice(a: JevAnswer | undefined): a is JevChoiceAnswer {
  return !!a && a.type === "choice";
}
function isScore(a: JevAnswer | undefined): a is JevScoreAnswer {
  return !!a && a.type === "score";
}
function isNoul(a: JevAnswer | undefined): a is Extract<JevAnswer, { type: "noul" }> {
  return !!a && a.type === "noul";
}

/**
 * ルール層の結果と Jev の回答（`category` 質問を送っていない場合は答えも無い）を合成し、
 * `classifications` テーブルへそのまま書ける形にする。
 */
export function interpretAnswers(
  ruleResult: RuleResult,
  answers: Record<string, JevAnswer>,
): Omit<
  ClassificationInput,
  "jevExchangeJson" | "jevInputTokens" | "jevOutputTokens" | "jevElapsedMs" | "jevError" | "model" | "questionsVersion"
> {
  const evidence = [...ruleResult.evidence];
  let category: Category;
  let categorySource: "rule" | "jev";
  let categoryConfidence: number | null = null;
  let categoryTopProb: number | null = null;
  let needsReview = false;

  if (ruleResult.category) {
    category = ruleResult.category;
    categorySource = "rule";
    categoryConfidence = 1;
  } else {
    const catAnswer = answers.category;
    if (isChoice(catAnswer) && CATEGORIES.includes(catAnswer.choice as Category)) {
      category = catAnswer.choice as Category;
      categorySource = "jev";
      categoryConfidence = catAnswer.confidence;
      categoryTopProb = Math.max(...Object.values(catAnswer.probabilities));
      if (categoryTopProb < CATEGORY_APPLY_PROB || catAnswer.confidence < CATEGORY_APPLY_CONF) {
        needsReview = true;
        evidence.push(
          `Jev の確信度が低いため確認待ち（確率 ${categoryTopProb.toFixed(2)} / confidence ${catAnswer.confidence.toFixed(2)}）`,
        );
      }
    } else {
      category = "other";
      categorySource = "jev";
      needsReview = true;
      evidence.push("Jev からも判定を得られなかったため other として保存し、確認待ちにしました");
    }
  }

  const impactAns = isScore(answers.impact) ? answers.impact : undefined;
  const complexityAns = isScore(answers.complexity) ? answers.complexity : undefined;
  const riskAns = isScore(answers.risk) ? answers.risk : undefined;

  if ((impactAns && impactAns.confidence < JUDGEMENT_TRUST_CONF) || (complexityAns && complexityAns.confidence < JUDGEMENT_TRUST_CONF)) {
    needsReview = true;
  }

  return {
    category,
    categorySource,
    categoryEvidence: evidence,
    categoryConfidence,
    categoryTopProb,
    needsReview,
    impact: impactAns?.score ?? null,
    impactConf: impactAns?.confidence ?? null,
    complexity: complexityAns?.score ?? null,
    complexityConf: complexityAns?.confidence ?? null,
    risk: riskAns?.score ?? null,
    riskConf: riskAns?.confidence ?? null,
    userFacing: isNoul(answers.user_facing) ? answers.user_facing.noul : null,
    breakingChange: isNoul(answers.breaking_change) ? answers.breaking_change.noul : null,
    testsIncluded: isNoul(answers.tests_included) ? answers.tests_included.noul : null,
    scopeCoherence: isNoul(answers.scope_coherence) ? answers.scope_coherence.noul : null,
    titleMatchesDiff: isNoul(answers.title_matches_diff) ? answers.title_matches_diff.noul : null,
    jevAskedCategory: !ruleResult.category,
  };
}
