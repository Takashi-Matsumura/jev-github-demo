PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS repos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  owner          TEXT    NOT NULL,
  name           TEXT    NOT NULL,
  default_branch TEXT,
  last_ingest_at TEXT,
  UNIQUE (owner, name)
);

CREATE TABLE IF NOT EXISTS pull_requests (
  repo_id         INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  number          INTEGER NOT NULL,
  title           TEXT    NOT NULL,
  body            TEXT,
  author_login    TEXT,
  author_is_bot   INTEGER NOT NULL DEFAULT 0,
  state           TEXT    NOT NULL,
  created_at      TEXT    NOT NULL,
  merged_at       TEXT,
  additions       INTEGER NOT NULL DEFAULT 0,
  deletions       INTEGER NOT NULL DEFAULT 0,
  changed_files   INTEGER NOT NULL DEFAULT 0,
  commit_count    INTEGER NOT NULL DEFAULT 0,
  commit_titles   TEXT    NOT NULL DEFAULT '[]',
  review_count    INTEGER NOT NULL DEFAULT 0,
  comment_count   INTEGER NOT NULL DEFAULT 0,
  labels_json     TEXT    NOT NULL DEFAULT '[]',
  url             TEXT,
  files_truncated INTEGER NOT NULL DEFAULT 0,
  fetched_at      TEXT    NOT NULL,
  PRIMARY KEY (repo_id, number)
);
CREATE INDEX IF NOT EXISTS idx_pr_author ON pull_requests (repo_id, author_login);
CREATE INDEX IF NOT EXISTS idx_pr_merged ON pull_requests (repo_id, merged_at);

CREATE TABLE IF NOT EXISTS pr_files (
  repo_id   INTEGER NOT NULL,
  number    INTEGER NOT NULL,
  path      TEXT    NOT NULL,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  status    TEXT,
  generated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (repo_id, number, path),
  FOREIGN KEY (repo_id, number) REFERENCES pull_requests (repo_id, number) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pr_reviews (
  repo_id         INTEGER NOT NULL,
  number          INTEGER NOT NULL,
  review_id       TEXT    NOT NULL,
  reviewer_login  TEXT    NOT NULL,
  reviewer_is_bot INTEGER NOT NULL DEFAULT 0,
  state           TEXT    NOT NULL,
  body_len        INTEGER NOT NULL DEFAULT 0,
  comment_count   INTEGER NOT NULL DEFAULT 0,
  submitted_at    TEXT,
  PRIMARY KEY (repo_id, number, review_id),
  FOREIGN KEY (repo_id, number) REFERENCES pull_requests (repo_id, number) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_rv_reviewer ON pr_reviews (repo_id, reviewer_login);

CREATE TABLE IF NOT EXISTS classifications (
  repo_id             INTEGER NOT NULL,
  number              INTEGER NOT NULL,
  category            TEXT    NOT NULL,
  category_source     TEXT    NOT NULL,
  category_evidence   TEXT    NOT NULL DEFAULT '[]',
  category_confidence REAL,
  category_top_prob   REAL,
  needs_review        INTEGER NOT NULL DEFAULT 0,
  impact              REAL, impact_conf     REAL,
  complexity          REAL, complexity_conf REAL,
  risk                REAL, risk_conf       REAL,
  user_facing         REAL,
  breaking_change     REAL,
  tests_included      REAL,
  scope_coherence     REAL,
  title_matches_diff  REAL,
  jev_exchange_json   TEXT,
  jev_asked_category  INTEGER NOT NULL DEFAULT 0,
  jev_input_tokens    INTEGER,
  jev_output_tokens   INTEGER,
  jev_elapsed_ms      INTEGER,
  jev_error           TEXT,
  model               TEXT,
  questions_version   TEXT    NOT NULL,
  classified_at       TEXT    NOT NULL,
  PRIMARY KEY (repo_id, number),
  FOREIGN KEY (repo_id, number) REFERENCES pull_requests (repo_id, number) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ingest_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id        INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  kind           TEXT    NOT NULL,
  transport      TEXT,
  started_at     TEXT    NOT NULL,
  finished_at    TEXT,
  status         TEXT    NOT NULL,
  pr_total       INTEGER NOT NULL DEFAULT 0,
  pr_done        INTEGER NOT NULL DEFAULT 0,
  api_calls      INTEGER NOT NULL DEFAULT 0,
  jev_calls      INTEGER NOT NULL DEFAULT 0,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  rate_remaining INTEGER,
  error          TEXT
);
