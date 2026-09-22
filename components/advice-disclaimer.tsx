/** 助言セクション専用の免責。全ページ上部の Disclaimer とは別に、助言の直前に必ず出す。 */
export function AdviceDisclaimer() {
  return (
    <div className="rounded-lg border border-warn-border bg-warn-bg px-3 py-2 text-xs text-warn-fg">
      ここに出ている文章は手元の言語モデル（gemma-4-12b）が生成したものです。<strong>数値は生成していません</strong>
      —— 上の観測事実は Pull Request のデータから決定論的に計算したもので、モデルはその読み方と学習テーマの選択だけを行っています。
      判定不能の指標についてモデルは何も言いません。文章は誤ることがあります。必ず数値と Pull Request そのものを見てください。
    </div>
  );
}
