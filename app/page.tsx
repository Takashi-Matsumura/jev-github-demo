import Link from "next/link";
import { hasGithubToken, hasTypesafeApiKey } from "@/lib/env";
import { listRepos } from "@/lib/queries";
import { formatDateTime, formatInt } from "@/lib/format";
import { IngestForm } from "@/components/ingest-form";
import { TransmissionNotice } from "@/components/transmission-notice";

export default function Home() {
  const repos = listRepos();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">PR 貢献度ダッシュボード</h1>
        <p className="mt-1 text-sm text-muted">
          GitHub の Pull Request を分類し、開発者ごとの貢献度を数値化します。
        </p>
      </div>

      <section className="space-y-3 rounded-lg border border-border p-4">
        <h2 className="font-medium">対象リポジトリ</h2>
        <IngestForm defaultOwner="Takashi-Matsumura" defaultRepo="grilljev-demo" />
      </section>

      <section className="space-y-2 rounded-lg border border-border p-4 text-sm">
        <h2 className="font-medium">接続状況</h2>
        <dl className="space-y-1 text-muted">
          <div className="flex justify-between">
            <dt>GITHUB_TOKEN</dt>
            <dd>{hasGithubToken() ? "あり（GraphQL 経由・5,000 req/h）" : "なし（REST 経由・60 req/h・最新15件まで）"}</dd>
          </div>
          <div className="flex justify-between">
            <dt>TYPESAFE_API_KEY</dt>
            <dd>{hasTypesafeApiKey() ? "あり" : "なし（分類の Jev 判断が動きません）"}</dd>
          </div>
        </dl>
      </section>

      <TransmissionNotice />

      {repos.length > 0 ? (
        <section className="space-y-2">
          <h2 className="font-medium">取り込み済みリポジトリ</h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {repos.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <Link href={`/repos/${r.owner}/${r.name}`} className="font-medium text-cat-feat underline">
                    {r.owner}/{r.name}
                  </Link>
                  <div className="text-xs text-muted">最終取り込み: {formatDateTime(r.last_ingest_at)}</div>
                </div>
                <div className="text-right text-xs text-muted">
                  PR {formatInt(r.prCount)} 件 / 分類済み {formatInt(r.classifiedCount)} 件
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
