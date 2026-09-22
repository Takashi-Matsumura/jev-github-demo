import "server-only";
import { createHash } from "node:crypto";
import type { JevQuestion } from "@/lib/jev";

type PrStateFileInput = { path: string; generated: boolean | number };

const MAX_BODY = 1_200;
const MAX_PATHS = 40;
const MAX_LABELS = 10;
const MAX_COMMITS = 10;
const MAX_COMMIT_LEN = 120;

/** TypeSafe へ実際に送られるもの。ここに入れたものだけが外部へ出る。UI の明示文言と一致させること。 */
export type PrState = {
  repo: string;
  number: number;
  title: string;
  body_excerpt: string;
  labels: string[];
  changed_files: string[];
  changed_files_omitted: number;
  additions: number;
  deletions: number;
  changed_file_count: number;
  commit_count: number;
  commit_titles: string[];
  review_count: number;
};

function stripBody(raw: string | null): string {
  if (!raw) return "";
  let s = raw;
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "[画像]");
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  if (s.length > MAX_BODY) {
    s = s.slice(0, MAX_BODY) + "…（以下省略）";
  }
  return s;
}

export function buildPrState(input: {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  files: PrStateFileInput[];
  additions: number;
  deletions: number;
  changedFileCount: number;
  commitCount: number;
  commitTitles: string[];
  reviewCount: number;
}): PrState {
  const nonGenerated = input.files.filter((f) => !f.generated);
  const paths = nonGenerated.map((f) => f.path);

  return {
    repo: `${input.owner}/${input.repo}`,
    number: input.number,
    title: input.title.slice(0, 200),
    body_excerpt: stripBody(input.body),
    labels: input.labels.slice(0, MAX_LABELS),
    changed_files: paths.slice(0, MAX_PATHS),
    changed_files_omitted: Math.max(0, paths.length - MAX_PATHS),
    additions: input.additions,
    deletions: input.deletions,
    changed_file_count: input.changedFileCount,
    commit_count: input.commitCount,
    commit_titles: input.commitTitles.slice(0, MAX_COMMITS).map((t) => t.slice(0, MAX_COMMIT_LEN)),
    review_count: input.reviewCount,
  };
}

export const IMPACT_LEVELS = [
  "影響なしに等しい。自動生成物の更新・整形・誤字修正など、動作にも読み手にも実質的な変化がない",
  "限定的。1 つのファイルや 1 つの内部関数の中で閉じており、他の箇所の振る舞いは変わらない",
  "中程度。1 つの機能または 1 つの画面の範囲で、利用者か開発者が気づく変化がある",
  "大きい。複数の機能やモジュールにまたがり、他の開発者の作業や既存の使い方に影響する",
  "極めて大きい。製品の中心となる機能の追加や置き換え、アーキテクチャまたは公開インターフェースの変更",
] as const;

export const COMPLEXITY_LEVELS = [
  "定型作業。機械的な置換・依存の更新・文章の修正で、技術的な判断をほとんど必要としない",
  "容易。既存の実装パターンをなぞれば書ける。新しい設計判断は不要",
  "標準的。複数箇所の整合を取りながら書く必要があり、いくつかの設計判断を含む",
  "難しい。非同期処理・状態管理・並行性・型設計など、誤りやすい領域での判断を含む",
  "非常に難しい。新しい設計の考案、既存構造の大きな組み替え、性能や整合性の難所への対処を含む",
] as const;

export const RISK_LEVELS = [
  "ほぼ無風。壊れても製品に影響しない範囲（文書・コメント・テストのみ）",
  "低い。問題が起きてもすぐ気づけ、元に戻すのも容易",
  "中程度。本番の挙動を変えるが、変更範囲が限定的で切り戻せる",
  "高い。データ移行・認証や権限・課金・外部連携・広範な削除など、失敗の影響が大きく元に戻しにくい",
] as const;

export function buildQuestions({ askCategory }: { askCategory: boolean }): Record<string, JevQuestion> {
  const q: Record<string, JevQuestion> = {};

  if (askCategory) {
    q.category = {
      type: "choice",
      instructions:
        "この Pull Request で実際に行われた作業は、主にどの種類か。タイトルの接頭辞を鵜呑みにせず、変更されたファイルの顔ぶれと差分の規模から判断すること。複数に当てはまる場合は、差分の大半を占めている方を 1 つ選ぶ。",
      criteria: {
        feat: "利用者または他の開発者が使える機能・画面・API を新しく追加している",
        fix: "すでに存在する機能の誤った動作を直している。再現する不具合への対処",
        perf: "外から見た結果は変えずに、速度・メモリ使用量・転送量などの性能を改善している",
        refactor: "外から見た振る舞いを変えずに、内部の構造・命名・分割を整理している",
        test: "テストコードの追加または修正が、この変更の中心である",
        docs: "README・設計文書・コード内コメントなど、文章の追加や修正が変更の中心である",
        ci: "CI 設定・ビルド設定・デプロイ設定・依存関係の更新など、開発基盤の変更である",
        chore: "上のどれにも当てはまらない雑務。設定値の微調整、ファイルの移動、自動生成物の更新など",
        revert: "過去に入れた変更を取り消している",
      },
    };
  }

  q.impact = {
    type: "score",
    instructions:
      "この Pull Request が製品とコードベースに与える影響の大きさはどの程度か。行数の多さではなく、変更が及ぶ範囲の広さと、他の人の作業や利用者への波及で判断すること。",
    criteria: [...IMPACT_LEVELS],
  };

  q.complexity = {
    type: "score",
    instructions:
      "この Pull Request を書き上げるのに必要だった技術的な難しさはどの程度か。分量ではなく、判断の難しさと間違えやすさで判断すること。大量でも単調な変更は難しくない。",
    criteria: [...COMPLEXITY_LEVELS],
  };

  q.risk = {
    type: "score",
    instructions:
      "この Pull Request を本番に入れたとき、問題が起きた場合の影響の深刻さと、元に戻しにくさはどの程度か。変更が良いか悪いかではなく、失敗したときの打撃の大きさを見ること。",
    criteria: [...RISK_LEVELS],
  };

  q.user_facing = {
    type: "noul",
    instructions: "この Pull Request の変更は、製品の利用者が画面や動作の違いとして気づくものか",
    criteria: {
      true: "画面の見た目・文言・操作の流れ・応答内容のいずれかが変わり、利用者が違いを認識できる",
      false: "内部実装・開発環境・テスト・文書のみの変更で、利用者から見た製品は何も変わらない",
    },
  };

  q.breaking_change = {
    type: "noul",
    instructions: "この Pull Request は、既存の利用者や他の開発者に追随作業を強いる破壊的変更を含むか",
    criteria: {
      true: "公開 API・関数の引数や戻り値・設定項目・データ形式・URL などが後方互換性を保たずに変更または削除されており、呼び出し側の修正や移行作業が必要になる",
      false: "追加のみ、または互換性を保った変更であり、既存の呼び出し側は手を加えなくても動き続ける",
    },
  };

  q.tests_included = {
    type: "noul",
    instructions: "この Pull Request は、自らが加えた変更を検証するテストコードを含んでいるか",
    criteria: {
      true: "変更したロジックに対応するテストが、この Pull Request の中で追加または更新されている",
      false: "テストの追加・更新がない。テストファイルに触れていても、体裁の修正だけで検証される内容が増えていない場合も false",
    },
  };

  q.scope_coherence = {
    type: "noul",
    instructions: "この Pull Request は 1 つの目的にまとまっており、レビュアーが一度に読み切れる単位になっているか",
    criteria: {
      true: "変更されたファイル群が 1 つの目的で説明でき、無関係な修正が混ざっていない",
      false: "無関係な複数の変更が 1 つの Pull Request に同居している、または範囲が広すぎて一度にレビューするのが難しい",
    },
  };

  q.title_matches_diff = {
    type: "noul",
    instructions: "この Pull Request のタイトルと説明は、実際に変更されたファイルと差分の内容を正しく言い表しているか",
    criteria: {
      true: "タイトルと説明から想像される作業内容が、変更されたファイルの顔ぶれと一致している",
      false: "タイトルや説明が実際の変更より過大または過小である、内容が食い違っている、あるいは説明が空でタイトルだけでは何をしたのか判断できない",
    },
  };

  return q;
}

/** 質問リテラルの内容ハッシュ。文言を変えると自動で変わるので、版の付け忘れが起きない。 */
export function questionsVersion(askCategory: boolean): string {
  const literal = JSON.stringify(buildQuestions({ askCategory }));
  return createHash("sha256").update(literal).digest("hex").slice(0, 12) + (askCategory ? "-c" : "-nc");
}
