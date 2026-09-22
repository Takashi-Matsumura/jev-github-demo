import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo, listClassifications, getAdvice } from "@/lib/queries";
import { scoreRepo, DEFAULT_WEIGHTS } from "@/lib/score";
import { formatNumber, formatInt } from "@/lib/format";
import { CategoryBadge } from "@/components/category-badge";
import {
  weeklyActivity,
  leadTimeHistogram,
  sizeHistogram,
  reviewStateBreakdown,
  reviewMatrix,
  aiCoauthorStats,
  weeklyAiRate,
} from "@/lib/analytics";
import { ColumnChart } from "@/components/chart/column-chart";
import { Histogram } from "@/components/chart/histogram";
import { StackedBar } from "@/components/chart/stacked-bar";
import { Heatmap } from "@/components/chart/heatmap";
import { Meter } from "@/components/chart/meter";
import { buildRepoSignals } from "@/lib/growth";
import { SignalTable, TrendTable } from "@/components/signal-table";
import { StrataCompare } from "@/components/strata-compare";
import { DomainCoverageView } from "@/components/domain-coverage";
import type { RepoAdvice } from "@/lib/advice";
import { findLearningTheme } from "@/lib/learning-catalog";
import { AdviceDisclaimer } from "@/components/advice-disclaimer";
import { AdviceButton } from "@/components/advice-button";
import { GemmaConsole, type GemmaExchangeLike } from "@/components/gemma-console";
import { LocalModelNotice } from "@/components/local-model-notice";

export default async function RepoDashboard(props: PageProps<"/repos/[owner]/[repo]">) {
  const { owner, repo } = await props.params;
  const sp = await props.searchParams;
  const sort = (Array.isArray(sp.sort) ? sp.sort[0] : sp.sort) ?? "total";

  const repoRow = getRepo(owner, repo);
  if (!repoRow) notFound();

  const { developers, weightsVersion } = scoreRepo(repoRow.id);
  const classifications = listClassifications(repoRow.id);

  const sorted = [...developers].sort((a, b) => {
    if (sort === "login") return a.login.localeCompare(b.login);
    if (sort === "prs") return b.prCount - a.prCount;
    if (sort === "reviews") return b.reviewCount - a.reviewCount;
    return b.total - a.total;
  });

  const ruleCount = classifications.filter((c) => c.category_source === "rule").length;
  const jevCount = classifications.filter((c) => c.category_source === "jev").length;
  const needsReviewCount = classifications.filter((c) => c.needs_review).length;
  const inputTokens = classifications.reduce((s, c) => s + (c.jev_input_tokens ?? 0), 0);
  const outputTokens = classifications.reduce((s, c) => s + (c.jev_output_tokens ?? 0), 0);
  const avgElapsed =
    classifications.filter((c) => c.jev_elapsed_ms != null).reduce((s, c) => s + (c.jev_elapsed_ms ?? 0), 0) /
    (classifications.filter((c) => c.jev_elapsed_ms != null).length || 1);

  const categoryTotals = new Map<string, number>();
  for (const c of classifications) categoryTotals.set(c.category, (categoryTotals.get(c.category) ?? 0) + 1);
  const totalClassified = classifications.length || 1;

  const riskyPrs = classifications
    .filter((c) => (c.risk ?? 0) >= 3 || (c.breaking_change ?? 0) > 0.7)
    .sort((a, b) => (b.risk ?? 0) - (a.risk ?? 0))
    .slice(0, 5);

  const activity = weeklyActivity(repoRow.id);
  const leadTimeBins = leadTimeHistogram(repoRow.id);
  const sizeBins = sizeHistogram(repoRow.id);
  const reviews = reviewStateBreakdown(repoRow.id);
  const matrix = reviewMatrix(repoRow.id);
  const aiStats = aiCoauthorStats(repoRow.id);
  const aiWeekly = weeklyAiRate(repoRow.id);
  const aiRatesByDev = new Map(sorted.map((d) => [d.login, aiCoauthorStats(repoRow.id, d.login)]));
  const growth = buildRepoSignals(repoRow.id);

  const adviceRow = getAdvice(repoRow.id, "repo", "");
  const repoAdvice = adviceRow?.advice_json ? (JSON.parse(adviceRow.advice_json) as RepoAdvice) : null;
  const repoAdviceExchange = adviceRow?.exchange_json ? (JSON.parse(adviceRow.exchange_json) as GemmaExchangeLike) : null;

  const sortLink = (key: string, label: string) => (
    <Link href={`/repos/${owner}/${repo}?sort=${key}`} className={sort === key ? "font-semibold underline" : "text-muted"}>
      {label}
    </Link>
  );

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-muted underline">
            ← リポジトリ選択に戻る
          </Link>
          <h1 className="text-2xl font-semibold">
            {owner}/{repo}
          </h1>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border p-3 text-sm">
          <div className="text-muted">分類の出どころ</div>
          <div className="font-mono">
            ルール {formatInt(ruleCount)} / Jev {formatInt(jevCount)}
          </div>
        </div>
        <div className="rounded-lg border border-border p-3 text-sm">
          <div className="text-muted">人の確認待ち</div>
          <div className="font-mono">{formatInt(needsReviewCount)} 件</div>
        </div>
        <div className="rounded-lg border border-border p-3 text-sm">
          <div className="text-muted">Jev 消費</div>
          <div className="font-mono">
            {formatInt(inputTokens)}in / {formatInt(outputTokens)}out · 平均 {formatInt(Math.round(avgElapsed))}ms
          </div>
        </div>
        <div className="rounded-lg border border-border p-3 text-sm">
          <div className="text-muted">AI併走コミット率</div>
          <Meter ratio={aiStats.commitRate} />
          <div className="mt-1 font-mono text-xs text-muted">
            {formatInt(aiStats.aiCommits)}/{formatInt(aiStats.totalCommits)} コミット
          </div>
          <div className="mt-1 text-xs text-muted">
            trailer {formatInt(aiStats.sourceCounts.trailer)} · body {formatInt(aiStats.sourceCounts.body)} · 未計測{" "}
            {formatInt(aiStats.sourceCounts.unmeasured)}
          </div>
          {aiStats.agents.length > 0 ? (
            <div className="mt-1 text-xs text-muted">検出: {aiStats.agents.join(", ")}</div>
          ) : null}
          <p className="mt-1 text-xs text-muted">
            Co-authored-by: は申告であり計測ではありません。0% は「AI を使っていない」証明にはなりません。スコアには影響しません。
          </p>
        </div>
        <details className="rounded-lg border border-border p-3 text-sm">
          <summary className="cursor-pointer text-muted">配点 {weightsVersion} ▾</summary>
          <div className="mt-2 space-y-1 font-mono text-xs">
            <div>base={DEFAULT_WEIGHTS.base}</div>
            <div>
              category:{" "}
              {Object.entries(DEFAULT_WEIGHTS.category)
                .map(([k, v]) => `${k}=${v}`)
                .join(" ")}
            </div>
            <div>
              size: refLoc={DEFAULT_WEIGHTS.size.refLoc} range=[{DEFAULT_WEIGHTS.size.min},{DEFAULT_WEIGHTS.size.max}]
            </div>
            <p className="mt-1 text-muted">
              リスクは既定でスコアに使いません（高リスク作業を避けた方が高得点になる逆インセンティブを避けるため）。
              下の「要注意 PR」の並び替え軸としてのみ使います。
            </p>
          </div>
        </details>
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">開発者リーダーボード</h2>
          <div className="flex gap-3 text-sm">
            {sortLink("total", "総合")}
            {sortLink("prs", "PR数")}
            {sortLink("reviews", "レビュー数")}
            {sortLink("login", "login")}
          </div>
        </div>

        {sorted.length === 0 ? (
          <p className="text-sm text-muted">分類済みの開発者がいません。ホームで分類を実行してください。</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">開発者</th>
                  <th className="px-3 py-2">総合</th>
                  <th className="px-3 py-2">実装</th>
                  <th className="px-3 py-2">レビュー</th>
                  <th className="px-3 py-2">PR数</th>
                  <th className="px-3 py-2">+/-</th>
                  <th className="px-3 py-2">AI併走</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((d) => {
                  const lowPct = Math.round(d.lowConfidenceShare * 100);
                  const ai = aiRatesByDev.get(d.login);
                  return (
                    <tr key={d.login}>
                      <td className="px-3 py-2">
                        <Link href={`/repos/${owner}/${repo}/devs/${d.login}`} className="font-medium text-cat-feat underline">
                          {d.login}
                        </Link>
                        {d.smallSample ? <span className="ml-2 text-xs text-warn-fg">参考値（n={d.prCount}）</span> : null}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-mono">{formatNumber(d.total)}</div>
                        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface">
                          <div className="flex h-full w-full">
                            <div
                              className="h-full bg-cat-feat"
                              style={{ width: `${100 - lowPct}%` }}
                            />
                            <div
                              className="h-full bg-cat-feat/40"
                              style={{
                                width: `${lowPct}%`,
                                backgroundImage:
                                  "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)",
                              }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono">{formatNumber(d.authoringScore)}</td>
                      <td className="px-3 py-2 font-mono">{formatNumber(d.reviewScore)}</td>
                      <td className="px-3 py-2 font-mono">{formatInt(d.prCount)}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        <span className="text-cat-test">+{formatInt(d.additions)}</span>{" "}
                        <span className="text-cat-fix">-{formatInt(d.deletions)}</span>
                      </td>
                      <td className="px-3 py-2">
                        {ai && ai.measured ? (
                          <div className="w-20">
                            <Meter ratio={ai.commitRate} />
                          </div>
                        ) : (
                          <span className="text-xs text-muted">未計測</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">カテゴリ別 PR 分布</h2>
        <div className="flex h-4 w-full overflow-hidden rounded-full border border-border">
          {[...categoryTotals.entries()].map(([cat, count]) => (
            <div
              key={cat}
              style={{ width: `${(count / totalClassified) * 100}%`, backgroundColor: `var(--cat-${cat}, var(--cat-other))` }}
              title={`${cat}: ${count}`}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {[...categoryTotals.entries()].map(([cat, count]) => (
            <span key={cat} className="inline-flex items-center gap-1">
              <CategoryBadge category={cat} /> {count}
            </span>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">週次の活動推移（マージ PR 数）</h2>
        <ColumnChart data={activity.prCount} legend={activity.legend} formatValue={formatInt} emptyLabel="マージ済み PR がありません" />
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">週次の活動推移（スコア合計）</h2>
        <ColumnChart data={activity.score} legend={activity.legend} formatValue={(n) => formatNumber(n, 0)} emptyLabel="マージ済み PR がありません" />
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">週次の AI併走 PR 比率</h2>
        <ColumnChart data={aiWeekly} formatValue={(n) => `${n}%`} height={100} emptyLabel="マージ済み PR がありません" />
      </section>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <section className="space-y-2">
          <h2 className="font-medium">リードタイム分布（作成 → マージ）</h2>
          <Histogram bins={leadTimeBins} color="var(--cat-feat)" />
        </section>
        <section className="space-y-2">
          <h2 className="font-medium">PR サイズ分布（実効LOC・生成物除く）</h2>
          <Histogram bins={sizeBins} color="var(--cat-refactor)" />
        </section>
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">レビュー内訳</h2>
          <span className="text-xs text-muted">自己レビュー・bot は除く / 計 {formatInt(reviews.total)} 件</span>
        </div>
        {reviews.total === 0 ? (
          <p className="text-sm text-muted">
            他者レビューの実績がありません。単独開発のリポジトリでは常にこうなります — 「レビュー貢献 0」は活動不足ではなく、
            レビュー対象になる相手がいないことを意味します。
          </p>
        ) : (
          <StackedBar segments={reviews.segments} legend={reviews.legend} />
        )}
      </section>

      {matrix.rows.length > 0 && matrix.cols.length > 0 ? (
        <section className="space-y-2">
          <h2 className="font-medium">レビュー相互作用マトリクス（行=レビュアー、列=PR作成者）</h2>
          <Heatmap rows={matrix.rows} cols={matrix.cols} value={matrix.value} />
        </section>
      ) : null}

      {riskyPrs.length > 0 ? (
        <section className="space-y-2">
          <h2 className="font-medium">要注意 PR</h2>
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {riskyPrs.map((c) => (
              <li key={c.number} className="flex items-center justify-between px-3 py-2">
                <Link href={`/repos/${owner}/${repo}/prs/${c.number}`} className="text-cat-feat underline">
                  #{c.number}
                </Link>
                <span className="text-xs text-muted">
                  risk={c.risk ?? "—"} breaking={(c.breaking_change ?? 0).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-4 rounded-lg border border-border p-4">
        <div>
          <h2 className="font-medium">チームの傾向（観測事実）</h2>
          <p className="mt-1 text-xs text-muted">
            ここに出ている数値はすべて Pull Request のデータから決定論的に計算したもので、AI（Jev・その他）は
            一切通していません。判定不能の指標は値を出さず、理由だけを示します。
          </p>
        </div>

        <div className="space-y-1">
          <div className="text-sm font-medium">技術領域の広がり</div>
          <DomainCoverageView domains={growth.domains} />
        </div>

        <div className="space-y-1">
          <div className="text-sm font-medium">推移（前半 → 直近）</div>
          <TrendTable trends={growth.trends} />
        </div>

        <div className="space-y-1">
          <div className="text-sm font-medium">品質（テスト・説明力）</div>
          <SignalTable signals={growth.quality} />
        </div>

        <div className="space-y-1">
          <div className="text-sm font-medium">レビュー活動（他人のコードを読む量）</div>
          <SignalTable signals={growth.review} />
        </div>

        <div className="space-y-1">
          <div className="text-sm font-medium">AI併走の有無で見た違い</div>
          <StrataCompare strata={growth.strata} />
        </div>

        <AdviceDisclaimer />

        {repoAdvice && repoAdvice.undetermined.length > 0 ? (
          <div className="space-y-1 rounded-lg border border-warn-border p-3 text-sm">
            <div className="text-xs font-medium text-warn-fg">判定できなかったこと</div>
            <ul className="list-inside list-disc space-y-0.5 text-warn-fg">
              {repoAdvice.undetermined.map((u, i) => (
                <li key={i}>{u}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="space-y-1">
          <div className="text-sm font-medium">助言</div>
          {repoAdvice ? (
            <div className="space-y-3 rounded-lg border border-border p-3 text-sm">
              <p>{repoAdvice.summary}</p>
              {repoAdvice.team_patterns.length > 0 ? (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted">チームの傾向</div>
                  <ul className="space-y-1">
                    {repoAdvice.team_patterns.map((s, i) => (
                      <li key={i}>
                        <code className="mr-1 text-xs text-muted">[{s.signal}]</code>
                        {s.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted">まだ生成していません。下のボタンから生成できます。</p>
          )}
        </div>

        {repoAdvice && repoAdvice.themes.length > 0 ? (
          <div className="space-y-1">
            <div className="text-sm font-medium">おすすめの学習テーマ</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {repoAdvice.themes.map((t) => {
                const theme = findLearningTheme(t.id);
                if (!theme) return null;
                return (
                  <div key={t.id} className="rounded-lg border border-border p-3 text-sm">
                    <div className="font-medium">{theme.title}</div>
                    <p className="mt-1 text-xs text-muted">{t.reason}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {theme.refs.map((r) => (
                        <a key={r.url} href={r.url} target="_blank" rel="noreferrer" className="text-cat-feat underline">
                          {r.label}
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <AdviceButton owner={owner} repo={repo} scope="repo" subject="" />
        <GemmaConsole exchange={repoAdviceExchange} />
        <LocalModelNotice />
      </section>
    </main>
  );
}
