import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo, getPullRequest, listPrFiles, listPrReviews, getClassification } from "@/lib/queries";
import { formatDateTime, formatInt } from "@/lib/format";
import { CategoryBadge, SourceBadge } from "@/components/category-badge";
import { ProbabilityBar, ConfidenceMark } from "@/components/probability-bar";
import { JevConsole, type JevExchangeLike } from "@/components/jev-console";
import { scoreRepo } from "@/lib/score";
import { ScoreFormula } from "@/components/score-formula";

export default async function PrDetail(props: PageProps<"/repos/[owner]/[repo]/prs/[number]">) {
  const { owner, repo, number: numberStr } = await props.params;
  const number = Number(numberStr);

  const repoRow = getRepo(owner, repo);
  if (!repoRow) notFound();

  const pr = getPullRequest(repoRow.id, number);
  if (!pr) notFound();

  const files = listPrFiles(repoRow.id, number);
  const reviews = listPrReviews(repoRow.id, number);
  const classification = getClassification(repoRow.id, number);
  const labels = JSON.parse(pr.labels_json) as string[];
  const evidence = classification ? (JSON.parse(classification.category_evidence) as string[]) : [];

  let exchange: JevExchangeLike | null = null;
  if (classification?.jev_exchange_json) {
    try {
      exchange = JSON.parse(classification.jev_exchange_json) as JevExchangeLike;
    } catch {
      exchange = null;
    }
  }

  const { developers } = scoreRepo(repoRow.id);
  const contrib = pr.author_login
    ? developers.find((d) => d.login === pr.author_login)?.prs.find((p) => p.number === number)
    : undefined;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-8">
      <div>
        <Link href={`/repos/${owner}/${repo}`} className="text-sm text-muted underline">
          ← ダッシュボードに戻る
        </Link>
        <h1 className="text-xl font-semibold">
          #{pr.number} {pr.title}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>{pr.author_login ?? "(unknown)"}</span>
          <span>{formatDateTime(pr.merged_at)}</span>
          {pr.url ? (
            <a href={pr.url} target="_blank" rel="noreferrer" className="text-cat-feat underline">
              GitHub で見る
            </a>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="font-medium">事実</h2>
          <div className="rounded-lg border border-border p-3 text-sm">
            <div className="flex flex-wrap gap-2">
              {labels.map((l) => (
                <span key={l} className="rounded-full border border-border px-2 py-0.5 text-xs">
                  {l}
                </span>
              ))}
            </div>
            <div className="mt-2 font-mono text-xs">
              <span className="text-cat-test">+{formatInt(pr.additions)}</span>{" "}
              <span className="text-cat-fix">-{formatInt(pr.deletions)}</span> · {formatInt(pr.changed_files)} ファイル ·{" "}
              {formatInt(pr.commit_count)} コミット · レビュー {formatInt(pr.review_count)} 件
            </div>
            {pr.files_truncated ? <p className="mt-1 text-xs text-warn-fg">⚠ ファイル一覧が一部欠落しています</p> : null}
            {pr.commits_truncated ? <p className="mt-1 text-xs text-warn-fg">⚠ コミット一覧が100件を超えるため一部欠落しています</p> : null}

            <div className="mt-2 flex items-center gap-2 text-xs">
              {pr.ai_commit_count > 0 || pr.ai_source === "body" ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-white"
                  style={{ backgroundColor: "var(--ai)" }}
                >
                  AI併走 {formatInt(pr.ai_commit_count)}/{formatInt(pr.commit_count)} コミット
                </span>
              ) : (
                <span className="rounded-full border border-border px-2 py-0.5 text-muted">
                  AI併走 {pr.ai_source === "unmeasured" ? "未計測" : "検出なし"}
                </span>
              )}
              <span className="text-muted">
                根拠: {pr.ai_source === "trailer" ? "コミット co-author" : pr.ai_source === "body" ? "PR本文の生成マーカー" : pr.ai_source === "unmeasured" ? "GITHUB_TOKEN未設定のため未計測" : "検出なし（GraphQL経由で計測済み）"}
              </span>
            </div>
            {(JSON.parse(pr.ai_agents) as string[]).length > 0 ? (
              <div className="mt-1 text-xs text-muted">検出エージェント: {(JSON.parse(pr.ai_agents) as string[]).join(", ")}</div>
            ) : null}

            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-muted">変更ファイル（{files.length}）</summary>
              <ul className="mt-1 space-y-0.5 font-mono text-xs">
                {files.map((f) => (
                  <li key={f.path} className={f.generated ? "text-muted line-through" : ""}>
                    {f.path} (+{f.additions}/-{f.deletions}) {f.generated ? "除外" : ""}
                  </li>
                ))}
              </ul>
            </details>

            {reviews.length > 0 ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted">レビュー（{reviews.length}）</summary>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {reviews.map((r, i) => (
                    <li key={`${r.review_id}-${i}`}>
                      {r.reviewer_login} — {r.state}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-medium">判定</h2>
          {classification ? (
            <div className="space-y-3 rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center gap-2">
                <CategoryBadge category={classification.category} />
                <SourceBadge source={classification.category_source} />
                {classification.needs_review ? <span className="text-xs text-warn-fg">⚠ 要確認</span> : null}
              </div>
              <ul className="list-inside list-disc text-xs text-muted">
                {evidence.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>

              <div className="space-y-2">
                {classification.impact != null ? (
                  <div>
                    <ProbabilityBar label="impact" value={classification.impact} max={4} />
                    <ConfidenceMark confidence={classification.impact_conf} />
                  </div>
                ) : null}
                {classification.complexity != null ? (
                  <div>
                    <ProbabilityBar label="complexity" value={classification.complexity} max={4} />
                    <ConfidenceMark confidence={classification.complexity_conf} />
                  </div>
                ) : null}
                {classification.risk != null ? (
                  <div>
                    <ProbabilityBar label="risk" value={classification.risk} max={3} />
                    <ConfidenceMark confidence={classification.risk_conf} />
                  </div>
                ) : null}
                {classification.user_facing != null ? (
                  <ProbabilityBar label="user_facing (P=true)" value={classification.user_facing} />
                ) : null}
                {classification.breaking_change != null ? (
                  <ProbabilityBar label="breaking_change (P=true)" value={classification.breaking_change} />
                ) : null}
                {classification.tests_included != null ? (
                  <ProbabilityBar label="tests_included (P=true)" value={classification.tests_included} />
                ) : null}
              </div>

              {classification.jev_error ? (
                <p className="text-xs text-warn-fg">Jev エラー: {classification.jev_error}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted">まだ分類されていません。</p>
          )}
        </section>
      </div>

      {contrib ? (
        <section className="space-y-2">
          <h2 className="font-medium">この PR のスコア寄与</h2>
          <ScoreFormula factors={contrib.factors} score={contrib.score} />
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="font-medium">Jev コンソール</h2>
        <JevConsole exchange={exchange} />
      </section>
    </main>
  );
}
