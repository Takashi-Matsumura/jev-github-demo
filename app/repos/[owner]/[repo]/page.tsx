import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo, listClassifications } from "@/lib/queries";
import { scoreRepo, DEFAULT_WEIGHTS } from "@/lib/score";
import { formatNumber, formatInt } from "@/lib/format";
import { CategoryBadge } from "@/components/category-badge";

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
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((d) => {
                  const lowPct = Math.round(d.lowConfidenceShare * 100);
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
    </main>
  );
}
