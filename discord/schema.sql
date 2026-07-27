-- schema.sql
-- Jalankan sekali pas setup: wrangler d1 execute telehub-db --file=./schema.sql

CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  invite_link TEXT NOT NULL,
  description TEXT DEFAULT '',
  icon_url TEXT DEFAULT '',
  tags TEXT DEFAULT '',              -- disimpen comma-separated, misal: "gaming,anime"
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',       -- pending | approved | rejected
  payment_status TEXT NOT NULL DEFAULT 'unpaid', -- unpaid | paid
  merchant_order_id TEXT,
  verified INTEGER NOT NULL DEFAULT 0,           -- 1 = tampil badge centang hijau
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_servers_status ON servers(status);
CREATE INDEX IF NOT EXISTS idx_servers_payment ON servers(payment_status);
CREATE INDEX IF NOT EXISTS idx_servers_order ON servers(merchant_order_id);
