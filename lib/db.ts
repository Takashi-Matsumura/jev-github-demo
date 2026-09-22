import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DB_PATH = join(process.cwd(), ".data", "prs.db");
const SCHEMA_PATH = join(process.cwd(), "lib", "schema.sql");

declare global {
  var __prsDb: DatabaseSync | undefined;
}

/**
 * schema.sql は全テーブルが CREATE TABLE IF NOT EXISTS なので、既存 DB には
 * 何も追加されない（no-op）。schema.sql は v0 ベースラインとして凍結し、
 * それ以降のスキーマ変更はここにのみ追記する。新規 DB は「schema.sql で v0 を
 * 作る → 全マイグレーション適用」、既存 DB は「user_version から差分適用」で
 * 同じ最終形に収束する。
 */
const MIGRATIONS: string[] = [
  // v1: AI co-author の検出結果を保持する列を追加
  `
  ALTER TABLE pull_requests ADD COLUMN ai_commit_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE pull_requests ADD COLUMN ai_agents TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE pull_requests ADD COLUMN ai_source TEXT NOT NULL DEFAULT 'unmeasured';
  ALTER TABLE pull_requests ADD COLUMN commits_truncated INTEGER NOT NULL DEFAULT 0;
  `,
  // v2: 成長への助言（手元の言語モデルによる生成物）を保持するテーブルを追加。
  // dev/pr/repo の3スコープを1テーブルに収める。生成にコストがかかるため生成物は
  // 必ず保存し、再生成は signals_version/prompt_version の不一致か force 指定でのみ行う。
  `
  CREATE TABLE IF NOT EXISTS growth_advice (
    repo_id         INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    scope           TEXT    NOT NULL,           -- 'dev' | 'pr' | 'repo'
    subject         TEXT    NOT NULL,           -- dev: login / pr: 番号の文字列 / repo: ''
    signals_json    TEXT    NOT NULL,           -- 決定論的に確定した観測事実。LLM を通していない
    signals_version TEXT    NOT NULL,
    prompt_version  TEXT    NOT NULL,
    exchange_json   TEXT,                       -- 送ったもの・返ってきたものそのまま。NULL なら呼ぶ前に落ちた
    advice_json     TEXT,                       -- スキーマ検証を通した構造化出力
    model           TEXT,
    input_tokens    INTEGER,
    output_tokens   INTEGER,
    elapsed_ms      INTEGER,
    needs_review    INTEGER NOT NULL DEFAULT 0, -- カタログ外 id など、検証で落ちたものがあった
    error           TEXT,
    generated_at    TEXT    NOT NULL,
    PRIMARY KEY (repo_id, scope, subject)
  );
  `,
];

function migrate(db: DatabaseSync): void {
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec(MIGRATIONS[i]);
  }
  if (version < MIGRATIONS.length) {
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
  }
}

function openDb(): DatabaseSync {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  db.exec(schema);
  migrate(db);
  return db;
}

/**
 * dev の HMR で `next dev` がこのモジュールを再評価しても接続が増殖しないよう、
 * globalThis にシングルトンとして保持する。
 */
export function getDb(): DatabaseSync {
  if (!globalThis.__prsDb) {
    globalThis.__prsDb = openDb();
  }
  return globalThis.__prsDb;
}

export function tableNames(): string[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}
