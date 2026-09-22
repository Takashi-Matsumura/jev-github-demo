export function Disclaimer() {
  return (
    <div className="border-b border-warn-border bg-warn-bg px-4 py-2 text-center text-sm text-warn-fg">
      この数値は人事評価ではありません。議論のための材料です。すべてのスコアは内訳まで辿れます。
      数字だけで判断せず、必ず該当の Pull Request を見てください。
      ここに現れない貢献（設計の議論、障害対応、他者の支援、採用や育成）は一切計上されていません。
    </div>
  );
}
