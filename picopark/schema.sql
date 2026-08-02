-- ============================================================
-- Pico Park Clone - Cloudflare D1 Schema (FULL, sudah termasuk rooms)
-- Jalankan dengan: wrangler d1 execute picopark-db --file=./schema.sql
-- Aman dijalankan berkali-kali (semua pakai IF NOT EXISTS, tidak akan
-- menghapus / menimpa data yang sudah ada).
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',       -- 'user' atau 'admin'
  is_paid INTEGER NOT NULL DEFAULT 0,      -- 0 = belum bayar, 1 = sudah bayar (lifetime access)
  current_level INTEGER NOT NULL DEFAULT 1,
  levels_completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  image_data TEXT NOT NULL,       -- base64 bukti pembayaran
  note TEXT,                      -- catatan opsional dari user (misal no. rekening/e-wallet pengirim)
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS level_progress (
  user_id INTEGER NOT NULL,
  level_id INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  best_time_ms INTEGER,
  completed_at TEXT,
  PRIMARY KEY (user_id, level_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Room invite: host (is_paid=1) generate kode, invitee redeem kode ini
-- buat dapat akses gratis (has_access) tanpa mengubah is_paid. Baris
-- dihapus permanen begitu invitee keluar dari sesi WebRTC.
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  host_user_id INTEGER NOT NULL,
  invitee_user_id INTEGER,
  status TEXT NOT NULL DEFAULT 'waiting',  -- waiting | active
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  joined_at TEXT,
  FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (invitee_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_progress_user ON level_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_rooms_host ON rooms(host_user_id);
CREATE INDEX IF NOT EXISTS idx_rooms_invitee ON rooms(invitee_user_id);
