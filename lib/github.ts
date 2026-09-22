import "server-only";
import { getGithubToken } from "@/lib/env";
import type { FetchedFile, FetchedPr, FetchedReview } from "@/lib/queries";

const GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
const REST_BASE = "https://api.github.com";

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GithubError";
  }
}

export type ProgressEvent =
  | { kind: "page"; fetched: number; total: number | null; transport: "graphql" | "rest" }
  | { kind: "pr"; number: number; title: string; done: number }
  | { kind: "rate"; remaining: number; resetAt: string | null; transport: string }
  | { kind: "warn"; message: string };

export type FetchOptions = {
  owner: string;
  repo: string;
  limit: number;
  onProgress?: (e: ProgressEvent) => void;
  signal?: AbortSignal;
};

const BOT_SUFFIX = /\[bot\]$/;
const GENERATED_PATTERNS = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)Cargo\.lock$/,
  /(^|\/)go\.sum$/,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)vendor\//,
  /(^|\/)\.next\//,
  /\.generated\./,
  /\.min\.(js|css)$/,
];

function isGenerated(path: string): boolean {
  return GENERATED_PATTERNS.some((re) => re.test(path));
}

function isBot(login: string | null): boolean {
  return !!login && BOT_SUFFIX.test(login);
}

export function githubTransport(): "graphql" | "rest" {
  return getGithubToken() ? "graphql" : "rest";
}

export async function* fetchPullRequests(opts: FetchOptions): AsyncGenerator<FetchedPr> {
  const transport = githubTransport();
  if (transport === "graphql") {
    yield* fetchViaGraphQL(opts);
  } else {
    yield* fetchViaRest(opts);
  }
}

// ─── GraphQL 経路（PAT あり） ────────────────────────────────────────

const PR_QUERY = `
query PRs($owner: String!, $name: String!, $first: Int!, $after: String) {
  rateLimit { cost remaining resetAt }
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name }
    pullRequests(first: $first, after: $after, states: [MERGED, CLOSED],
                 orderBy: { field: CREATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title body url state createdAt mergedAt
        additions deletions changedFiles
        author { login __typename }
        labels(first: 10) { nodes { name } }
        files(first: 100) {
          pageInfo { hasNextPage }
          nodes { path additions deletions changeType }
        }
        commits(first: 10) { totalCount nodes { commit { messageHeadline } } }
        reviews(first: 20) {
          totalCount
          nodes {
            id state bodyText submittedAt
            author { login __typename }
            comments { totalCount }
          }
        }
        comments { totalCount }
      }
    }
  }
}`;

type GqlAuthor = { login: string; __typename: string } | null;

type GqlPrNode = {
  number: number;
  title: string;
  body: string | null;
  url: string;
  state: string;
  createdAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  author: GqlAuthor;
  labels: { nodes: { name: string }[] };
  files: {
    pageInfo: { hasNextPage: boolean };
    nodes: { path: string; additions: number; deletions: number; changeType: string }[];
  };
  commits: { totalCount: number; nodes: { commit: { messageHeadline: string } }[] };
  reviews: {
    totalCount: number;
    nodes: {
      id: string;
      state: string;
      bodyText: string;
      submittedAt: string | null;
      author: GqlAuthor;
      comments: { totalCount: number };
    }[];
  };
  comments: { totalCount: number };
};

type GqlResponse = {
  data?: {
    rateLimit: { cost: number; remaining: number; resetAt: string };
    repository: {
      defaultBranchRef: { name: string } | null;
      pullRequests: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: GqlPrNode[];
      };
    } | null;
  };
  errors?: { message: string }[];
};

function mapGqlNode(node: GqlPrNode): FetchedPr {
  const files: FetchedFile[] = node.files.nodes.map((f) => ({
    path: f.path,
    additions: f.additions,
    deletions: f.deletions,
    status: f.changeType,
    generated: isGenerated(f.path),
  }));

  const reviews: FetchedReview[] = node.reviews.nodes.map((r) => ({
    reviewId: r.id,
    reviewerLogin: r.author?.login ?? "(unknown)",
    reviewerIsBot: isBot(r.author?.login ?? null),
    state: r.state,
    bodyLen: r.bodyText?.length ?? 0,
    commentCount: r.comments.totalCount,
    submittedAt: r.submittedAt,
  }));

  return {
    number: node.number,
    title: node.title,
    body: node.body,
    authorLogin: node.author?.login ?? null,
    authorIsBot: isBot(node.author?.login ?? null),
    state: node.state,
    createdAt: node.createdAt,
    mergedAt: node.mergedAt,
    additions: node.additions,
    deletions: node.deletions,
    changedFiles: node.changedFiles,
    commitCount: node.commits.totalCount,
    commitTitles: node.commits.nodes.map((c) => c.commit.messageHeadline),
    reviewCount: node.reviews.totalCount,
    commentCount: node.comments.totalCount,
    labels: node.labels.nodes.map((l) => l.name),
    url: node.url,
    filesTruncated: node.files.pageInfo.hasNextPage,
    files,
    reviews,
  };
}

async function graphqlRequest(
  token: string,
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<GqlResponse> {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "jev-github-demo",
    },
    body: JSON.stringify({ query: PR_QUERY, variables }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GithubError(`GitHub GraphQL が ${res.status} を返しました: ${text.slice(0, 300)}`, res.status);
  }
  return (await res.json()) as GqlResponse;
}

async function* fetchViaGraphQL(opts: FetchOptions): AsyncGenerator<FetchedPr> {
  const token = getGithubToken();
  if (!token) throw new GithubError("GITHUB_TOKEN が設定されていません", 500);

  let after: string | null = null;
  let fetched = 0;
  const pageSize = 25;

  while (fetched < opts.limit) {
    const first = Math.min(pageSize, opts.limit - fetched);
    const body = await graphqlRequest(token, { owner: opts.owner, name: opts.repo, first, after }, opts.signal);

    if (body.errors?.length) {
      throw new GithubError(`GitHub GraphQL エラー: ${body.errors.map((e) => e.message).join(", ")}`, 502);
    }
    const repo = body.data?.repository;
    if (!repo) {
      throw new GithubError(`リポジトリ ${opts.owner}/${opts.repo} が見つかりません`, 404);
    }

    opts.onProgress?.({
      kind: "rate",
      remaining: body.data!.rateLimit.remaining,
      resetAt: body.data!.rateLimit.resetAt,
      transport: "graphql",
    });
    if (body.data!.rateLimit.remaining < 200) {
      opts.onProgress?.({
        kind: "warn",
        message: `GraphQL のレート残量が少なくなっています（残り ${body.data!.rateLimit.remaining}）。ここで打ち切ります。`,
      });
      return;
    }

    for (const node of repo.pullRequests.nodes) {
      const pr = mapGqlNode(node);
      if (pr.filesTruncated) {
        const restFiles = await fetchRestFiles(opts.owner, opts.repo, pr.number, token, opts.signal);
        if (restFiles) {
          pr.files = restFiles;
          pr.filesTruncated = false;
        } else {
          opts.onProgress?.({
            kind: "warn",
            message: `#${pr.number}: ファイル一覧が100件を超えるため一部欠落しています`,
          });
        }
      }
      fetched += 1;
      opts.onProgress?.({ kind: "pr", number: pr.number, title: pr.title, done: fetched });
      yield pr;
      if (fetched >= opts.limit) return;
    }

    opts.onProgress?.({ kind: "page", fetched, total: null, transport: "graphql" });

    if (!repo.pullRequests.pageInfo.hasNextPage) return;
    after = repo.pullRequests.pageInfo.endCursor;
  }
}

async function fetchRestFiles(
  owner: string,
  repo: string,
  number: number,
  token: string,
  signal?: AbortSignal,
): Promise<FetchedFile[] | null> {
  try {
    const res = await fetch(`${REST_BASE}/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "jev-github-demo",
      },
      signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      filename: string;
      additions: number;
      deletions: number;
      status: string;
    }[];
    return json.map((f) => ({
      path: f.filename,
      additions: f.additions,
      deletions: f.deletions,
      status: f.status,
      generated: isGenerated(f.filename),
    }));
  } catch {
    return null;
  }
}

// ─── REST 経路（PAT なし・60 req/h） ─────────────────────────────────

type RestPrSummary = { number: number; title: string };

type RestPrDetail = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  merged_at: string | null;
  created_at: string;
  user: { login: string } | null;
  additions: number;
  deletions: number;
  changed_files: number;
  commits: number;
  comments: number;
  labels: { name: string }[];
};

function restHeaders(): Record<string, string> {
  const token = getGithubToken();
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "jev-github-demo",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function readRateLimit(res: Response): { remaining: number; reset: string | null } {
  const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? "-1");
  const resetEpoch = res.headers.get("x-ratelimit-reset");
  return {
    remaining,
    reset: resetEpoch ? new Date(Number(resetEpoch) * 1000).toISOString() : null,
  };
}

async function* fetchViaRest(opts: FetchOptions): AsyncGenerator<FetchedPr> {
  const cappedLimit = Math.min(opts.limit, 15);
  if (opts.limit > 15) {
    opts.onProgress?.({
      kind: "warn",
      message: "GITHUB_TOKEN が未設定のため、REST 経由・最新15件までに制限しました",
    });
  }

  const listRes = await fetch(
    `${REST_BASE}/repos/${opts.owner}/${opts.repo}/pulls?state=closed&per_page=${cappedLimit}&sort=created&direction=desc`,
    { headers: restHeaders(), signal: opts.signal },
  );
  if (!listRes.ok) {
    throw new GithubError(`GitHub REST が ${listRes.status} を返しました`, listRes.status);
  }
  const rate = readRateLimit(listRes);
  opts.onProgress?.({ kind: "rate", remaining: rate.remaining, resetAt: rate.reset, transport: "rest" });

  const summaries = (await listRes.json()) as RestPrSummary[];
  let fetched = 0;

  for (const summary of summaries.slice(0, cappedLimit)) {
    const [detailRes, filesRes, reviewsRes] = await Promise.all([
      fetch(`${REST_BASE}/repos/${opts.owner}/${opts.repo}/pulls/${summary.number}`, {
        headers: restHeaders(),
        signal: opts.signal,
      }),
      fetch(`${REST_BASE}/repos/${opts.owner}/${opts.repo}/pulls/${summary.number}/files?per_page=100`, {
        headers: restHeaders(),
        signal: opts.signal,
      }),
      fetch(`${REST_BASE}/repos/${opts.owner}/${opts.repo}/pulls/${summary.number}/reviews?per_page=100`, {
        headers: restHeaders(),
        signal: opts.signal,
      }),
    ]);

    if (!detailRes.ok) {
      opts.onProgress?.({ kind: "warn", message: `#${summary.number}: 詳細取得に失敗（${detailRes.status}）` });
      continue;
    }
    const detail = (await detailRes.json()) as RestPrDetail;
    const filesJson = filesRes.ok
      ? ((await filesRes.json()) as { filename: string; additions: number; deletions: number; status: string }[])
      : [];
    const reviewsJson = reviewsRes.ok
      ? ((await reviewsRes.json()) as {
          id: number;
          state: string;
          body: string;
          submitted_at: string | null;
          user: { login: string } | null;
        }[])
      : [];

    const pr: FetchedPr = {
      number: detail.number,
      title: detail.title,
      body: detail.body,
      authorLogin: detail.user?.login ?? null,
      authorIsBot: isBot(detail.user?.login ?? null),
      state: detail.merged_at ? "MERGED" : detail.state.toUpperCase(),
      createdAt: detail.created_at,
      mergedAt: detail.merged_at,
      additions: detail.additions,
      deletions: detail.deletions,
      changedFiles: detail.changed_files,
      commitCount: detail.commits,
      commitTitles: [],
      reviewCount: reviewsJson.length,
      commentCount: detail.comments,
      labels: detail.labels.map((l) => l.name),
      url: detail.html_url,
      filesTruncated: filesJson.length >= 100,
      files: filesJson.map((f) => ({
        path: f.filename,
        additions: f.additions,
        deletions: f.deletions,
        status: f.status,
        generated: isGenerated(f.filename),
      })),
      reviews: reviewsJson.map((r) => ({
        reviewId: String(r.id),
        reviewerLogin: r.user?.login ?? "(unknown)",
        reviewerIsBot: isBot(r.user?.login ?? null),
        state: r.state,
        bodyLen: r.body?.length ?? 0,
        commentCount: 0,
        submittedAt: r.submitted_at,
      })),
    };

    fetched += 1;
    opts.onProgress?.({ kind: "pr", number: pr.number, title: pr.title, done: fetched });
    yield pr;
  }
}
