import { DatabaseSync } from 'node:sqlite';
import { SqlTasteStore } from './sql-store.mjs';

export class TasteStore extends SqlTasteStore {
  constructor(path = ':memory:') {
    const db = new DatabaseSync(path);
    super({ exec(query, ...args) {
      // Schema setup contains multiple statements; bound reads/writes use one.
      if (!args.length && query.startsWith('PRAGMA')) { db.exec(query); return []; }
      return db.prepare(query).all(...args);
    } });
    this.db = db;
  }
  close() { this.db.close(); }
}
