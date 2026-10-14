import { FalkorDB } from 'falkordb';
import { randomUUID } from 'node:crypto';
import { Q } from './queries.mjs';
export class InputError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function text(value, max = 1200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new InputError('Invalid or too-long text');
  return value.trim();
}
export function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) throw new InputError('Invalid id');
  return value;
}
export async function connect(port = Number(process.env.FALKOR_PORT || 6389)) {
  const db = await FalkorDB.connect({disableOfflineQueue: true, socket: {host: '127.0.0.1', port, connectTimeout: 2000, reconnectStrategy: false} });
  // Avoid an unhandled EventEmitter error on later disconnect; HTTP queries still fail.
  db.on('error', () => {});
  return db;
}
export class Memory {
  constructor(db, namespace) {
    if (!/^theone_[a-f0-9]{32,64}$/.test(namespace)) throw new Error('Server-derived graph name required');
    this.graph = db.selectGraph(namespace);
  }
  async query(name, params = {}) {
    const result = await this.graph.query(Q[name], {params, timeout: 2000});
    return result.data || [];
  }
  async init() { await this.query('init'); }
  async topics() { return this.query('topics'); }
  async requireTopic(id) {
    uuid(id); const rows = await this.query('topic', {id});
    if (!rows.length) throw new InputError('Topic not found in this workspace', 404);
    return rows[0];
  }
  async createTopic(title) { return (await this.query('createTopic', {id: randomUUID(), title: text(title, 100)}))[0]; }
  async context(topic) { await this.requireTopic(topic); return this.query('context', {topic}); }
  async remember(topic, key, value, evidence) {
    await this.requireTopic(topic); key = text(key, 100);
    if ((await this.query('owned', {topic, key})).length) throw new InputError('Fact exists; revise with its current revision', 409);
    const rows = await this.query('createFact', {topic, key, value: text(value), evidence: text(evidence),
      id: randomUUID(), assertion: randomUUID(), evidenceId: randomUUID(), at: new Date().toISOString()});
    if (!rows.length) throw new InputError('Fact exists; reload before revising', 409);
    return rows[0];
  }
  async owned(topic, id) {
    await this.requireTopic(topic); uuid(id);
    const rows = await this.context(topic); const fact = rows.find(r => r.id === id && r.ownerId === topic);
    if (!fact) throw new InputError('Only the owning topic may change or share a fact', 403);
    return fact;
  }
  async revise(topic, id, expected, value, evidence) {
    await this.owned(topic, id);
    if (!Number.isSafeInteger(expected) || expected < 1) throw new InputError('Revision required');
    const rows = await this.query('revise', {topic, id, expected, next: expected + 1, value: text(value), evidence: text(evidence),
      assertion: randomUUID(), evidenceId: randomUUID(), at: new Date().toISOString()});
    if (!rows.length) throw new InputError('Fact changed; reload before confirming', 409);
    return {...rows[0], affected: await this.query('impact', {id})};
  }
  async share(owner, id, target) {
    await this.owned(owner, id); await this.requireTopic(target);
    if (owner === target) throw new InputError('Owner already has this fact');
    await this.query('share', {owner, id, target}); return this.query('impact', {id});
  }
  async revoke(owner, id, target) {
    await this.owned(owner, id); await this.requireTopic(target);
    if (owner === target) throw new InputError('Cannot revoke owner access');
    await this.query('revoke', {owner, id, target}); return this.query('impact', {id});
  }
  async history(topic, id) {
    const rows = await this.context(topic);
    if (!rows.some(r => r.id === id)) throw new InputError('Fact not visible in this topic', 404);
    return this.query('history', {id});
  }
}
