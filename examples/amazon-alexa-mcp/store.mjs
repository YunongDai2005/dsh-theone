import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveContext } from '../../src/router.ts';

/** A separate, single-owner database; never opens the user's DSH database. */
export class TopicMemory {
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS topics(id TEXT PRIMARY KEY, title TEXT NOT NULL,
        summary TEXT NOT NULL, keywords TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, topic_id TEXT NOT NULL REFERENCES topics(id),
        text TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, request_key TEXT NOT NULL UNIQUE,
        payload_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS corrections(id INTEGER PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id),
        old_topic TEXT NOT NULL, new_topic TEXT NOT NULL, at TEXT NOT NULL);`);
  }
  list() {
    return this.db.prepare(`SELECT t.*, COUNT(n.id) AS noteCount FROM topics t LEFT JOIN notes n
      ON n.topic_id=t.id GROUP BY t.id ORDER BY t.rowid`).all()
      .map(row => ({ id: row.id, title: row.title, summary: row.summary,
        keywords: JSON.parse(row.keywords), noteCount: row.noteCount }));
  }
  topic(id) {
    const row = this.list().find(t => t.id === id);
    if (!row) throw new Error('Unknown topic');
    return row;
  }
  create({ title, summary, keywords }) {
    const id = randomUUID();
    this.db.prepare('INSERT INTO topics VALUES(?,?,?,?)').run(id, title, summary, JSON.stringify(keywords));
    return this.topic(id);
  }
  suggest(message, currentTopicId) {
    if (currentTopicId) this.topic(currentTopicId);
    const catalog = this.list().map(t => ({ ...t, entities: [t.title], lastState: '' }));
    return { mode: 'existing-TheOne-rules', decision: resolveContext(message, catalog, currentTopicId) };
  }
  read(topicId) {
    return { ...this.topic(topicId), notes: this.db.prepare(
      'SELECT id, text, version, created_at AS createdAt FROM notes WHERE topic_id=? ORDER BY rowid'
    ).all(topicId), noteContentIsUntrusted: true };
  }
  save({ topicId, text, requestKey }) {
    this.topic(topicId);
    const hash = createHash('sha256').update(JSON.stringify({ topicId, text })).digest('hex');
    const old = this.db.prepare('SELECT * FROM notes WHERE request_key=?').get(requestKey);
    if (old) {
      if (old.payload_hash !== hash) throw new Error('Request key already used for different content');
      return { id: old.id, topicId: old.topic_id, version: old.version, replayed: true };
    }
    const id = randomUUID();
    this.db.prepare('INSERT INTO notes(id,topic_id,text,request_key,payload_hash,created_at) VALUES(?,?,?,?,?,?)')
      .run(id, topicId, text, requestKey, hash, new Date().toISOString());
    return { id, topicId, version: 1, replayed: false };
  }
  move({ noteId, destinationTopicId, expectedVersion }) {
    this.topic(destinationTopicId);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.db.prepare('SELECT * FROM notes WHERE id=?').get(noteId);
      if (!old) throw new Error('Unknown note');
      if (old.version !== expectedVersion) throw new Error('Stale note version; read the topic again');
      if (old.topic_id !== destinationTopicId) {
        this.db.prepare('UPDATE notes SET topic_id=?, version=version+1 WHERE id=?').run(destinationTopicId, noteId);
        this.db.prepare('INSERT INTO corrections(note_id,old_topic,new_topic,at) VALUES(?,?,?,?)')
          .run(noteId, old.topic_id, destinationTopicId, new Date().toISOString());
      }
      this.db.exec('COMMIT');
      return { id: noteId, topicId: destinationTopicId,
        version: old.version + Number(old.topic_id !== destinationTopicId) };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
