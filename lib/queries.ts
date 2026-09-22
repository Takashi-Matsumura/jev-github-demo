import "server-only";
import { getDb } from "@/lib/db";

/** node:sqlite にバインドできる値。boolean と undefined は許されないため、呼び出し前に変換する。 */
type Bindable = string | number | bigint | null | Uint8Array;

const b = (v: boolean): 0 | 1 => (v ? 1 : 0);
const n = (v: string | null | undefined): string | null => v ?? null;

export type RepoRow = {
  id: number;
  owner: string;
  name: string;
  default_branch: string | null;
  last_ingest_at: string | null;
};

export type FetchedFile = {
  path: string;
  additions: number;
  deletions: number;
  status: string;
  generated: boolean;
};

export type FetchedReview = {
  reviewId: string;
  reviewerLogin: string;
  reviewerIsBot: boolean;
  state: string;
  bodyLen: number;
  commentCount: number;
  submittedAt: string | null;
};

export type FetchedPr = {
  number: number;
  title: string;
  body: string | null;
  authorLogin: string | null;
  authorIsBot: boolean;
  state: string;
  createdAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  commitCount: number;
  commitTitles: string[];
  commitsTruncated: boolean;
  /** Co-authored-by: トレーラ（GraphQL の Commit.authors）または PR body の生成マーカーで検出した AI co-author の数。 */
  aiCommitCount: number;
  aiAgents: string[];
  /** trailer: コミット co-author で検出 / body: PR本文の生成マーカーで検出 / none: GraphQL経路で計測したが0件 / unmeasured: REST経路でコミット情報が取れない。 */
  aiSource: "trailer" | "body" | "none" | "unmeasured";
  reviewCount: number;
  commentCount: number;
  labels: string[];
  url: string | null;
  filesTruncated: boolean;
  files: FetchedFile[];
  reviews: FetchedReview[];
};

export function upsertRepo(owner: string, name: string, defaultBranch?: string | null): RepoRow {
  const db = getDb();
  db.prepare(
    `INSERT INTO repos (owner, name, default_branch)
     VALUES (:owner, :name, :default_branch)
     ON CONFLICT (owner, name) DO UPDATE SET
       default_branch = COALESCE(excluded.default_branch, repos.default_branch)`,
  ).run({ owner, name, default_branch: n(defaultBranch) } satisfies Record<string, Bindable>);

  return db
    .prepare("SELECT * FROM repos WHERE owner = :owner AND name = :name")
    .get({ owner, name }) as unknown as RepoRow;
}

export function touchIngest(repoId: number): void {
  const db = getDb();
  db.prepare("UPDATE repos SET last_ingest_at = :now WHERE id = :id").run({
    now: new Date().toISOString(),
    id: repoId,
  });
}

export function upsertPullRequest(repoId: number, pr: FetchedPr): void {
  const db = getDb();
  const fetchedAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO pull_requests (
       repo_id, number, title, body, author_login, author_is_bot, state,
       created_at, merged_at, additions, deletions, changed_files,
       commit_count, commit_titles, commits_truncated,
       ai_commit_count, ai_agents, ai_source,
       review_count, comment_count,
       labels_json, url, files_truncated, fetched_at
     ) VALUES (
       :repo_id, :number, :title, :body, :author_login, :author_is_bot, :state,
       :created_at, :merged_at, :additions, :deletions, :changed_files,
       :commit_count, :commit_titles, :commits_truncated,
       :ai_commit_count, :ai_agents, :ai_source,
       :review_count, :comment_count,
       :labels_json, :url, :files_truncated, :fetched_at
     )
     ON CONFLICT (repo_id, number) DO UPDATE SET
       title = excluded.title, body = excluded.body,
       author_login = excluded.author_login, author_is_bot = excluded.author_is_bot,
       state = excluded.state, merged_at = excluded.merged_at,
       additions = excluded.additions, deletions = excluded.deletions,
       changed_files = excluded.changed_files, commit_count = excluded.commit_count,
       commit_titles = excluded.commit_titles, commits_truncated = excluded.commits_truncated,
       ai_commit_count = excluded.ai_commit_count, ai_agents = excluded.ai_agents,
       ai_source = excluded.ai_source,
       review_count = excluded.review_count,
       comment_count = excluded.comment_count, labels_json = excluded.labels_json,
       url = excluded.url, files_truncated = excluded.files_truncated,
       fetched_at = excluded.fetched_at`,
  ).run({
    repo_id: repoId,
    number: pr.number,
    title: pr.title,
    body: n(pr.body),
    author_login: n(pr.authorLogin),
    author_is_bot: b(pr.authorIsBot),
    state: pr.state,
    created_at: pr.createdAt,
    merged_at: n(pr.mergedAt),
    additions: pr.additions,
    deletions: pr.deletions,
    changed_files: pr.changedFiles,
    commit_count: pr.commitCount,
    commit_titles: JSON.stringify(pr.commitTitles),
    commits_truncated: b(pr.commitsTruncated),
    ai_commit_count: pr.aiCommitCount,
    ai_agents: JSON.stringify(pr.aiAgents),
    ai_source: pr.aiSource,
    review_count: pr.reviewCount,
    comment_count: pr.commentCount,
    labels_json: JSON.stringify(pr.labels),
    url: n(pr.url),
    files_truncated: b(pr.filesTruncated),
    fetched_at: fetchedAt,
  } satisfies Record<string, Bindable>);

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM pr_files WHERE repo_id = :repo_id AND number = :number").run({
      repo_id: repoId,
      number: pr.number,
    });
    const insertFile = db.prepare(
      `INSERT INTO pr_files (repo_id, number, path, additions, deletions, status, generated)
       VALUES (:repo_id, :number, :path, :additions, :deletions, :status, :generated)`,
    );
    for (const f of pr.files) {
      insertFile.run({
        repo_id: repoId,
        number: pr.number,
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        status: n(f.status),
        generated: b(f.generated),
      } satisfies Record<string, Bindable>);
    }

    db.prepare("DELETE FROM pr_reviews WHERE repo_id = :repo_id AND number = :number").run({
      repo_id: repoId,
      number: pr.number,
    });
    const insertReview = db.prepare(
      `INSERT INTO pr_reviews (
         repo_id, number, review_id, reviewer_login, reviewer_is_bot,
         state, body_len, comment_count, submitted_at
       ) VALUES (
         :repo_id, :number, :review_id, :reviewer_login, :reviewer_is_bot,
         :state, :body_len, :comment_count, :submitted_at
       )`,
    );
    for (const r of pr.reviews) {
      insertReview.run({
        repo_id: repoId,
        number: pr.number,
        review_id: r.reviewId,
        reviewer_login: r.reviewerLogin,
        reviewer_is_bot: b(r.reviewerIsBot),
        state: r.state,
        body_len: r.bodyLen,
        comment_count: r.commentCount,
        submitted_at: n(r.submittedAt),
      } satisfies Record<string, Bindable>);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function listRepos(): (RepoRow & { prCount: number; classifiedCount: number })[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT r.*,
         (SELECT COUNT(*) FROM pull_requests p WHERE p.repo_id = r.id) AS prCount,
         (SELECT COUNT(*) FROM classifications c WHERE c.repo_id = r.id) AS classifiedCount
       FROM repos r
       ORDER BY r.last_ingest_at DESC NULLS LAST, r.id DESC`,
    )
    .all() as unknown as (RepoRow & { prCount: number; classifiedCount: number })[];
}

export function getRepo(owner: string, name: string): RepoRow | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM repos WHERE owner = :owner AND name = :name")
    .get({ owner, name }) as unknown as RepoRow | undefined;
}

// ─── 分類向けの読み書き ──────────────────────────────────────────

export type PullRequestRow = {
  repo_id: number;
  number: number;
  title: string;
  body: string | null;
  author_login: string | null;
  author_is_bot: number;
  state: string;
  created_at: string;
  merged_at: string | null;
  additions: number;
  deletions: number;
  changed_files: number;
  commit_count: number;
  commit_titles: string;
  commits_truncated: number;
  ai_commit_count: number;
  ai_agents: string;
  ai_source: "trailer" | "body" | "none" | "unmeasured";
  review_count: number;
  comment_count: number;
  labels_json: string;
  url: string | null;
  files_truncated: number;
  fetched_at: string;
};

export type PrFileRow = {
  path: string;
  additions: number;
  deletions: number;
  status: string | null;
  generated: number;
};

export type PrReviewRow = {
  review_id: string;
  reviewer_login: string;
  reviewer_is_bot: number;
  state: string;
  body_len: number;
  comment_count: number;
  submitted_at: string | null;
};

export type ClassificationRow = {
  repo_id: number;
  number: number;
  category: string;
  category_source: "rule" | "jev";
  category_evidence: string;
  category_confidence: number | null;
  category_top_prob: number | null;
  needs_review: number;
  impact: number | null;
  impact_conf: number | null;
  complexity: number | null;
  complexity_conf: number | null;
  risk: number | null;
  risk_conf: number | null;
  user_facing: number | null;
  breaking_change: number | null;
  tests_included: number | null;
  scope_coherence: number | null;
  title_matches_diff: number | null;
  jev_exchange_json: string | null;
  jev_asked_category: number;
  jev_input_tokens: number | null;
  jev_output_tokens: number | null;
  jev_elapsed_ms: number | null;
  jev_error: string | null;
  model: string | null;
  questions_version: string;
  classified_at: string;
};

export function listPullRequests(repoId: number): PullRequestRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM pull_requests WHERE repo_id = :repo_id ORDER BY number DESC")
    .all({ repo_id: repoId }) as unknown as PullRequestRow[];
}

export function getPullRequest(repoId: number, number: number): PullRequestRow | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM pull_requests WHERE repo_id = :repo_id AND number = :number")
    .get({ repo_id: repoId, number }) as unknown as PullRequestRow | undefined;
}

export function listPrFiles(repoId: number, number: number): PrFileRow[] {
  const db = getDb();
  return db
    .prepare("SELECT path, additions, deletions, status, generated FROM pr_files WHERE repo_id = :repo_id AND number = :number")
    .all({ repo_id: repoId, number }) as unknown as PrFileRow[];
}

export function listPrReviews(repoId: number, number: number): PrReviewRow[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT review_id, reviewer_login, reviewer_is_bot, state, body_len, comment_count, submitted_at FROM pr_reviews WHERE repo_id = :repo_id AND number = :number",
    )
    .all({ repo_id: repoId, number }) as unknown as PrReviewRow[];
}

export function getClassification(repoId: number, number: number): ClassificationRow | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM classifications WHERE repo_id = :repo_id AND number = :number")
    .get({ repo_id: repoId, number }) as unknown as ClassificationRow | undefined;
}

export function listClassifications(repoId: number): ClassificationRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM classifications WHERE repo_id = :repo_id")
    .all({ repo_id: repoId }) as unknown as ClassificationRow[];
}

export type ClassificationInput = {
  category: string;
  categorySource: "rule" | "jev";
  categoryEvidence: string[];
  categoryConfidence: number | null;
  categoryTopProb: number | null;
  needsReview: boolean;
  impact: number | null;
  impactConf: number | null;
  complexity: number | null;
  complexityConf: number | null;
  risk: number | null;
  riskConf: number | null;
  userFacing: number | null;
  breakingChange: number | null;
  testsIncluded: number | null;
  scopeCoherence: number | null;
  titleMatchesDiff: number | null;
  jevExchangeJson: string | null;
  jevAskedCategory: boolean;
  jevInputTokens: number | null;
  jevOutputTokens: number | null;
  jevElapsedMs: number | null;
  jevError: string | null;
  model: string | null;
  questionsVersion: string;
};

export function upsertClassification(repoId: number, number: number, c: ClassificationInput): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO classifications (
       repo_id, number, category, category_source, category_evidence,
       category_confidence, category_top_prob, needs_review,
       impact, impact_conf, complexity, complexity_conf, risk, risk_conf,
       user_facing, breaking_change, tests_included, scope_coherence, title_matches_diff,
       jev_exchange_json, jev_asked_category, jev_input_tokens, jev_output_tokens,
       jev_elapsed_ms, jev_error, model, questions_version, classified_at
     ) VALUES (
       :repo_id, :number, :category, :category_source, :category_evidence,
       :category_confidence, :category_top_prob, :needs_review,
       :impact, :impact_conf, :complexity, :complexity_conf, :risk, :risk_conf,
       :user_facing, :breaking_change, :tests_included, :scope_coherence, :title_matches_diff,
       :jev_exchange_json, :jev_asked_category, :jev_input_tokens, :jev_output_tokens,
       :jev_elapsed_ms, :jev_error, :model, :questions_version, :classified_at
     )
     ON CONFLICT (repo_id, number) DO UPDATE SET
       category = excluded.category, category_source = excluded.category_source,
       category_evidence = excluded.category_evidence,
       category_confidence = excluded.category_confidence, category_top_prob = excluded.category_top_prob,
       needs_review = excluded.needs_review,
       impact = excluded.impact, impact_conf = excluded.impact_conf,
       complexity = excluded.complexity, complexity_conf = excluded.complexity_conf,
       risk = excluded.risk, risk_conf = excluded.risk_conf,
       user_facing = excluded.user_facing, breaking_change = excluded.breaking_change,
       tests_included = excluded.tests_included, scope_coherence = excluded.scope_coherence,
       title_matches_diff = excluded.title_matches_diff,
       jev_exchange_json = excluded.jev_exchange_json, jev_asked_category = excluded.jev_asked_category,
       jev_input_tokens = excluded.jev_input_tokens, jev_output_tokens = excluded.jev_output_tokens,
       jev_elapsed_ms = excluded.jev_elapsed_ms, jev_error = excluded.jev_error,
       model = excluded.model, questions_version = excluded.questions_version,
       classified_at = excluded.classified_at`,
  ).run({
    repo_id: repoId,
    number,
    category: c.category,
    category_source: c.categorySource,
    category_evidence: JSON.stringify(c.categoryEvidence),
    category_confidence: c.categoryConfidence,
    category_top_prob: c.categoryTopProb,
    needs_review: b(c.needsReview),
    impact: c.impact,
    impact_conf: c.impactConf,
    complexity: c.complexity,
    complexity_conf: c.complexityConf,
    risk: c.risk,
    risk_conf: c.riskConf,
    user_facing: c.userFacing,
    breaking_change: c.breakingChange,
    tests_included: c.testsIncluded,
    scope_coherence: c.scopeCoherence,
    title_matches_diff: c.titleMatchesDiff,
    jev_exchange_json: c.jevExchangeJson,
    jev_asked_category: b(c.jevAskedCategory),
    jev_input_tokens: c.jevInputTokens,
    jev_output_tokens: c.jevOutputTokens,
    jev_elapsed_ms: c.jevElapsedMs,
    jev_error: c.jevError,
    model: c.model,
    questions_version: c.questionsVersion,
    classified_at: new Date().toISOString(),
  } satisfies Record<string, Bindable>);
}
