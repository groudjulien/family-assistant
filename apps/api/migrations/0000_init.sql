-- Family Assistant — initial schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS household (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  default_split_a INTEGER NOT NULL DEFAULT 50,
  default_split_b INTEGER NOT NULL DEFAULT 50,
  wedding_target_amount INTEGER NOT NULL DEFAULT 0,
  wedding_target_date TEXT NOT NULL DEFAULT '2030-01-01',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  google_sub TEXT,
  member TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS google_oauth_token (
  user_id TEXT PRIMARY KEY,
  refresh_token TEXT NOT NULL,
  scope TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  parent_task_id TEXT,
  title TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  priority INTEGER NOT NULL DEFAULT 2,
  position REAL NOT NULL DEFAULT 0,
  due_date TEXT,
  assignee_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'checking',
  current_balance INTEGER NOT NULL DEFAULT 0,
  balance_updated_at TEXT
);

CREATE TABLE IF NOT EXISTS category (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1'
);

CREATE TABLE IF NOT EXISTS "transaction" (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  category_id TEXT,
  label TEXT NOT NULL,
  amount INTEGER NOT NULL,
  paid_by TEXT NOT NULL DEFAULT 'joint',
  share_a INTEGER NOT NULL DEFAULT 0,
  share_b INTEGER NOT NULL DEFAULT 0,
  date TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'actual',
  recurring_id TEXT,
  created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recurring (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  category_id TEXT,
  account_id TEXT NOT NULL,
  label TEXT NOT NULL,
  amount INTEGER NOT NULL,
  share_a INTEGER NOT NULL DEFAULT 0,
  share_b INTEGER NOT NULL DEFAULT 0,
  frequency TEXT NOT NULL DEFAULT 'monthly',
  day_of_month INTEGER,
  start_date TEXT NOT NULL,
  end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settlement (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  from_user TEXT NOT NULL,
  to_user TEXT NOT NULL,
  amount INTEGER NOT NULL,
  date TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS wedding_budget_item (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  group_name TEXT NOT NULL,
  prestataire TEXT,
  label TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT,
  optional INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS savings_contribution (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  month TEXT NOT NULL,
  amount_a INTEGER NOT NULL DEFAULT 0,
  amount_b INTEGER NOT NULL DEFAULT 0,
  planned INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS wedding_payment (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  budget_item_id TEXT,
  prestataire TEXT NOT NULL,
  type TEXT,
  due_date TEXT NOT NULL,
  amount_due INTEGER NOT NULL,
  amount_paid INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS utility_reading (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  utility TEXT NOT NULL DEFAULT 'electricity',
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  kwh INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS utility_reading_unique
  ON utility_reading (household_id, utility, year, month);

CREATE TABLE IF NOT EXISTS chat_message (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  user_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
