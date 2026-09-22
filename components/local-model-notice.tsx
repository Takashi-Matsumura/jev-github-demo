import { getGemmaEndpoint, getGemmaModel } from "@/lib/env";

/** components/transmission-notice.tsx と対になる、助言セクション専用の「外部へは出ません」。 */
export function LocalModelNotice() {
  return (
    <details className="rounded-lg border border-border bg-surface p-3 text-sm">
      <summary className="cursor-pointer font-medium">外部へは出ません</summary>
      <div className="mt-2 space-y-2 text-muted">
        <p>
          助言の生成は <code className="font-mono">{getGemmaEndpoint()}</code>（モデル:{" "}
          <code className="font-mono">{getGemmaModel()}</code>）のローカル LLM に対してのみ行われ、TypeSafe にも
          どこにも送信されません。API キーも要りません。
        </p>
        <p>
          送るのは上の「観測事実」に出ている集計値だけで、コード本文は含みません。PR 単位の理解度チェックのみ、
          Jev に送るのと同じ範囲（タイトル・本文抜粋・変更ファイルのパス・行数）の要約を使います。
        </p>
      </div>
    </details>
  );
}
