import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// Adding a type here is enough: the database constraint below follows this
// list, and an older database is rebuilt to accept the new type.
export const TYPES = ['game', 'manga', 'novel', 'film', 'series', 'anime'] as const
export const STATUSES = ['planned', 'ongoing', 'finished'] as const

export interface User {
  username: string
  // File name of the profile photo, stored alongside the covers.
  avatar: string | null
}

export interface Franchise {
  id: number
  name: string
}

export interface Item {
  id: number
  title: string
  type: (typeof TYPES)[number]
  franchise_id: number | null
  // Franchise name, joined in for display.
  franchise: string | null
  status: (typeof STATUSES)[number]
  finished_at: string | null
  note: string | null
  // File name inside the covers directory.
  cover: string | null
  // 1 to 10, or null while unrated.
  rating: number | null
  // First release, as precise as is known: YYYY, YYYY-MM or YYYY-MM-DD.
  released: string | null
  // Comma-separated platform names.
  platforms: string | null
  // What the title is; `note` holds the personal notes.
  description: string | null
}

const dbPath =
  process.env.NODE_ENV === 'test' ? ':memory:' : (process.env.DB_PATH ?? 'data/tracker.db')
if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true })

// Uploaded files live next to the database; tests get a throwaway directory.
export const dataDir =
  dbPath === ':memory:' ? mkdtempSync(join(tmpdir(), 'trako-')) : dirname(dbPath)

export const db = new DatabaseSync(dbPath)
const ITEMS_SCHEMA = `(
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (${TYPES.map((type) => `'${type}'`).join(', ')})),
  franchise_id INTEGER REFERENCES franchises (id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'ongoing', 'finished')),
  finished_at TEXT,
  note TEXT,
  cover TEXT,
  rating INTEGER CHECK (rating BETWEEN 1 AND 10),
  released TEXT,
  platforms TEXT,
  description TEXT
)`
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    avatar TEXT
  );
  CREATE TABLE IF NOT EXISTS franchises (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );
  CREATE TABLE IF NOT EXISTS items ${ITEMS_SCHEMA};
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`)

// Older databases differ from the schema above in ways SQLite cannot alter in
// place (a CHECK constraint, a column turned into a foreign key), so their items
// table is rebuilt. Over time the table gained notes, covers and ratings, the
// franchise went from a name on each item to its own table, statuses went from
// Indonesian words to English ones, and the list of types grew.
const itemColumns = (db.prepare('PRAGMA table_info(items)').all() as { name: string }[]).map(
  (column) => column.name,
)
const itemsSql = (
  db.prepare("SELECT sql FROM sqlite_master WHERE name = 'items'").get() as { sql: string }
).sql
const rebuildItems =
  !itemColumns.includes('franchise_id') ||
  !itemsSql.includes("'planned'") ||
  TYPES.some((type) => !itemsSql.includes(`'${type}'`))
if (rebuildItems) {
  let column = (name: string) => (itemColumns.includes(name) ? name : 'NULL')
  let franchiseId = itemColumns.includes('franchise_id')
    ? 'franchise_id'
    : '(SELECT id FROM franchises WHERE name = items.franchise)'
  db.exec(`
    BEGIN;
    ${
      itemColumns.includes('franchise_id')
        ? ''
        : `INSERT OR IGNORE INTO franchises (name)
             SELECT DISTINCT franchise FROM items WHERE franchise IS NOT NULL;`
    }
    CREATE TABLE items_new ${ITEMS_SCHEMA};
    INSERT INTO items_new (id, title, type, franchise_id, status, finished_at,
                           note, cover, rating, released, platforms, description)
      SELECT id, title, type, ${franchiseId},
             CASE status
               WHEN 'rencana' THEN 'planned'
               WHEN 'sedang' THEN 'ongoing'
               WHEN 'tamat' THEN 'finished'
               ELSE status
             END,
             finished_at, ${column('note')}, ${column('cover')}, ${column('rating')},
             ${column('released')}, ${column('platforms')}, ${column('description')}
      FROM items;
    DROP TABLE items;
    ALTER TABLE items_new RENAME TO items;
    COMMIT;
  `)
}
// Plain additions need no rebuild (a rebuilt table already has them).
for (let name of ['released', 'platforms', 'description']) {
  if (!rebuildItems && !itemColumns.includes(name)) {
    db.exec(`ALTER TABLE items ADD COLUMN ${name} TEXT`)
  }
}

// Profile photos came later than accounts.
const userColumns = db.prepare('PRAGMA table_info(users)').all() as { name: string }[]
if (!userColumns.some((column) => column.name === 'avatar')) {
  db.exec('ALTER TABLE users ADD COLUMN avatar TEXT')
}

// Signing secret for the session cookie, generated once and kept with the data.
db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(
  'session_secret',
  randomBytes(32).toString('hex'),
)
export const sessionSecret = (
  db.prepare("SELECT value FROM meta WHERE key = 'session_secret'").get() as { value: string }
).value

function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

export function hasUser(): boolean {
  return db.prepare('SELECT 1 FROM users LIMIT 1').get() !== undefined
}

export function createUser(username: string, password: string): number {
  let result = db
    .prepare('INSERT INTO users (username, password) VALUES (?, ?)')
    .run(username, hashPassword(password))
  return Number(result.lastInsertRowid)
}

export function verifyUser(username: string, password: string): number | null {
  let user = db.prepare('SELECT id, password FROM users WHERE username = ?').get(username) as
    | { id: number; password: string }
    | undefined
  return user && passwordMatches(user.password, password) ? user.id : null
}

function passwordMatches(stored: string, password: string): boolean {
  let [salt] = stored.split(':')
  return timingSafeEqual(Buffer.from(hashPassword(password, salt)), Buffer.from(stored))
}

export function getUser(userId: number): User {
  let user = db.prepare('SELECT username, avatar FROM users WHERE id = ?').get(userId) as
    | User
    | undefined
  return user ?? { username: '', avatar: null }
}

export function setAvatar(userId: number, avatar: string | null): void {
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, userId)
}

// Returns false, changing nothing, when the password is wrong.
export function changeUsername(userId: number, password: string, username: string): boolean {
  let user = db.prepare('SELECT password FROM users WHERE id = ?').get(userId) as
    | { password: string }
    | undefined
  if (!user || !passwordMatches(user.password, password)) return false
  db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, userId)
  return true
}

// Returns false, changing nothing, when the current password is wrong.
export function changePassword(userId: number, current: string, next: string): boolean {
  let user = db.prepare('SELECT password FROM users WHERE id = ?').get(userId) as
    | { password: string }
    | undefined
  if (!user || !passwordMatches(user.password, current)) return false
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(next), userId)
  return true
}

export function listFranchises(): Franchise[] {
  return db.prepare('SELECT id, name FROM franchises ORDER BY name').all() as unknown as Franchise[]
}

// Both return false when the name is empty or already taken.
export function createFranchise(name: string): boolean {
  name = name.trim()
  if (!name) return false
  return db.prepare('INSERT OR IGNORE INTO franchises (name) VALUES (?)').run(name).changes > 0
}

export function renameFranchise(id: string, name: string): boolean {
  name = name.trim()
  if (!name) return false
  return (
    db.prepare('UPDATE OR IGNORE franchises SET name = ? WHERE id = ?').run(name, id).changes > 0
  )
}

// Items of a deleted franchise stay, without a franchise (ON DELETE SET NULL).
export function deleteFranchise(id: string): void {
  db.prepare('DELETE FROM franchises WHERE id = ?').run(id)
}

const ITEM_SELECT = `
  SELECT items.*, franchises.name AS franchise
  FROM items LEFT JOIN franchises ON franchises.id = items.franchise_id`

export function listItems(): Item[] {
  return db
    // Within a franchise: release order, undated titles last.
    .prepare(
      `${ITEM_SELECT}
       ORDER BY franchise IS NULL, franchise, released IS NULL, released, title`,
    )
    .all() as unknown as Item[]
}

export function getItem(id: string): Item | undefined {
  return db.prepare(`${ITEM_SELECT} WHERE items.id = ?`).get(id) as unknown as Item | undefined
}

export type ItemInput = Omit<Item, 'id' | 'franchise' | 'cover'>

// A year, a year and month, or a full date.
export const RELEASED_PATTERN = /^\d{4}(-\d{2}(-\d{2})?)?$/

// Returns null when the submitted form is not a valid item.
export function parseItem(form: FormData): ItemInput | null {
  let text = (name: string) => {
    let value = form.get(name)
    return typeof value === 'string' ? value.trim() : ''
  }
  let title = text('title')
  let type = text('type') as Item['type']
  let status = text('status') as Item['status']
  let finishedAt = text('finished_at')
  // The form sends the franchise by name (a searchable field); it has to exist.
  let franchise = text('franchise')
    ? (db.prepare('SELECT id FROM franchises WHERE name = ?').get(text('franchise')) as
        | { id: number }
        | undefined)
    : null

  let rating = text('rating') ? Number(text('rating')) : null
  let released = text('released')

  if (!title || !TYPES.includes(type) || !STATUSES.includes(status)) return null
  if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 10)) return null
  if (finishedAt && !/^\d{4}-\d{2}-\d{2}$/.test(finishedAt)) return null
  if (franchise === undefined) return null
  if (released && !RELEASED_PATTERN.test(released)) return null

  return {
    title,
    type,
    status,
    franchise_id: franchise?.id ?? null,
    finished_at: status === 'finished' ? finishedAt || today() : null,
    note: text('note') || null,
    rating,
    released: released || null,
    platforms: text('platforms') || null,
    description: text('description') || null,
  }
}

// The columns a form or an import fills in; the cover is stored separately.
const ITEM_COLUMNS = [
  'title',
  'type',
  'franchise_id',
  'status',
  'finished_at',
  'note',
  'rating',
  'released',
  'platforms',
  'description',
] as const satisfies readonly (keyof ItemInput)[]

export function createItem(item: ItemInput, cover: string | null = null): void {
  db.prepare(
    `INSERT INTO items (${ITEM_COLUMNS.join(', ')}, cover)
     VALUES (${ITEM_COLUMNS.map(() => '?').join(', ')}, ?)`,
  ).run(...ITEM_COLUMNS.map((column) => item[column]), cover)
}

export function updateItem(id: string, item: ItemInput, cover: string | null): void {
  db.prepare(
    `UPDATE items SET ${ITEM_COLUMNS.map((column) => `${column} = ?`).join(', ')}, cover = ?
     WHERE id = ?`,
  ).run(...ITEM_COLUMNS.map((column) => item[column]), cover, id)
}

// Moves an item one step along: planned -> ongoing -> finished, and finished back to ongoing.
export function toggleItem(id: string): void {
  db.prepare(
    `UPDATE items SET
       finished_at = CASE status WHEN 'ongoing' THEN ? ELSE NULL END,
       status = CASE status WHEN 'ongoing' THEN 'finished' ELSE 'ongoing' END
     WHERE id = ?`,
  ).run(today(), id)
}

export function deleteItem(id: string): void {
  db.prepare('DELETE FROM items WHERE id = ?').run(id)
}

function today(): string {
  return new Date().toLocaleDateString('sv') // YYYY-MM-DD in local time
}
