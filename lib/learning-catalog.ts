import "server-only";

/**
 * 「成長への助言」のおすすめ学習テーマ。lib/gemma.ts は id からの選択と理由付けだけを行い、
 * URL・書名・記事名は一切生成させない ── プロンプトに渡すのは id/title/summary までで、
 * refs はモデルに見せない（画面表示のときにこのカタログから引く）。これが捏造防止の本命。
 *
 * as const で持つことで、id がリテラル型になり、lib/advice-prompt.ts の json_schema の
 * enum と TypeScript の型が同じ1つの真実から出る（カタログを JSON で持つと型が分かれてしまう）。
 *
 * refs の URL は追加・変更のたびに人間が実際に開いて実在を確認すること。
 */
export type LearningTheme = {
  readonly id: string;
  readonly title: string;
  /** 何が身につくか。1〜2文。プロンプトに入るのはここまで。 */
  readonly summary: string;
  /** どの観測事実（lib/growth.ts の Signal.key など）が高い/低いときに効くか。
   *  人間がカタログを保守するための覚書で、プロンプトには入れない。 */
  readonly relatesTo: readonly string[];
  /** 参考資料。プロンプトには一切入れない。 */
  readonly refs: readonly { readonly label: string; readonly url: string }[];
};

export const LEARNING_CATALOG = [
  {
    id: "reading-others-code",
    title: "他人のコードを読む",
    summary: "自分で書く量が増えるほど後回しになりがちな力。読む量と書く量の比が低いときに効く。",
    relatesTo: ["reviews_given", "distinct_authors_reviewed", "read_write_ratio"],
    refs: [{ label: "Google Engineering Practices: How to do a code review", url: "https://google.github.io/eng-practices/review/reviewer/" }],
  },
  {
    id: "review-craft",
    title: "レビューの書き方（指摘の粒度と変更要求）",
    summary: "コメントを付けるだけでなく、変更を求めるべき箇所を見極める力。",
    relatesTo: ["substantial_review_share", "changes_requested_share"],
    refs: [{ label: "Google Engineering Practices: How to write code review comments", url: "https://google.github.io/eng-practices/review/reviewer/comments.html" }],
  },
  {
    id: "small-prs",
    title: "変更を小さく切る（1 PR 1 目的）",
    summary: "レビューしやすく、後から読み返しやすい単位に分割する力。",
    relatesTo: ["scope_coherence", "size_median"],
    refs: [{ label: "Google Engineering Practices: Small CLs", url: "https://google.github.io/eng-practices/review/developer/small-cls.html" }],
  },
  {
    id: "writing-pr-description",
    title: "変更を説明する（タイトルと差分を一致させる）",
    summary: "何をなぜ変えたかを、差分を読まなくても伝わるように書く力。",
    relatesTo: ["title_matches_diff"],
    refs: [{ label: "Google Engineering Practices: Writing good CL descriptions", url: "https://google.github.io/eng-practices/review/developer/cl-descriptions.html" }],
  },
  {
    id: "test-design",
    title: "テスト設計（何を検証すべきか決める）",
    summary: "テストを書く習慣そのものより、何を検証すれば十分かを判断する力。",
    relatesTo: ["tests_by_path", "tests_by_jev"],
    refs: [{ label: "Martin Fowler: Test Driven Development", url: "https://martinfowler.com/bliki/TestDrivenDevelopment.html" }],
  },
  {
    id: "debugging-without-assistant",
    title: "補助なしで原因を追う（仮説→観測→絞り込み）",
    summary: "AI の提案に頼らず、手元で再現・切り分けを進める力。",
    relatesTo: ["strata_complexity", "lead_time_median"],
    refs: [{ label: "Wikipedia: Debugging", url: "https://en.wikipedia.org/wiki/Debugging" }],
  },
  {
    id: "reading-stack-traces",
    title: "エラーと失敗の読み方",
    summary: "スタックトレースやエラーコードから、どこを見るべきかを素早く判断する力。",
    relatesTo: [],
    refs: [{ label: "Node.js Documentation: Errors", url: "https://nodejs.org/api/errors.html" }],
  },
  {
    id: "async-and-concurrency",
    title: "非同期と並行性",
    summary: "誤りやすい領域として complexity の判定基準にも挙がる分野。",
    relatesTo: ["complexity"],
    refs: [{ label: "MDN: Asynchronous JavaScript", url: "https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Async_JS" }],
  },
  {
    id: "type-design",
    title: "型で不正な状態を表現できなくする",
    summary: "実行時のチェックに頼らず、型そのもので誤りを防ぐ設計。",
    relatesTo: ["complexity"],
    refs: [{ label: "Alexis King: Parse, don't validate", url: "https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/" }],
  },
  {
    id: "data-modeling",
    title: "データモデリングとマイグレーション",
    summary: "スキーマを安全に変更し、既存データとの整合を保つ力。",
    relatesTo: ["domain:db"],
    refs: [{ label: "SQLite: ALTER TABLE", url: "https://www.sqlite.org/lang_altertable.html" }],
  },
  {
    id: "api-contract",
    title: "後方互換と破壊的変更",
    summary: "呼び出し側を壊さずに変更する境界の見極め。",
    relatesTo: ["breaking_change"],
    refs: [{ label: "Semantic Versioning 2.0.0", url: "https://semver.org/" }],
  },
  {
    id: "performance-measurement",
    title: "推測せず計測する",
    summary: "「速そう」で判断せず、実測してから手を入れる習慣。",
    relatesTo: ["domain:perf"],
    refs: [{ label: "web.dev: Web Vitals", url: "https://web.dev/articles/vitals" }],
  },
  {
    id: "domain-breadth",
    title: "触れていない領域へ踏み出す",
    summary: "特定領域への集中が高いとき、意図的に別の領域の PR を取りに行く。",
    relatesTo: ["domain_coverage", "domain_concentration"],
    refs: [{ label: "MDN: Learn web development", url: "https://developer.mozilla.org/en-US/docs/Learn_web_development" }],
  },
  {
    id: "refactoring-safely",
    title: "安全に構造を変える",
    summary: "振る舞いを変えずに設計を改善する、小さな手順の積み重ね方。",
    relatesTo: ["domain:refactor"],
    refs: [{ label: "Martin Fowler: Refactoring", url: "https://martinfowler.com/books/refactoring.html" }],
  },
  {
    id: "incident-response",
    title: "壊れたときに戻す力",
    summary: "問題発生時の切り分けと、安全な切り戻し手順の設計。",
    relatesTo: ["risk", "domain:revert"],
    refs: [{ label: "Google SRE Book: Effective Troubleshooting", url: "https://sre.google/sre-book/effective-troubleshooting/" }],
  },
] as const satisfies readonly LearningTheme[];

export type LearningThemeId = (typeof LEARNING_CATALOG)[number]["id"];

export function findLearningTheme(id: string): LearningTheme | undefined {
  return LEARNING_CATALOG.find((t) => t.id === id);
}
