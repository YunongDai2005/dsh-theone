import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { CATALOG_ORPHAN_REPAIR, catalogOrphanRepairs } from '../src/catalog-repair.ts'

// Deliberately no default database path, migrations, ContextStore construction or write mode.
if (process.argv.length !== 3) throw new Error('Usage: node scripts/dry-run-catalog-repair.mjs <contexts.db>')
const path = resolve(process.argv[2])
const db = new DatabaseSync(path, { readOnly: true })
try {
  db.exec('BEGIN')
  const alreadyApplied = !!db.prepare('SELECT 1 FROM plugin_flags WHERE name = ?').get(CATALOG_ORPHAN_REPAIR)
  const repairs = alreadyApplied ? [] : catalogOrphanRepairs(db)
  console.log(JSON.stringify({ database: path, readOnly: true, alreadyApplied, count: repairs.length, repairs }, null, 2))
} finally { db.close() }
