import "server-only";
import type { Category } from "@/lib/classify";
import { IMPACT_LEVELS, COMPLEXITY_LEVELS } from "@/lib/questions";
import {
  listPullRequests,
  listPrFiles,
  listPrReviews,
  listClassifications,
  type PullRequestRow,
  type ClassificationRow,
} from "@/lib/queries";

export const WEIGHTS_VERSION = "w1" as const;

export type ScoreWeights = {
  readonly base: number;
  readonly category: Readonly<Record<Category, number>>;
  readonly size: { readonly refLoc: number; readonly deletionRatio: number; readonly min: number; readonly max: number };
  readonly testBonus: { readonly threshold: number; readonly factor: number };
  readonly review: {
    readonly unit: number;
    readonly state: Readonly<Record<string, number>>;
    readonly perComment: number;
    readonly substantialBodyLen: number;
    readonly substantialBonus: number;
    readonly maxCountedPerPr: number;
  };
  readonly excludeBots: boolean;
  readonly smallSampleThreshold: number;
};

export const DEFAULT_WEIGHTS: ScoreWeights = {
  base: 10,
  category: {
    feat: 1.0,
    fix: 0.9,
    perf: 0.9,
    refactor: 0.7,
    test: 0.6,
    ci: 0.5,
    docs: 0.4,
    chore: 0.3,
    revert: 0.2,
    other: 0.5,
  },
  size: { refLoc: 300, deletionRatio: 0.5, min: 0.3, max: 1.6 },
  testBonus: { threshold: 0.7, factor: 1.08 },
  review: {
    unit: 2.5,
    state: { APPROVED: 1.0, CHANGES_REQUESTED: 2.0, COMMENTED: 1.2, DISMISSED: 0 },
    perComment: 0.25,
    substantialBodyLen: 120,
    substantialBonus: 0.3,
    maxCountedPerPr: 2,
  },
  excludeBots: true,
  smallSampleThreshold: 5,
};

/** confidence が低いほど中立(0.5)へ引き戻す。conf=1 で素通し、conf=0 で完全中立。 */
function shrink(x01: number, conf: number): number {
  const c = Math.min(Math.max(conf, 0), 1);
  return 0.5 + (x01 - 0.5) * c;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export type ScoreFactor = { name: string; value: number; note: string };

export type PrContribution = {
  number: number;
  title: string;
  category: Category;
  categorySource: "rule" | "jev";
  needsReview: boolean;
  score: number;
  factors: ScoreFactor[];
  lowConfidence: boolean;
  jevFailed: boolean;
  /** classifications にまだ行が無い（分類が一度も実行されていない）PR。 */
  classified: boolean;
};

export type ReviewContribution = {
  number: number;
  title: string;
  authorLogin: string | null;
  state: string;
  commentCount: number;
  score: number;
};

export type DeveloperScore = {
  login: string;
  authoringScore: number;
  reviewScore: number;
  total: number;
  lowConfidenceShare: number;
  fallbackCount: number;
  prCount: number;
  reviewCount: number;
  additions: number;
  deletions: number;
  categoryMix: Partial<Record<Category, number>>;
  smallSample: boolean;
  prs: PrContribution[];
  reviews: ReviewContribution[];
};

function effLoc(repoId: number, pr: PullRequestRow, w: ScoreWeights): number {
  const files = listPrFiles(repoId, pr.number).filter((f) => !f.generated);
  if (files.length === 0) {
    // ファイル一覧が無い場合は PR 全体の additions/deletions で代替する
    return pr.additions + w.size.deletionRatio * pr.deletions;
  }
  const additions = files.reduce((s, f) => s + f.additions, 0);
  const deletions = files.reduce((s, f) => s + f.deletions, 0);
  return additions + w.size.deletionRatio * deletions;
}

function sizeFactor(loc: number, w: ScoreWeights): number {
  const raw = Math.log(1 + Math.max(0, loc)) / Math.log(1 + w.size.refLoc);
  return clamp(raw, w.size.min, w.size.max);
}

function scorePr(
  repoId: number,
  pr: PullRequestRow,
  c: ClassificationRow | undefined,
  w: ScoreWeights,
): PrContribution {
  const category = (c?.category as Category) ?? "other";
  const loc = effLoc(repoId, pr, w);
  const sf = sizeFactor(loc, w);
  const catWeight = w.category[category] ?? w.category.other;

  const impactMax = IMPACT_LEVELS.length - 1;
  const complexityMax = COMPLEXITY_LEVELS.length - 1;

  const impact01 = c?.impact != null ? c.impact / impactMax : 0.5;
  const impactConf = c?.impact_conf ?? 0;
  const impactFactor = 0.5 + 1.0 * shrink(impact01, c?.impact != null ? impactConf : 0);

  const complexity01 = c?.complexity != null ? c.complexity / complexityMax : 0.5;
  const complexityConf = c?.complexity_conf ?? 0;
  const complexityFactor = 0.75 + 0.5 * shrink(complexity01, c?.complexity != null ? complexityConf : 0);

  const testFactor = (c?.tests_included ?? 0) >= w.testBonus.threshold ? w.testBonus.factor : 1.0;

  const score = w.base * catWeight * sf * impactFactor * complexityFactor * testFactor;

  const jevFailed = !!c?.jev_error;
  const lowConfidence =
    jevFailed || (c?.impact != null && impactConf < 0.5) || (c?.complexity != null && complexityConf < 0.5);

  const factors: ScoreFactor[] = [
    { name: "base", value: w.base, note: "基準点" },
    { name: "category", value: catWeight, note: `${category}` },
    { name: "size", value: sf, note: `実効LOC ${Math.round(loc)}行（生成物除く）` },
    {
      name: "impact",
      value: impactFactor,
      note: c?.impact != null ? `${c.impact}/${impactMax} · 確信 ${impactConf.toFixed(2)}` : "Jev未取得 — 中立値",
    },
    {
      name: "complexity",
      value: complexityFactor,
      note:
        c?.complexity != null
          ? `${c.complexity}/${complexityMax} · 確信 ${complexityConf.toFixed(2)}`
          : "Jev未取得 — 中立値",
    },
    { name: "test", value: testFactor, note: (c?.tests_included ?? 0) >= w.testBonus.threshold ? "テスト含む" : "" },
  ];

  return {
    number: pr.number,
    title: pr.title,
    category,
    categorySource: (c?.category_source as "rule" | "jev") ?? "rule",
    needsReview: !!c?.needs_review,
    score,
    factors,
    lowConfidence,
    jevFailed,
    classified: !!c,
  };
}

function scoreReview(
  repoId: number,
  authorLogin: string,
  reviews: { number: number; title: string; reviewerLogin: string; state: string; commentCount: number; bodyLen: number }[],
  w: ScoreWeights,
): ReviewContribution[] {
  const byPr = new Map<number, typeof reviews>();
  for (const r of reviews) {
    if (r.reviewerLogin !== authorLogin) continue;
    const arr = byPr.get(r.number) ?? [];
    arr.push(r);
    byPr.set(r.number, arr);
  }
  const out: ReviewContribution[] = [];
  for (const [, arr] of byPr) {
    const counted = arr.slice(0, w.review.maxCountedPerPr);
    for (const r of counted) {
      const base = w.review.state[r.state] ?? 0;
      const bonus = Math.min(1.0, r.commentCount * w.review.perComment + (r.bodyLen >= w.review.substantialBodyLen ? w.review.substantialBonus : 0));
      out.push({
        number: r.number,
        title: r.title,
        authorLogin,
        state: r.state,
        commentCount: r.commentCount,
        score: (base + bonus) * w.review.unit,
      });
    }
  }
  return out;
}

export type RepoScoreResult = {
  weightsVersion: string;
  developers: DeveloperScore[];
};

export function scoreRepo(repoId: number, w: ScoreWeights = DEFAULT_WEIGHTS): RepoScoreResult {
  const prs = listPullRequests(repoId);
  const classifications = new Map(listClassifications(repoId).map((c) => [c.number, c]));

  const flatReviews: { number: number; title: string; reviewerLogin: string; state: string; commentCount: number; bodyLen: number }[] = [];
  for (const pr of prs) {
    for (const rv of listPrReviews(repoId, pr.number)) {
      if (w.excludeBots && rv.reviewer_is_bot) continue;
      if (rv.reviewer_login === pr.author_login) continue; // 自己レビューは数えない
      flatReviews.push({
        number: pr.number,
        title: pr.title,
        reviewerLogin: rv.reviewer_login,
        state: rv.state,
        commentCount: rv.comment_count,
        bodyLen: rv.body_len,
      });
    }
  }

  const authors = new Set<string>();
  for (const pr of prs) {
    if (w.excludeBots && pr.author_is_bot) continue;
    if (pr.author_login) authors.add(pr.author_login);
  }
  for (const r of flatReviews) authors.add(r.reviewerLogin);

  const developers: DeveloperScore[] = [];
  for (const login of authors) {
    const ownPrs = prs.filter((pr) => pr.author_login === login && !(w.excludeBots && pr.author_is_bot));
    const prContribs = ownPrs.map((pr) => scorePr(repoId, pr, classifications.get(pr.number), w));
    const reviewContribs = scoreReview(repoId, login, flatReviews, w);

    const authoringScore = prContribs.reduce((s, p) => s + p.score, 0);
    const reviewScore = reviewContribs.reduce((s, r) => s + r.score, 0);
    const lowConfScore = prContribs.filter((p) => p.lowConfidence).reduce((s, p) => s + p.score, 0);

    const categoryMix: Partial<Record<Category, number>> = {};
    for (const p of prContribs) {
      if (!p.classified) continue;
      categoryMix[p.category] = (categoryMix[p.category] ?? 0) + 1;
    }

    developers.push({
      login,
      authoringScore,
      reviewScore,
      total: authoringScore + reviewScore,
      lowConfidenceShare: authoringScore > 0 ? lowConfScore / authoringScore : 0,
      fallbackCount: prContribs.filter((p) => p.jevFailed).length,
      prCount: ownPrs.length,
      reviewCount: reviewContribs.length,
      additions: ownPrs.reduce((s, p) => s + p.additions, 0),
      deletions: ownPrs.reduce((s, p) => s + p.deletions, 0),
      categoryMix,
      smallSample: ownPrs.length < w.smallSampleThreshold,
      prs: prContribs.sort((a, b) => b.number - a.number),
      reviews: reviewContribs.sort((a, b) => b.number - a.number),
    });
  }

  developers.sort((a, b) => b.total - a.total);
  return { weightsVersion: WEIGHTS_VERSION, developers };
}
