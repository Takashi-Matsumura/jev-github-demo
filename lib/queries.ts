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
       commit_count, commit_titles, review_count, comment_count,
       labels_json, url, files_truncated, fetched_at
     ) VALUES (
       :repo_id, :number, :title, :body, :author_login, :author_is_bot, :state,
       :created_at, :merged_at, :additions, :deletions, :changed_files,
       :commit_count, :commit_titles, :review_count, :comment_count,
       :labels_json, :url, :files_truncated, :fetched_at
     )
     ON CONFLICT (repo_id, number) DO UPDATE SET
       title = excluded.title, body = excluded.body,
       author_login = excluded.author_login, author_is_bot = excluded.author_is_bot,
       state = excluded.state, merged_at = excluded.merged_at,
       additions = excluded.additions, deletions = excluded.deletions,
       changed_files = excluded.changed_files, commit_count = excluded.commit_count,
       commit_titles = excluded.commit_titles, review_count = excluded.review_count,
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
