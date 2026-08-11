CREATE TABLE IF NOT EXISTS chat_action (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  input TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_action_household ON chat_action (household_id);
CREATE INDEX IF NOT EXISTS idx_chat_action_message ON chat_action (message_id);
