# PR 貢献度ダッシュボード

GitHub リポジトリの Pull Request を取り込み、ルールと Jev（TypeSafe AI System One）の
ハイブリッド判定で分類し、開発者ごとの貢献度を数値化する社内向けツールです。

> **この数値は人事評価ではありません。** 議論のための材料です。すべてのスコアは
> どの PR のどの重み付けで算出されたかまで辿れます。詳しくは画面上部の注意書きと、
> 各開発者ドリルダウン画面の「計上していないもの」を参照してください。

## セットアップ

```bash
npm install
cp .env.local.example .env.local
# .env.local に TYPESAFE_API_KEY と（任意で）GITHUB_TOKEN を設定
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開いてください。

- `GITHUB_TOKEN` が未設定でも動きますが、GitHub REST API 経由・60 req/h に制限され、
  取得件数は最新 15 件までに絞られます。設定すると GraphQL 経由・5,000 req/h になり、
  1 クエリで PR・ファイル・レビューをまとめて取得できます。
- `TYPESAFE_API_KEY` が無いと Jev による分類（影響度・複雑度・リスクなどの判断）が動きません。
  ルールで確定できるカテゴリ（`feat:`/`fix:` などの接頭辞、ラベル、ファイルパターン）は
  API キーが無くても分類されます。

## 使い方

1. トップページでリポジトリ（`owner/repo`）と取得件数を指定して「取り込む」。
   これは GitHub からの読み取りのみで、Jev は呼びません。
2. 「送信内容を確認だけする（dryRun）」で、Jev に実際に送る内容を無料で確認できます。
   質問文の精度はここで詰めるのが前提です。
3. 納得したら「分類する」。ルールで確定できないカテゴリと、影響度・複雑度・リスクなどの
   判断のみを Jev に送ります（PR 1 件 = Jev 1 リクエスト）。
4. ダッシュボード → 開発者ドリルダウン → PR 詳細 と辿って、スコアの根拠と
   Jev の生の確率分布（Jev コンソール）を確認できます。

## 制約（意図的な設計判断）

- **ローカル専用です。** SQLite (`node:sqlite`) をファイルとして `.data/prs.db` に
  永続化しており、サーバーレス環境（Vercel 等）にはデプロイできません。
- **squash マージのリポジトリでは、共同作業の貢献が PR 作成者 1 人に全額計上されます。**
  人間同士の共同作業だけでなく、Claude Code などの AI エージェントとの共同作業も同様です。
  `Co-authored-by:` トレーラ（コミットの co-author）と PR 本文の生成マーカーから「AI併走」を
  検出して各画面に参考指標として表示しますが、**これはスコアには一切影響しません**。
  併走率は申告ベースの検出であり計測ではないため、0% は「AI を使っていない」ことの
  証明にはなりません。`GITHUB_TOKEN` 未設定（REST 経路）ではコミット単位の検出ができず
  「未計測」になります。
- リスクスコアは貢献度の計算に使いません（高リスクな仕事を避けた開発者が高得点になる
  逆インセンティブを避けるため）。「要注意 PR」の一覧・並び替え軸としてのみ使います。
- dev/prod サーバは同一オリジン以外からの POST（`/api/ingest`, `/api/classify`）を拒否します。
  ブラウザが別サイトを開いている間の blind POST で GitHub/Jev の API 消費を
  第三者に強いられるのを防ぐためです。
- **既存の `.data/prs.db` にはスキーマ変更が自動反映されません。** 全テーブルが
  `CREATE TABLE IF NOT EXISTS` の `lib/schema.sql` は v0 ベースラインとして凍結されており、
  それ以降のカラム追加は `lib/db.ts` の `MIGRATIONS`（`PRAGMA user_version` ベース）にのみ
  追記します。`lib/schema.sql` を直接書き換えても既存 DB には反映されません。
  - v1: AI co-author 検出の列（`ai_commit_count` 等）を `pull_requests` に追加。
  - v2: 「成長への助言」（`growth_advice` テーブル）を追加。開発者・PR・リポジトリの
    3スコープを1テーブルに収め、`signals_json`（決定論的に確定した観測事実。LLM を
    通していない）と `advice_json`（LLM の出力）を分けて保持します。
  - **マイグレーションは Node プロセスの再起動が必要です。** `lib/db.ts` の `getDb()` は
    `globalThis` にシングルトン保持するため、`next dev` を起動したままコードだけ更新しても
    新しいマイグレーションは適用されません（HMR では再実行されない）。

## 開発

```bash
npm run typecheck
npm run lint
npm run build && npm start
```
