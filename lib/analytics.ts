import "server-only";
import { listPullRequests, listPrReviews, type PullRequestRow } from "@/lib/queries";
import { scoreRepo, effLoc, DEFAULT_WEIGHTS, type ScoreWeights } from "@/lib/score";
import type { ColumnDatum } from "@/components/chart/column-chart";
import type { HistogramBin } from "@/components/chart/histogram";
import type { StackedBarSegment } from "@/components/chart/stacked-bar";
import type { LegendItem } from "@/components/chart/legend";

const MAX_SERIES = 7;
const OTHER_COLOR = "var(--muted)";
// 固定順で割り当てる系列色。8色を超えたら足さず「その他」に畳む。
const SERIES_PALETTE = [
  "var(--cat-feat)",
  "var(--cat-fix)",
  "var(--cat-perf)",
  "var(--cat-refactor)",
  "var(--cat-test)",
  "var(--cat-ci)",
  "var(--cat-revert)",
];

function isoWeekStart(iso: string): { key: string; label: string; sortKey: number } {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7; // 月曜起点
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  const key = d.toISOString().slice(0, 10);
  const label = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return { key, label, sortKey: d.getTime() };
}

export type WeeklyActivity = {
  prCount: ColumnDatum[];
  score: ColumnDatum[];
  legend: LegendItem[];
};

/**
 * 週次のマージ PR 数・スコア合計を開発者別に積み上げる。上位 MAX_SERIES 名 + 「その他」に畳み、
 * 8色を超える色を生成しない（dataviz skill: 系列は固定順のパレットのみ、生成した9色目は使わない）。
 */
export function weeklyActivity(repoId: number, w: ScoreWeights = DEFAULT_WEIGHTS): WeeklyActivity {
  const { developers } = scoreRepo(repoId, w);
  const topLogins = [...developers]
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_SERIES)
    .map((d) => d.login);

  const colorOf = (login: string): string => {
    const idx = topLogins.indexOf(login);
    return idx >= 0 ? SERIES_PALETTE[idx] : OTHER_COLOR;
  };
  const seriesKey = (login: string): string => (topLogins.includes(login) ? login : "other");

  type WeekBucket = { label: string; sortKey: number; count: Map<string, number>; score: Map<string, number> };
  const weeks = new Map<string, WeekBucket>();

  // PrContribution は merged_at を持たないため、PR 行と突き合わせて週バケットを作る。
  const prRows = new Map(listPullRequests(repoId).map((p) => [p.number, p]));
  for (const dev of developers) {
    for (const p of dev.prs) {
      const row = prRows.get(p.number);
      if (!row?.merged_at) continue;
      const { key, label, sortKey } = isoWeekStart(row.merged_at);
      const bucket = weeks.get(key) ?? { label, sortKey, count: new Map(), score: new Map() };
      const sk = seriesKey(dev.login);
      bucket.count.set(sk, (bucket.count.get(sk) ?? 0) + 1);
      bucket.score.set(sk, (bucket.score.get(sk) ?? 0) + p.score);
      weeks.set(key, bucket);
    }
  }

  const sortedWeeks = [...weeks.values()].sort((a, b) => a.sortKey - b.sortKey);
  const seriesKeys = [...topLogins, "other"];

  const prCount: ColumnDatum[] = sortedWeeks.map((wk) => ({
    label: wk.label,
    segments: seriesKeys
      .filter((k) => (wk.count.get(k) ?? 0) > 0)
      .map((k) => ({ key: k, value: wk.count.get(k) ?? 0, color: k === "other" ? OTHER_COLOR : colorOf(k) })),
  }));
  const score: ColumnDatum[] = sortedWeeks.map((wk) => ({
    label: wk.label,
    segments: seriesKeys
      .filter((k) => (wk.score.get(k) ?? 0) > 0)
      .map((k) => ({ key: k, value: wk.score.get(k) ?? 0, color: k === "other" ? OTHER_COLOR : colorOf(k) })),
  }));

  const legend: LegendItem[] = [
    ...topLogins.map((login, i) => ({ key: login, label: login, color: SERIES_PALETTE[i] })),
    ...(developers.length > topLogins.length ? [{ key: "other", label: "その他", color: OTHER_COLOR }] : []),
  ];

  return { prCount, score, legend };
}

const LEAD_TIME_BUCKETS: { label: string; maxHours: number }[] = [
  { label: "〜1h", maxHours: 1 },
  { label: "1-6h", maxHours: 6 },
  { label: "6-24h", maxHours: 24 },
  { label: "1-3d", maxHours: 72 },
  { label: "3-7d", maxHours: 24 * 7 },
  { label: "7d〜", maxHours: Infinity },
];

function leadTimeHours(pr: PullRequestRow): number | null {
  if (!pr.merged_at) return null;
  return (new Date(pr.merged_at).getTime() - new Date(pr.created_at).getTime()) / 3_600_000;
}

/** リードタイム（作成→マージ）の対数ビン度数分布。login を渡すと本人のみに絞る。 */
export function leadTimeHistogram(repoId: number, login?: string): HistogramBin[] {
  const prs = listPullRequests(repoId).filter((p) => (login ? p.author_login === login : true));
  const bins = LEAD_TIME_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  for (const pr of prs) {
    const h = leadTimeHours(pr);
    if (h == null) continue;
    const idx = LEAD_TIME_BUCKETS.findIndex((b) => h <= b.maxHours);
    bins[idx === -1 ? bins.length - 1 : idx].count += 1;
  }
  return bins;
}

export function leadTimeMedianHours(repoId: number, login?: string): number | null {
  const prs = listPullRequests(repoId).filter((p) => (login ? p.author_login === login : true));
  const hours = prs.map(leadTimeHours).filter((h): h is number => h != null).sort((a, b) => a - b);
  if (hours.length === 0) return null;
  const mid = Math.floor(hours.length / 2);
  return hours.length % 2 === 0 ? (hours[mid - 1] + hours[mid]) / 2 : hours[mid];
}

export function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}分`;
  if (h < 24) return `${h.toFixed(1)}時間`;
  return `${(h / 24).toFixed(1)}日`;
}

const SIZE_BUCKETS: { label: string; maxLoc: number }[] = [
  { label: "〜20", maxLoc: 20 },
  { label: "20-60", maxLoc: 60 },
  { label: "60-180", maxLoc: 180 },
  { label: "180-500", maxLoc: 500 },
  { label: "500〜", maxLoc: Infinity },
];

/** 実効LOC（生成物除く。lib/score.ts の effLoc を再利用）の対数ビン度数分布。 */
export function sizeHistogram(repoId: number, login?: string, w: ScoreWeights = DEFAULT_WEIGHTS): HistogramBin[] {
  const prs = listPullRequests(repoId).filter((p) => (login ? p.author_login === login : true));
  const bins = SIZE_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  for (const pr of prs) {
    const loc = effLoc(repoId, pr, w);
    const idx = SIZE_BUCKETS.findIndex((b) => loc <= b.maxLoc);
    bins[idx === -1 ? bins.length - 1 : idx].count += 1;
  }
  return bins;
}

export function sizeMedianLoc(repoId: number, login?: string, w: ScoreWeights = DEFAULT_WEIGHTS): number | null {
  const prs = listPullRequests(repoId).filter((p) => (login ? p.author_login === login : true));
  const locs = prs.map((p) => effLoc(repoId, p, w)).sort((a, b) => a - b);
  if (locs.length === 0) return null;
  const mid = Math.floor(locs.length / 2);
  return locs.length % 2 === 0 ? (locs[mid - 1] + locs[mid]) / 2 : locs[mid];
}

const REVIEW_STATE_LABELS: Record<string, string> = {
  APPROVED: "承認",
  CHANGES_REQUESTED: "変更要求",
  COMMENTED: "コメント",
  DISMISSED: "取り下げ",
};
const REVIEW_STATE_COLORS: Record<string, string> = {
  APPROVED: "var(--review-approved)",
  CHANGES_REQUESTED: "var(--review-changes)",
  COMMENTED: "var(--review-commented)",
  DISMISSED: "var(--muted)",
};

export type ReviewBreakdown = { segments: StackedBarSegment[]; legend: LegendItem[]; total: number };

/** レビュー state 別の内訳。login を渡すと本人が行ったレビューのみに絞る（自己レビューは除外）。 */
export function reviewStateBreakdown(repoId: number, login?: string): ReviewBreakdown {
  const prs = listPullRequests(repoId);
  const counts = new Map<string, number>();
  let total = 0;
  for (const pr of prs) {
    for (const rv of listPrReviews(repoId, pr.number)) {
      if (rv.reviewer_is_bot) continue;
      if (rv.reviewer_login === pr.author_login) continue;
      if (login && rv.reviewer_login !== login) continue;
      counts.set(rv.state, (counts.get(rv.state) ?? 0) + 1);
      total += 1;
    }
  }
  const states = [...counts.keys()];
  const segments: StackedBarSegment[] = states.map((s) => ({
    key: s,
    label: REVIEW_STATE_LABELS[s] ?? s,
    value: counts.get(s) ?? 0,
    color: REVIEW_STATE_COLORS[s] ?? "var(--muted)",
  }));
  const legend: LegendItem[] = segments.map((s) => ({ key: s.key, label: s.label, color: s.color }));
  return { segments, legend, total };
}

export type AiStats = {
  totalCommits: number;
  aiCommits: number;
  /** コミット単位の AI 併走率。commit_count が取れている（trailer/none）PR のみを分母にする。 */
  commitRate: number;
  prsWithAi: number;
  prCount: number;
  agents: string[];
  sourceCounts: { trailer: number; body: number; none: number; unmeasured: number };
  /** GraphQL 経路で1件でもコミット単位の検出が走っていれば true。false なら「未計測」の意味しか持たない。 */
  measured: boolean;
};

/**
 * AI co-author の併走状況。Co-authored-by: トレーラは「申告」であって「計測」ではない —
 * トレーラを付けない運用のチームは 0% と表示されるが、それは AI を使っていないことの
 * 証明にはならない。スコアには一切影響しない、参考指標。
 *
 * body 由来・未計測の PR はコミット単位の真実を持たないため commitRate の分母から除外する
 * （混ぜると「未計測PRのコミット数」が分母だけ膨らませ、率が実態より低く出る）。
 */
export function aiCoauthorStats(repoId: number, login?: string): AiStats {
  const prs = listPullRequests(repoId).filter((p) => (login ? p.author_login === login : true));
  let totalCommits = 0;
  let aiCommits = 0;
  let prsWithAi = 0;
  const agents = new Set<string>();
  const sourceCounts = { trailer: 0, body: 0, none: 0, unmeasured: 0 };
  for (const pr of prs) {
    if (pr.ai_source === "trailer" || pr.ai_source === "none") {
      totalCommits += pr.commit_count;
      aiCommits += pr.ai_commit_count;
    }
    if (pr.ai_commit_count > 0 || pr.ai_source === "body") prsWithAi += 1;
    sourceCounts[pr.ai_source] += 1;
    for (const a of JSON.parse(pr.ai_agents) as string[]) agents.add(a);
  }
  return {
    totalCommits,
    aiCommits,
    commitRate: totalCommits > 0 ? aiCommits / totalCommits : 0,
    prsWithAi,
    prCount: prs.length,
    agents: [...agents],
    sourceCounts,
    measured: sourceCounts.trailer + sourceCounts.body + sourceCounts.none > 0,
  };
}

/** 週次の AI併走 PR 比率（%）。単一系列なので凡例は出さない。 */
export function weeklyAiRate(repoId: number, login?: string): ColumnDatum[] {
  const prs = listPullRequests(repoId).filter((p) => (login ? p.author_login === login : true) && p.merged_at);
  type Bucket = { label: string; sortKey: number; total: number; ai: number };
  const weeks = new Map<string, Bucket>();
  for (const pr of prs) {
    const { key, label, sortKey } = isoWeekStart(pr.merged_at as string);
    const bucket = weeks.get(key) ?? { label, sortKey, total: 0, ai: 0 };
    bucket.total += 1;
    if (pr.ai_commit_count > 0 || pr.ai_source === "body") bucket.ai += 1;
    weeks.set(key, bucket);
  }
  return [...weeks.values()]
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((wk) => ({
      label: wk.label,
      segments: [{ key: "ai", value: Math.round((wk.ai / wk.total) * 100), color: "var(--ai)" }],
    }));
}

export type ReviewMatrix = { rows: string[]; cols: string[]; value: (row: string, col: string) => number };

/** レビュアー(行) × PR作成者(列) の相互作用マトリクス。人数が多い場合は上位のみに畳む。 */
export function reviewMatrix(repoId: number, maxPeople = 10): ReviewMatrix {
  const prs = listPullRequests(repoId);
  const counts = new Map<string, Map<string, number>>();
  const reviewerTotals = new Map<string, number>();
  const authorTotals = new Map<string, number>();

  for (const pr of prs) {
    if (!pr.author_login) continue;
    for (const rv of listPrReviews(repoId, pr.number)) {
      if (rv.reviewer_is_bot) continue;
      if (rv.reviewer_login === pr.author_login) continue;
      const byAuthor = counts.get(rv.reviewer_login) ?? new Map<string, number>();
      byAuthor.set(pr.author_login, (byAuthor.get(pr.author_login) ?? 0) + 1);
      counts.set(rv.reviewer_login, byAuthor);
      reviewerTotals.set(rv.reviewer_login, (reviewerTotals.get(rv.reviewer_login) ?? 0) + 1);
      authorTotals.set(pr.author_login, (authorTotals.get(pr.author_login) ?? 0) + 1);
    }
  }

  const rows = [...reviewerTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxPeople).map(([k]) => k);
  const cols = [...authorTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxPeople).map(([k]) => k);

  return {
    rows,
    cols,
    value: (row, col) => counts.get(row)?.get(col) ?? 0,
  };
}
