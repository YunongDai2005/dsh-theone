import { AppError } from './agent.mjs';

// Supply ctx.storage.sql in one global Durable Object, never a per-visitor
// object. SQL cursors are fully consumed before any provider await.
export class DurableBudget {
  constructor(sql, limits = {}) {
    this.sql = sql;
    this.limits = limits;
    sql.exec(`CREATE TABLE IF NOT EXISTS provider_budget (
      provider TEXT PRIMARY KEY, used INTEGER NOT NULL CHECK (used >= 0)
    )`);
  }
  reserve(provider) {
    const limit = Object.hasOwn(this.limits, provider) ? this.limits[provider] : 0;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new AppError('Provider access is disabled for this demo.', 503);
    }
    // One conditional write: concurrent callers cannot both reserve the final
    // request. Never refund an attempted call, even on timeout or provider error.
    const rows = Array.from(this.sql.exec(
      `INSERT INTO provider_budget(provider,used) VALUES(?,1)
       ON CONFLICT(provider) DO UPDATE SET used=used+1
       WHERE used < ? RETURNING used`, provider, limit));
    if (!rows.length) throw new AppError('This demo has reached its total provider request limit.', 429);
    return rows[0].used;
  }
}
