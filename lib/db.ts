import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DB_PATH = join(process.cwd(), ".data", "prs.db");
const SCHEMA_PATH = join(process.cwd(), "lib", "schema.sql");

declare global {
  // eslint-disable-next-line no-var
  var __prsDb: DatabaseSync | undefined;
}

function openDb(): DatabaseSync {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  db.exec(schema);
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
