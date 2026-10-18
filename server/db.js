// SQLite persistence using Node's built-in driver (node:sqlite, Node >= 22.5).
// Kept behind small helpers so the store can later be swapped for PostgreSQL.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

const dbPath = resolve(config.dbPath);
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  material TEXT,
  category TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'pcs',
  dimensions TEXT,            -- JSON: {length,width,height,diameter,thickness,unit,method,status,uncertainty}
  condition TEXT,
  potential_uses TEXT,        -- JSON array
  notes TEXT,
  unit_value REAL,            -- optional replacement value per unit
  source TEXT NOT NULL DEFAULT 'user',   -- user | ai_scan | demo_example
  confidence REAL,
  confirmed INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idea_runs (
  id TEXT PRIMARY KEY,
  request TEXT NOT NULL,      -- JSON
  ideas TEXT NOT NULL,        -- JSON
  engine TEXT NOT NULL,       -- ai | demo
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idea',
  is_example INTEGER NOT NULL DEFAULT 0,
  idea TEXT,                  -- JSON product idea
  plan TEXT,                  -- JSON design + bom + steps
  economics TEXT,             -- JSON economics inputs
  strategy TEXT,              -- JSON channels + launch plan
  progress TEXT,              -- JSON {completedSteps:[], notes:{}}
  notes TEXT,                 -- JSON array of {id, text, created_at}
  units_produced INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  spec TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT,
  est_unit_price REAL,
  currency TEXT,
  options TEXT,               -- JSON array of sourced options
  chosen_option TEXT,         -- JSON
  search_meta TEXT,           -- JSON {engine, retrieved_at, note}
  purchased INTEGER NOT NULL DEFAULT 0,
  actual_cost REAL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS production (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  channel TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  fees REAL NOT NULL DEFAULT 0,
  shipping_cost REAL NOT NULL DEFAULT 0,
  ad_cost REAL NOT NULL DEFAULT 0,
  refund REAL NOT NULL DEFAULT 0,
  returned_units INTEGER NOT NULL DEFAULT 0,
  currency TEXT,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'manual',   -- manual | csv | shopify | example
  external_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_metrics (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  impressions INTEGER,
  visits INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  rule TEXT NOT NULL,
  priority INTEGER NOT NULL,
  payload TEXT NOT NULL,      -- JSON full recommendation
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed | approved | rejected | applied
  baseline TEXT,              -- JSON metrics snapshot at decision time
  decision_note TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integrations (
  provider TEXT PRIMARY KEY,
  status TEXT NOT NULL,       -- disconnected | pending | connected | error
  account TEXT,
  secret TEXT,                -- access token: never returned to the client
  scopes TEXT,
  meta TEXT,                  -- JSON
  connected_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  project_id TEXT,
  created_at TEXT NOT NULL
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS assistant_messages (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,          -- project:<id> | page:<name>
  role TEXT NOT NULL,           -- user | assistant
  content TEXT NOT NULL,
  sources TEXT,                 -- JSON [{url,title}] (assistant turns that searched the web)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assistant_scope ON assistant_messages(scope, created_at);
`);

// Additive migrations for databases created by earlier versions.
for (const [table, column, type] of [['purchases', 'reason', 'TEXT']]) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

export const now = () => new Date().toISOString();
export const uid = () => randomUUID();

export function parseJSON(value, fallback = null) {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export const all = (sql, ...params) => db.prepare(sql).all(...params);
export const get = (sql, ...params) => db.prepare(sql).get(...params);
export const run = (sql, ...params) => db.prepare(sql).run(...params);

export function logActivity(type, message, projectId = null) {
  run('INSERT INTO activity (id, type, message, project_id, created_at) VALUES (?,?,?,?,?)', uid(), type, message, projectId, now());
}

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
