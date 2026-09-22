import "server-only";
import { createHash } from "node:crypto";
import type { Category } from "@/lib/classify";
import { IMPACT_LEVELS, COMPLEXITY_LEVELS, buildPrState, type PrState } from "@/lib/questions";
import { scoreRepo, effLoc, shrink, DEFAULT_WEIGHTS, type ScoreWeights } from "@/lib/score";
import { leadTimeHours, sizeMedianLoc, leadTimeMedianHours } from "@/lib/analytics";
import {
  listPullRequests,
  listPrFiles,
  listPrReviews,
  listClassifications,
  getClassification,
  getPullRequest,
  getRepoById,
  type PullRequestRow,
  type PrFileRow,
  type ClassificationRow,
} from "@/lib/queries";

/**
 * 「成長への助言」の土台。LLM を一切呼ばない ── ここで確定させた数値だけが真実で、
 * lib/gemma.ts はこの数値の読み方とカタログからの選択だけを行う（数値は作らせない）。
 *
 * 各指標は必ず「サンプル数（n）」と「判定できたか（judged）」を持つ。judged が false の
 * ときは value を null にし、UI にもプロンプトにも数値を出さない ── 「0」と「判定不能」を
 * 混同しないことが、この機能全体で一番重要な約束。
 */

// ─── 版管理 ──────────────────────────────────────────────────────

const TREND_MIN_HALF = 3; // 前半/後半それぞれ最低3件、合計6件未満は判定不能

/** DOMAIN_RULES・しきい値の内容ハッシュ。questions.ts の questionsVersion と同じ作法で、
 *  分類ロジックを変えると自動で版が変わり、保存済みの助言が再生成の対象になる。 */
export function signalsVersion(): string {
  const literal = JSON.stringify({
    domainRules: DOMAIN_RULES.map((r) => ({ key: r.key, re: r.re.source })),
    thresholds: {
      testBonus: DEFAULT_WEIGHTS.testBonus.threshold,
      smallSample: DEFAULT_WEIGHTS.smallSampleThreshold,
      trendMinHalf: TREND_MIN_HALF,
    },
  });
  return createHash("sha256").update(literal).digest("hex").slice(0, 12);
}

// ─── 共通の小道具 ────────────────────────────────────────────────

function meanOf(values: number[]): number | null {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function aggMean(prs: PullRequestRow[], get: (pr: PullRequestRow) => number | null): { n: number; value: number | null } {
  const vals = prs.map(get).filter((v): v is number => v != null);
  return { n: vals.length, value: meanOf(vals) };
}

/** 1 つの観測事実。judged が false のとき value は null で、UI にもプロンプトにも数値を出さない。 */
export type Signal = {
  key: string;
  label: string;
  value: number | null;
  n: number;
  judged: boolean;
  unit: "rate" | "level" | "loc" | "hours" | "count";
  /** 根拠の一行。除外件数・しきい値・判定不能の理由を必ず書く。ScoreFormula の note と同じ役割。 */
  note: string;
};

function sig(key: string, label: string, agg: { n: number; value: number | null }, unit: Signal["unit"], min: number): Signal {
  const judged = agg.n >= min && agg.value != null;
  return {
    key,
    label,
    unit,
    value: judged ? agg.value : null,
    n: agg.n,
    judged,
    note: judged ? `n=${agg.n}` : `判定不能（n=${agg.n}、最低${min}件必要）`,
  };
}

// ─── classifications 由来の値（confidence の扱いを一箇所に集約） ──────
//
// impact/complexity は shrink（lib/score.ts と同式）で中立値へ寄せた後の値を使う。
// noul 列（tests_included 等）は confidence 列を持たないのでそのまま使う。
// jev_error がある行・classifications に行が無い PR は、どの指標からも除外する
// （中立値0.5が平均に紛れ込むと「平均が0.5に寄っただけ」の見かけになるため）。
// needs_review の行は除外しない ── 除外は「自信のない判定＝都合の悪いデータ」を隠すことになる。

function complexityShrunk(c: ClassificationRow | undefined): number | null {
  if (!c || c.jev_error || c.complexity == null) return null;
  const x01 = c.complexity / (COMPLEXITY_LEVELS.length - 1);
  return shrink(x01, c.complexity_conf ?? 0);
}

function impactShrunk(c: ClassificationRow | undefined): number | null {
  if (!c || c.jev_error || c.impact == null) return null;
  const x01 = c.impact / (IMPACT_LEVELS.length - 1);
  return shrink(x01, c.impact_conf ?? 0);
}

function testsByJevFlag(c: ClassificationRow | undefined, w: ScoreWeights): number | null {
  if (!c || c.jev_error || c.tests_included == null) return null;
  return c.tests_included >= w.testBonus.threshold ? 1 : 0;
}

function scopeCoherenceValue(c: ClassificationRow | undefined): number | null {
  if (!c || c.jev_error || c.scope_coherence == null) return null;
  return c.scope_coherence;
}

function titleMatchesValue(c: ClassificationRow | undefined): number | null {
  if (!c || c.jev_error || c.title_matches_diff == null) return null;
  return c.title_matches_diff;
}

function changesRequestedFlag(repoId: number, pr: PullRequestRow): number {
  const reviews = listPrReviews(repoId, pr.number).filter((r) => !r.reviewer_is_bot && r.reviewer_login !== pr.author_login);
  return reviews.some((r) => r.state === "CHANGES_REQUESTED") ? 1 : 0;
}

// ─── 技術領域の分類 ──────────────────────────────────────────────

export type DomainKey = "test" | "ci" | "docs" | "db" | "api" | "ui" | "style" | "config" | "infra" | "logic" | "other";

export const DOMAIN_LABELS: Record<DomainKey, string> = {
  test: "テスト",
  ci: "CI/ビルド",
  docs: "ドキュメント",
  db: "データベース",
  api: "API",
  ui: "UI/画面",
  style: "スタイル",
  config: "設定",
  infra: "インフラ",
  logic: "ロジック",
  other: "その他",
};

/** 既存のカテゴリ色（10色）を使い回して11番目の domain "other" だけ var(--muted) にする。
 *  analytics.ts の REVIEW_STATE_COLORS / OTHER_COLOR と同じ考え方（固定色・生成しない）。 */
export const DOMAIN_COLORS: Record<DomainKey, string> = {
  test: "var(--cat-test)",
  ci: "var(--cat-ci)",
  docs: "var(--cat-docs)",
  db: "var(--cat-perf)",
  api: "var(--cat-feat)",
  ui: "var(--cat-refactor)",
  style: "var(--cat-fix)",
  config: "var(--cat-chore)",
  infra: "var(--cat-revert)",
  logic: "var(--cat-other)",
  other: "var(--muted)",
};

/** 先勝ちで評価する。test を最上位に置くのは、テストファイルが ui/logic のパターンにも
 *  当たってしまい「テストを書いた」が「UI を触った」に化けるのを防ぐため。 */
const DOMAIN_RULES: { key: DomainKey; re: RegExp }[] = [
  { key: "test", re: /\.(test|spec)\.[jt]sx?$|(^|\/)__tests__\// },
  { key: "ci", re: /^\.github\/workflows\// },
  { key: "docs", re: /\.mdx?$|^docs\// },
  { key: "db", re: /schema\.sql$|(^|\/)migrations?\// },
  { key: "api", re: /^app\/api\// },
  { key: "ui", re: /\.tsx$|^components\// },
  { key: "style", re: /\.css$/ },
  { key: "config", re: /^(package(-lock)?\.json|tsconfig.*\.json|eslint\.config\.\w+|postcss\.config\.\w+|next\.config\.\w+|\.env(\..*)?)$/ },
  { key: "infra", re: /^(Dockerfile|docker-compose\.ya?ml|vercel\.json|\.github\/)/ },
  { key: "logic", re: /\.([jt]sx?|mjs|cjs)$/ },
];

export function classifyDomain(path: string): DomainKey {
  for (const rule of DOMAIN_RULES) {
    if (rule.re.test(path)) return rule.key;
  }
  return "other";
}

function testsByPathFlag(repoId: number, pr: PullRequestRow): number {
  return listPrFiles(repoId, pr.number).some((f) => !f.generated && classifyDomain(f.path) === "test") ? 1 : 0;
}

function domainsOf(repoId: number, prs: PullRequestRow[]): Set<DomainKey> {
  const s = new Set<DomainKey>();
  for (const pr of prs) {
    for (const f of listPrFiles(repoId, pr.number)) {
      if (f.generated) continue;
      s.add(classifyDomain(f.path));
    }
  }
  return s;
}

function fileLoc(f: PrFileRow, w: ScoreWeights): number {
  return f.additions + w.size.deletionRatio * f.deletions;
}

export type DomainStat = { key: DomainKey; label: string; prs: number; loc: number; share: number };

export type DomainCoverage = {
  stats: DomainStat[];
  /** 触れた領域数 / そのリポジトリに実在する領域数。カタログ全体を分母にすると、
   *  infra が存在しないリポジトリで不当に低く出るため、分母はリポジトリ側から取る。 */
  coverage: Signal;
  /** HHI = Σ share²。1 に近いほど 1 領域に集中。 */
  concentration: Signal;
  /** 1/HHI。「実質いくつの領域を触っているか」。HHI より読みやすいので併記する。 */
  effectiveDomains: Signal;
  /** 直近半分で初めて触れた領域。学習の直接的な証拠になる。合計 6 件未満のときは空。 */
  newDomains: DomainKey[];
};

function computeDomainCoverage(repoId: number, prs: PullRequestRow[], w: ScoreWeights): DomainCoverage {
  const locByDomain = new Map<DomainKey, number>();
  const prsByDomain = new Map<DomainKey, Set<number>>();
  let totalLoc = 0;

  for (const pr of prs) {
    for (const f of listPrFiles(repoId, pr.number)) {
      if (f.generated) continue;
      const domain = classifyDomain(f.path);
      const loc = fileLoc(f, w);
      locByDomain.set(domain, (locByDomain.get(domain) ?? 0) + loc);
      totalLoc += loc;
      const set = prsByDomain.get(domain) ?? new Set<number>();
      set.add(pr.number);
      prsByDomain.set(domain, set);
    }
  }

  const repoDomains = domainsOf(repoId, listPullRequests(repoId));
  const touchedDomains = new Set(locByDomain.keys());

  const stats: DomainStat[] = [...locByDomain.entries()]
    .map(([key, loc]) => ({
      key,
      label: DOMAIN_LABELS[key],
      prs: prsByDomain.get(key)?.size ?? 0,
      loc: Math.round(loc),
      share: totalLoc > 0 ? loc / totalLoc : 0,
    }))
    .sort((a, b) => b.loc - a.loc);

  const hhi = stats.reduce((s, d) => s + d.share ** 2, 0);
  const denom = repoDomains.size;

  return {
    stats,
    coverage: {
      key: "domain_coverage",
      label: "触れた領域の広さ",
      value: denom > 0 && prs.length > 0 ? touchedDomains.size / denom : null,
      n: prs.length,
      judged: denom > 0 && prs.length > 0,
      unit: "rate",
      note: denom > 0 && prs.length > 0 ? `${touchedDomains.size}/${denom} 領域` : "判定不能（変更ファイルの情報がありません）",
    },
    concentration: {
      key: "domain_concentration",
      label: "領域の集中度（HHI）",
      value: totalLoc > 0 ? hhi : null,
      n: prs.length,
      judged: totalLoc > 0,
      unit: "rate",
      note: totalLoc > 0 ? "1 に近いほど 1 領域に集中" : "判定不能（実効LOCが0）",
    },
    effectiveDomains: {
      key: "domain_effective",
      label: "実質的な領域数",
      value: totalLoc > 0 && hhi > 0 ? 1 / hhi : null,
      n: prs.length,
      judged: totalLoc > 0 && hhi > 0,
      unit: "count",
      note: "1/HHI。触れている領域の実質的な数",
    },
    newDomains: [], // buildCore が computeNewDomains() の結果で上書きする
  };
}

function computeNewDomains(repoId: number, mergedPrsAsc: PullRequestRow[]): DomainKey[] {
  const half = Math.floor(mergedPrsAsc.length / 2);
  if (half < TREND_MIN_HALF) return [];
  const early = mergedPrsAsc.slice(0, half);
  const recent = mergedPrsAsc.slice(mergedPrsAsc.length - half);
  const earlyDomains = domainsOf(repoId, early);
  const recentDomains = domainsOf(repoId, recent);
  return [...recentDomains].filter((d) => !earlyDomains.has(d));
}

// ─── complexity / impact のトレンド ────────────────────────────────

export type Trend = {
  key: string;
  label: string;
  early: number | null;
  recent: number | null;
  delta: number | null;
  nEarly: number;
  nRecent: number;
  judged: boolean;
  note: string;
};

function buildTrends(
  repoId: number,
  mergedPrsAsc: PullRequestRow[],
  classifications: Map<number, ClassificationRow>,
  w: ScoreWeights,
): Trend[] {
  const half = Math.floor(mergedPrsAsc.length / 2);
  const judgedOverall = half >= TREND_MIN_HALF;
  const early = mergedPrsAsc.slice(0, half);
  const recent = mergedPrsAsc.slice(mergedPrsAsc.length - half);

  const defs: { key: string; label: string; agg: "mean" | "median"; get: (pr: PullRequestRow) => number | null }[] = [
    { key: "complexity", label: "複雑度の平均（confidence で中立値へ寄せた後）", agg: "mean", get: (pr) => complexityShrunk(classifications.get(pr.number)) },
    { key: "impact", label: "影響度の平均（confidence で中立値へ寄せた後）", agg: "mean", get: (pr) => impactShrunk(classifications.get(pr.number)) },
    { key: "size", label: "実効LOC中央値（生成物除く）", agg: "median", get: (pr) => effLoc(repoId, pr, w) },
    { key: "tests_by_path", label: "テスト同梱率（変更ファイルのパス由来）", agg: "mean", get: (pr) => testsByPathFlag(repoId, pr) },
  ];

  return defs.map((d) => {
    const earlyVals = early.map(d.get).filter((v): v is number => v != null);
    const recentVals = recent.map(d.get).filter((v): v is number => v != null);
    const earlyVal = d.agg === "mean" ? meanOf(earlyVals) : medianOf(earlyVals);
    const recentVal = d.agg === "mean" ? meanOf(recentVals) : medianOf(recentVals);
    const judged = judgedOverall && earlyVal != null && recentVal != null;
    return {
      key: d.key,
      label: d.label,
      early: judged ? earlyVal : null,
      recent: judged ? recentVal : null,
      delta: judged ? recentVal! - earlyVal! : null,
      nEarly: earlyVals.length,
      nRecent: recentVals.length,
      judged,
      note: !judgedOverall
        ? `判定不能（マージ済みPRが n=${mergedPrsAsc.length}、前半/後半それぞれ ${TREND_MIN_HALF} 件必要）`
        : judged
          ? `前半 n=${earlyVals.length} → 後半 n=${recentVals.length}`
          : "判定不能（該当する判定値を持つPRがありません）",
    };
  });
}

// ─── 品質（テスト・説明力） ────────────────────────────────────────

function buildQualitySignals(
  repoId: number,
  prs: PullRequestRow[],
  classifications: Map<number, ClassificationRow>,
  w: ScoreWeights,
): Signal[] {
  const min = w.smallSampleThreshold;
  return [
    sig("tests_by_path", "テスト同梱率（変更ファイルのパス由来・Jev不要）", aggMean(prs, (pr) => testsByPathFlag(repoId, pr)), "rate", min),
    sig("tests_by_jev", "テスト同梱率（Jev判定）", aggMean(prs, (pr) => testsByJevFlag(classifications.get(pr.number), w)), "rate", min),
    sig("scope_coherence", "PRのまとまり（1つの目的に収まっているか）", aggMean(prs, (pr) => scopeCoherenceValue(classifications.get(pr.number))), "rate", min),
    sig("title_matches_diff", "説明と差分の一致度", aggMean(prs, (pr) => titleMatchesValue(classifications.get(pr.number))), "rate", min),
  ];
}

// ─── レビューする側の活動量（理解の代理指標） ───────────────────────

type GivenReview = { number: number; authorLogin: string | null; state: string; commentCount: number; bodyLen: number };

function collectGivenReviews(repoId: number, allPrs: PullRequestRow[], login: string | null): GivenReview[] {
  const out: GivenReview[] = [];
  for (const pr of allPrs) {
    for (const rv of listPrReviews(repoId, pr.number)) {
      if (rv.reviewer_is_bot) continue;
      if (rv.reviewer_login === pr.author_login) continue; // 自己レビューは数えない（score.ts と同じ除外）
      if (login && rv.reviewer_login !== login) continue;
      out.push({ number: pr.number, authorLogin: pr.author_login, state: rv.state, commentCount: rv.comment_count, bodyLen: rv.body_len });
    }
  }
  return out;
}

function buildReviewSignals(reviews: GivenReview[], subjectPrCount: number, w: ScoreWeights, noReviewCulture: boolean): Signal[] {
  const min = w.smallSampleThreshold;
  const total = reviews.length;
  const substantial = reviews.filter((r) => r.bodyLen >= w.review.substantialBodyLen || r.commentCount > 0).length;
  const changesRequested = reviews.filter((r) => r.state === "CHANGES_REQUESTED").length;
  const distinctAuthors = new Set(reviews.map((r) => r.authorLogin).filter((a): a is string => !!a)).size;

  // このリポジトリ全体で他者レビューが1件も無い（単独開発）場合、0件を「活動不足」と
  // 読ませないために judged を落とす。devs/[login] の既存の文言に揃える。
  const soloNote = "このリポジトリに他者レビューが存在しません（単独開発）。0 件は活動不足ではなく、レビュー対象になる相手がいないことを意味します。";

  return [
    {
      key: "reviews_given",
      label: "他人のPRへのレビュー件数",
      value: total,
      n: total,
      judged: !noReviewCulture,
      unit: "count",
      note: noReviewCulture ? soloNote : `${total} 件`,
    },
    {
      key: "read_write_ratio",
      label: "読む量と書く量の比（レビュー件数 ÷ 自分のPR数）",
      value: subjectPrCount > 0 ? total / subjectPrCount : null,
      n: subjectPrCount,
      judged: !noReviewCulture && subjectPrCount > 0,
      unit: "rate",
      note: noReviewCulture ? soloNote : subjectPrCount > 0 ? `レビュー${total}件 ÷ PR${subjectPrCount}件` : "判定不能（PR実績がありません）",
    },
    {
      key: "substantial_review_share",
      label: "実質的なレビューの割合（コメント付き）",
      value: total > 0 ? substantial / total : null,
      n: total,
      judged: !noReviewCulture && total >= min,
      unit: "rate",
      note: noReviewCulture ? soloNote : total >= min ? `n=${total}` : `判定不能（n=${total}、最低${min}件必要）`,
    },
    {
      key: "distinct_authors_reviewed",
      label: "レビューした相手の人数",
      value: distinctAuthors,
      n: total,
      judged: !noReviewCulture,
      unit: "count",
      note: noReviewCulture ? soloNote : `${distinctAuthors} 人`,
    },
    {
      key: "changes_requested_share",
      label: "変更要求を行った割合",
      value: total > 0 ? changesRequested / total : null,
      n: total,
      judged: !noReviewCulture && total >= min,
      unit: "rate",
      note: noReviewCulture ? soloNote : total >= min ? `n=${total}` : `判定不能（n=${total}、最低${min}件必要）`,
    },
  ];
}

// ─── PR サイズ・リードタイム（既存の analytics.ts をそのまま呼ぶだけ） ────

function buildShapeSignals(repoId: number, login: string | undefined, w: ScoreWeights): Signal[] {
  const min = w.smallSampleThreshold;
  const prs = listPullRequests(repoId).filter((p) => (login ? p.author_login === login : true));
  const sizeMedian = sizeMedianLoc(repoId, login, w);
  const leadMedian = leadTimeMedianHours(repoId, login);
  return [
    {
      key: "size_median",
      label: "実効LOC中央値（生成物除く）",
      value: prs.length >= min ? sizeMedian : null,
      n: prs.length,
      judged: prs.length >= min && sizeMedian != null,
      unit: "loc",
      note: prs.length >= min ? `n=${prs.length}` : `判定不能（n=${prs.length}、最低${min}件必要）`,
    },
    {
      key: "lead_time_median",
      label: "リードタイム中央値（作成→マージ）",
      value: prs.length >= min ? leadMedian : null,
      n: prs.length,
      judged: prs.length >= min && leadMedian != null,
      unit: "hours",
      note: prs.length >= min ? `n=${prs.length}` : `判定不能（n=${prs.length}、最低${min}件必要）`,
    },
  ];
}

// ─── AI 併走 / 非併走の層別比較 ────────────────────────────────────

export type Strata = {
  key: string;
  label: string;
  unit: Signal["unit"];
  ai: { n: number; value: number | null };
  nonAi: { n: number; value: number | null };
  delta: number | null;
  judged: boolean;
  /** 判定不能の理由を必ず文章で持つ。 */
  note: string;
};

/** 因果の否定。プロンプトにも UI にも同じ文字列を流す（送信内容と表示内容の一致という既存の作法）。 */
export const STRATA_DISCLAIMER =
  "AI併走の有無で層別した比較であり、因果ではありません。併走率が高いことは理解が浅いことを意味しません。" +
  "併走する PR の方が難しい仕事に割り当てられている、という逆向きの説明も同じデータで等しく成り立ちます。";

function buildStrata(repoId: number, prs: PullRequestRow[], classifications: Map<number, ClassificationRow>, w: ScoreWeights): Strata[] {
  const min = w.smallSampleThreshold;
  // 母集団: コミット単位の真実を持つ PR のみ（analytics.ts の commitRate が body/unmeasured を
  // 分母から外すのと同じ理由）。
  const eligible = prs.filter((p) => p.ai_source === "trailer" || p.ai_source === "none");
  const aiPrs = eligible.filter((p) => p.ai_commit_count > 0);
  const nonAiPrs = eligible.filter((p) => p.ai_commit_count === 0);

  const defs: { key: string; label: string; unit: Signal["unit"]; agg: "mean" | "median"; get: (pr: PullRequestRow) => number | null }[] = [
    { key: "complexity", label: "複雑度の平均", unit: "level", agg: "mean", get: (pr) => complexityShrunk(classifications.get(pr.number)) },
    { key: "impact", label: "影響度の平均", unit: "level", agg: "mean", get: (pr) => impactShrunk(classifications.get(pr.number)) },
    { key: "tests_by_path", label: "テスト同梱率（パス由来）", unit: "rate", agg: "mean", get: (pr) => testsByPathFlag(repoId, pr) },
    { key: "tests_by_jev", label: "テスト同梱率（Jev判定）", unit: "rate", agg: "mean", get: (pr) => testsByJevFlag(classifications.get(pr.number), w) },
    { key: "scope_coherence", label: "PRのまとまり", unit: "rate", agg: "mean", get: (pr) => scopeCoherenceValue(classifications.get(pr.number)) },
    { key: "title_matches_diff", label: "説明と差分の一致度", unit: "rate", agg: "mean", get: (pr) => titleMatchesValue(classifications.get(pr.number)) },
    { key: "size", label: "実効LOC中央値", unit: "loc", agg: "median", get: (pr) => effLoc(repoId, pr, w) },
    { key: "lead_time", label: "リードタイム中央値", unit: "hours", agg: "median", get: (pr) => leadTimeHours(pr) },
    { key: "changes_requested", label: "変更要求を受けた割合", unit: "rate", agg: "mean", get: (pr) => changesRequestedFlag(repoId, pr) },
  ];

  return defs.map((d) => {
    const aiVals = aiPrs.map(d.get).filter((v): v is number => v != null);
    const nonAiVals = nonAiPrs.map(d.get).filter((v): v is number => v != null);
    const aiVal = d.agg === "mean" ? meanOf(aiVals) : medianOf(aiVals);
    const nonAiVal = d.agg === "mean" ? meanOf(nonAiVals) : medianOf(nonAiVals);
    const judged = aiVals.length >= min && nonAiVals.length >= min && aiVal != null && nonAiVal != null;
    return {
      key: d.key,
      label: d.label,
      unit: d.unit,
      ai: { n: aiVals.length, value: judged ? aiVal : null },
      nonAi: { n: nonAiVals.length, value: judged ? nonAiVal : null },
      delta: judged ? aiVal! - nonAiVal! : null,
      judged,
      note: judged
        ? `併走 n=${aiVals.length} / 非併走 n=${nonAiVals.length}`
        : `判定不能（併走 n=${aiVals.length} / 非併走 n=${nonAiVals.length}、両群 ${min} 件以上が必要）`,
    };
  });
}

// ─── リポジトリ全体（チーム）のメンバー一覧 ─────────────────────────

export type MemberRow = { login: string; prCount: number; total: number };

function buildMembers(repoId: number, w: ScoreWeights): MemberRow[] {
  const { developers } = scoreRepo(repoId, w);
  return developers.slice(0, 8).map((d) => ({ login: d.login, prCount: d.prCount, total: d.total }));
}

// ─── 公開の型・関数 ──────────────────────────────────────────────

export type GrowthSignals = {
  scope: "dev" | "repo";
  repo: string;
  login: string | null;
  prCount: number;
  classifiedCount: number;
  periodFrom: string | null;
  periodTo: string | null;
  domains: DomainCoverage;
  trends: Trend[];
  quality: Signal[];
  review: Signal[];
  shape: Signal[];
  strata: Strata[];
  /** repo スコープのみ。上位8名。 */
  members?: MemberRow[];
  signalsVersion: string;
};

function buildCore(repoId: number, scope: "dev" | "repo", login: string | null, w: ScoreWeights): GrowthSignals {
  const repoRow = getRepoById(repoId);
  const allPrs = listPullRequests(repoId);
  const subjectPrs = allPrs.filter((p) => !p.author_is_bot && (login ? p.author_login === login : true));
  const classifications = new Map(listClassifications(repoId).map((c) => [c.number, c]));

  const mergedAsc = subjectPrs
    .filter((p): p is PullRequestRow & { merged_at: string } => !!p.merged_at)
    .sort((a, b) => new Date(a.merged_at).getTime() - new Date(b.merged_at).getTime());

  const domains = computeDomainCoverage(repoId, subjectPrs, w);
  domains.newDomains = computeNewDomains(repoId, mergedAsc);

  const reviewsGiven = collectGivenReviews(repoId, allPrs, login);
  const noReviewCulture = collectGivenReviews(repoId, allPrs, null).length === 0;

  return {
    scope,
    repo: repoRow ? `${repoRow.owner}/${repoRow.name}` : "",
    login,
    prCount: subjectPrs.length,
    classifiedCount: subjectPrs.filter((p) => classifications.has(p.number)).length,
    periodFrom: mergedAsc[0]?.merged_at ?? null,
    periodTo: mergedAsc[mergedAsc.length - 1]?.merged_at ?? null,
    domains,
    trends: buildTrends(repoId, mergedAsc, classifications, w),
    quality: buildQualitySignals(repoId, subjectPrs, classifications, w),
    review: buildReviewSignals(reviewsGiven, subjectPrs.length, w, noReviewCulture),
    shape: buildShapeSignals(repoId, login ?? undefined, w),
    strata: buildStrata(repoId, subjectPrs, classifications, w),
    members: scope === "repo" ? buildMembers(repoId, w) : undefined,
    signalsVersion: signalsVersion(),
  };
}

export function buildDeveloperSignals(repoId: number, login: string, w: ScoreWeights = DEFAULT_WEIGHTS): GrowthSignals {
  return buildCore(repoId, "dev", login, w);
}

export function buildRepoSignals(repoId: number, w: ScoreWeights = DEFAULT_WEIGHTS): GrowthSignals {
  return buildCore(repoId, "repo", null, w);
}

// ─── PR 単体（理解度セルフチェック用） ──────────────────────────────

export type PrSignals = {
  scope: "pr";
  repo: string;
  number: number;
  title: string;
  /** lib/questions.ts の PrState をそのまま内包する。本文1,200字・パス40件の上限を再実装しない。 */
  state: PrState;
  domains: DomainKey[];
  classification: {
    classified: boolean;
    category: Category;
    categorySource: "rule" | "jev";
    impact: number | null;
    complexity: number | null;
    testsIncluded: number | null;
    scopeCoherence: number | null;
    titleMatchesDiff: number | null;
    jevFailed: boolean;
  };
  signalsVersion: string;
};

export function buildPrSignals(repoId: number, number: number): PrSignals | undefined {
  const repoRow = getRepoById(repoId);
  const pr = getPullRequest(repoId, number);
  if (!repoRow || !pr) return undefined;

  const c = getClassification(repoId, number);
  const files = listPrFiles(repoId, number);
  const domains = [...new Set(files.filter((f) => !f.generated).map((f) => classifyDomain(f.path)))];

  const state = buildPrState({
    owner: repoRow.owner,
    repo: repoRow.name,
    number: pr.number,
    title: pr.title,
    body: pr.body,
    labels: JSON.parse(pr.labels_json) as string[],
    files: files.map((f) => ({ path: f.path, generated: f.generated })),
    additions: pr.additions,
    deletions: pr.deletions,
    changedFileCount: pr.changed_files,
    commitCount: pr.commit_count,
    commitTitles: JSON.parse(pr.commit_titles) as string[],
    reviewCount: pr.review_count,
  });

  return {
    scope: "pr",
    repo: `${repoRow.owner}/${repoRow.name}`,
    number: pr.number,
    title: pr.title,
    state,
    domains,
    classification: {
      classified: !!c,
      category: (c?.category as Category) ?? "other",
      categorySource: (c?.category_source as "rule" | "jev") ?? "rule",
      impact: c?.impact ?? null,
      complexity: c?.complexity ?? null,
      testsIncluded: c?.tests_included ?? null,
      scopeCoherence: c?.scope_coherence ?? null,
      titleMatchesDiff: c?.title_matches_diff ?? null,
      jevFailed: !!c?.jev_error,
    },
    signalsVersion: signalsVersion(),
  };
}
