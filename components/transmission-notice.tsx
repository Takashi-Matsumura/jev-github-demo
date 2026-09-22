export function TransmissionNotice() {
  return (
    <details className="rounded-lg border border-border bg-surface p-3 text-sm">
      <summary className="cursor-pointer font-medium">外部へ出る情報</summary>
      <div className="mt-2 space-y-2 text-muted">
        <p>
          GitHub から取得した Pull Request のうち、以下だけが判定のために{" "}
          <code className="font-mono">api.typesafe.ai</code>（Jev / TypeSafe AI）へ送信されます。
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li>PR タイトル・本文の先頭 1,200 字（画像やコメントは除去済み）</li>
          <li>ラベル</li>
          <li>変更されたファイルのパス（lock ファイルや vendor 等の生成物は除外）</li>
          <li>追加・削除行数、変更ファイル数、コミット件名</li>
          <li>レビュー件数</li>
        </ul>
        <p>
          <strong>差分の本文（コードそのもの）は GitHub から取得も TypeSafe への送信もしません。</strong>
        </p>
      </div>
    </details>
  );
}
