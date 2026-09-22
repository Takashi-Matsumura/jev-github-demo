import type { SVGProps } from "react";

/**
 * SVG 要素の title 属性はブラウザがネイティブツールチップとして使う正当な属性だが、
 * React の SVGProps 型定義には含まれていない。子要素としての <title> は React の
 * サーバーレンダラが HTML の document title と混同し、SSR 出力時に中身が空になる
 * （クライアントでは正しく描画されるためハイドレーション不一致を起こす）ので使わない。
 */
export type RectProps = SVGProps<SVGRectElement> & { title?: string };
