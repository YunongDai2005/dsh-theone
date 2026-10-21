import { AppError, text } from './agent.mjs';

// Compatible with the synchronous SqlStorage cursor interface.
export class SqlTasteStore {
  constructor(sql) {
    this.sql = sql;
    this.sql.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS visitors(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS topics(id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES visitors(id), title TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS seeds(topic TEXT NOT NULL REFERENCES topics(id), id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, PRIMARY KEY(topic,id));`);
  }
  visitor(candidate) {
    if (typeof candidate === 'string' && /^[a-f0-9]{64}$/.test(candidate) && Array.from(this.sql.exec('SELECT id FROM visitors WHERE id=?', candidate))[0]) return candidate;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
    Array.from(this.sql.exec('INSERT INTO visitors VALUES(?)', id));
    return id;
  }
  createTopic(owner, title) {
    if (this.topics(owner).length >= 24) throw new AppError('Keep up to 24 topics in this demo.');
    const id = crypto.randomUUID();
    Array.from(this.sql.exec('INSERT INTO topics VALUES(?,?,?)', id, owner, text(title, 80)));
    return this.topic(owner, id);
  }
  topic(owner, id) {
    const row = Array.from(this.sql.exec('SELECT id,title FROM topics WHERE id=? AND owner=?', id, owner))[0];
    if (!row) throw new AppError('That topic is not available in this browser.', 404);
    return { ...row, seeds: Array.from(this.sql.exec('SELECT id,name,type FROM seeds WHERE topic=? ORDER BY name,id', id)) };
  }
  topics(owner) {
    return Array.from(this.sql.exec('SELECT id FROM topics WHERE owner=? ORDER BY rowid', owner)).map(row => this.topic(owner, row.id));
  }
  addSeed(owner, topic, seed) {
    this.topic(owner, topic);
    if (this.topic(owner, topic).seeds.length >= 12 && !this.topic(owner, topic).seeds.some(s => s.id === seed.id)) throw new AppError('Keep up to 12 favorites per topic.');
    Array.from(this.sql.exec('INSERT OR IGNORE INTO seeds VALUES(?,?,?,?)', topic, seed.id, seed.name, seed.type));
    return this.topic(owner, topic);
  }
}
