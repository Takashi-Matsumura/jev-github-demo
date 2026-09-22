import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo, listPullRequests } from "@/lib/queries";
import { scoreRepo } from "@/lib/score";
import { formatNumber, formatInt } from "@/lib/format";
import { CategoryBadge, SourceBadge } from "@/components/category-badge";
import { ScoreFormula } from "@/components/score-formula";
import {
  leadTimeHistogram,
  leadTimeMedianHours,
  sizeHistogram,
  sizeMedianLoc,
  reviewStateBreakdown,
  formatHours,
  aiCoauthorStats,
  weeklyAiRate,
} from "@/lib/analytics";
import { Histogram } from "@/components/chart/histogram";
import { StackedBar } from "@/components/chart/stacked-bar";
import { StatTile } from "@/components/chart/stat-tile";
import { Meter } from "@/components/chart/meter";
import { ColumnChart } from "@/components/chart/column-chart";

export default async function DeveloperDrilldown(props: PageProps<"/repos/[owner]/[repo]/devs/[login]">) {
  const { owner, repo, login } = await props.params;

  const repoRow = getRepo(owner, repo);
  if (!repoRow) notFound();

  const { developers } = scoreRepo(repoRow.id);
  const dev = developers.find((d) => d.login === login);
  if (!dev) notFound();

  const lowConfidencePrs = dev.prs.filter((p) => p.lowConfidence);

  const leadTimeBins = leadTimeHistogram(repoRow.id, login);
  const leadTimeMedian = leadTimeMedianHours(repoRow.id, login);
  const sizeBins = sizeHistogram(repoRow.id, login);
  const sizeMedian = sizeMedianLoc(repoRow.id, login);
  const givenReviews = reviewStateBreakdown(repoRow.id, login);
  const aiStats = aiCoauthorStats(repoRow.id, login);
  const aiWeekly = weeklyAiRate(repoRow.id, login);
  const aiByPr = new Map(listPullRequests(repoRow.id).map((p) => [p.number, p]));

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-8">
      <div>
        <Link href={`/repos/${owner}/${repo}`} className="text-sm text-muted underline">
          ← リーダーボードに戻る
        </Link>
        <h1 className="text-2xl font-semibold">{dev.login}</h1>
        <p className="mt-1 text-lg">
          <span className="font-mono">{formatNumber(dev.authoringScore)}</span>（実装）+{" "}
          <span className="font-mono">{formatNumber(dev.reviewScore)}</span>（レビュー）= <span className="font-mono font-semibold">{formatNumber(dev.total)}</span>
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="font-medium">実装した PR（{dev.prs.length} 件）</h2>
        <div className="divide-y divide-border rounded-lg border border-border">
          {dev.prs.map((p) => {
            const row = aiByPr.get(p.number);
            const hasAi = row && (row.ai_commit_count > 0 || row.ai_source === "body");
            const agents: string[] = row ? (JSON.parse(row.ai_agents) as string[]) : [];
            return (
              <div key={p.number} className="space-y-1 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/repos/${owner}/${repo}/prs/${p.number}`} className="font-mono text-cat-feat underline">
                      #{p.number}
                    </Link>
                    <span>{p.title}</span>
                    {p.classified ? (
                      <>
                        <CategoryBadge category={p.category} />
                        <SourceBadge source={p.categorySource} />
                      </>
                    ) : (
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">未分類</span>
                    )}
                    {p.needsReview ? <span className="text-xs text-warn-fg">⚠要確認</span> : null}
                    {hasAi ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white"
                        style={{ backgroundColor: "var(--ai)" }}
                        title={row?.ai_source === "trailer" ? "コミットの co-author で検出" : "PR本文の生成マーカーで検出"}
                      >
                        AI併走{agents.length > 0 ? `: ${agents.join(", ")}` : ""}
                      </span>
                    ) : null}
                  </div>
                  <span className="font-mono font-semibold">{formatNumber(p.score)}</span>
                </div>
                <ScoreFormula factors={p.factors} score={p.score} />
              </div>
            );
          })}
          <div className="flex items-center justify-between px-3 py-2 text-sm font-semibold">
            <span>合計</span>
            <span className="font-mono">{formatNumber(dev.authoringScore)}</span>
          </div>
        </div>
      </section>

      {aiStats.measured ? (
        <section className="space-y-2">
          <h2 className="font-medium">AI併走</h2>
          <div className="rounded-lg border border-border p-3 text-sm">
            <Meter
              ratio={aiStats.commitRate}
              label={`AI併走コミット率 ${formatInt(aiStats.aiCommits)}/${formatInt(aiStats.totalCommits)}`}
            />
            {aiStats.agents.length > 0 ? <div className="mt-1 text-xs text-muted">検出: {aiStats.agents.join(", ")}</div> : null}
          </div>
          <ColumnChart data={aiWeekly} formatValue={(n) => `${n}%`} height={80} emptyLabel="マージ済み PR がありません" />
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="font-medium">リードタイム / サイズ</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="リードタイム中央値" value={leadTimeMedian != null ? formatHours(leadTimeMedian) : "—"} />
          <StatTile label="実効LOC中央値" value={sizeMedian != null ? `${Math.round(sizeMedian)}行` : "—"} sublabel="生成物除く" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <div className="text-xs text-muted">リードタイム分布</div>
            <Histogram bins={leadTimeBins} color="var(--cat-feat)" height={100} />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted">サイズ分布</div>
            <Histogram bins={sizeBins} color="var(--cat-refactor)" height={100} />
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">他人の PR へのレビュー（{dev.reviews.length} 件）</h2>
        {dev.reviews.length === 0 ? (
          <p className="text-sm text-muted">レビュー実績はありません。</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">PR</th>
                  <th className="px-3 py-2">状態</th>
                  <th className="px-3 py-2">コメント数</th>
                  <th className="px-3 py-2">点数</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {dev.reviews.map((r, i) => (
                  <tr key={`${r.number}-${i}`}>
                    <td className="px-3 py-2">
                      <Link href={`/repos/${owner}/${repo}/prs/${r.number}`} className="text-cat-feat underline">
                        #{r.number} {r.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.state}</td>
                    <td className="px-3 py-2 font-mono">{formatInt(r.commentCount)}</td>
                    <td className="px-3 py-2 font-mono">{formatNumber(r.score)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="px-3 py-2" colSpan={3}>
                    合計
                  </td>
                  <td className="px-3 py-2 font-mono">{formatNumber(dev.reviewScore)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {givenReviews.total > 0 ? (
        <section className="space-y-2">
          <h2 className="font-medium">レビューの内訳（承認/変更要求/コメント）</h2>
          <StackedBar segments={givenReviews.segments} legend={givenReviews.legend} />
        </section>
      ) : null}

      {lowConfidencePrs.length > 0 ? (
        <section className="space-y-2">
          <h2 className="font-medium">信頼度の低い判定</h2>
          <ul className="divide-y divide-border rounded-lg border border-warn-border text-sm">
            {lowConfidencePrs.map((p) => (
              <li key={p.number} className="px-3 py-2">
                #{p.number} {p.title} — {p.jevFailed ? "Jev 呼び出し失敗のため中立値で計上" : "confidence が低いため中立値へ寄せて計上"}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-lg border border-border p-4 text-sm text-muted">
        <h2 className="mb-1 font-medium text-foreground">計上していないもの</h2>
        <ul className="list-inside list-disc space-y-0.5">
          <li>Issue コメント、設計議論、ペアプログラミング</li>
          <li>障害対応、レビュー以外の形での他者支援</li>
          <li>採用・育成などコードに残らない活動</li>
        </ul>
        <p className="mt-2">
          このリポジトリが squash マージを使っている場合、共同作業の貢献が PR 作成者 1 人に全額計上されます。
          Claude Code などの AI エージェントとの共同作業も同様で、上の「AI併走」はその内訳を示す参考指標に過ぎず、
          スコアそのものからは差し引かれません。
        </p>
        <p className="mt-2">
          AI併走の判定は Co-authored-by: トレーラと PR 本文の生成マーカーに基づく申告ベースの検出であり、計測ではありません。
          0% は「AI を使っていない」ことの証明にはなりません。
        </p>
      </section>
    </main>
  );
}
