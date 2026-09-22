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
