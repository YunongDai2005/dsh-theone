-- Same as SCHEMA in handler.js. Apply with:
--   npx wrangler d1 execute theone-feedback --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  version TEXT NOT NULL,
  lang TEXT NOT NULL,
  description TEXT NOT NULL,
  contact TEXT,
  diagnostics TEXT,
  reply TEXT,
  emailed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS reports_created ON reports(created_at);
CREATE TABLE IF NOT EXISTS hits (
  ip_hash TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hits_ip ON hits(ip_hash, at);
