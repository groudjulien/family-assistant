ALTER TABLE account ADD COLUMN lunchflow_tx_synced_at TEXT;

CREATE TABLE bank_transaction (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  date TEXT NOT NULL,
  raw_label TEXT NOT NULL,
  is_pending INTEGER NOT NULL DEFAULT 0,
  merchant_name TEXT,
  category TEXT,
  merchant_website TEXT,
  merchant_address TEXT,
  enriched_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_bank_transaction_account_external ON bank_transaction (account_id, external_id);
CREATE INDEX idx_bank_transaction_household_date ON bank_transaction (household_id, date);
