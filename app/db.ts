import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// Adding a type or status here is enough: the database constraints below follow
// these lists, and an older database is rebuilt to accept the new value.
export const TYPES = ['game', 'manga', 'novel', 'film', 'series', 'anime'] as const
export const STATUSES = ['planned', 'ongoing', 'on_hold', 'dropped', 'finished'] as const

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
  // YYYY-MM-DD; the step button fills it in the first time a title is started.
  started_at: string | null
  // `progress` of `progress_total` (when known) `progress_unit`, e.g. 170 of 200 chapters.
  progress: number
  progress_total: number | null
  progress_unit: string | null
  // 1 for a favorite, else 0.
  favorite: number
  // Times gone through again after finishing.
  replays: number
  // Comma-separated tag names.
  tags: string | null
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
  status TEXT NOT NULL CHECK (status IN (${STATUSES.map((status) => `'${status}'`).join(', ')})),
  finished_at TEXT,
  note TEXT,
  cover TEXT,
  rating INTEGER CHECK (rating BETWEEN 1 AND 10),
  released TEXT,
  platforms TEXT,
  description TEXT,
  started_at TEXT,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0),
  progress_total INTEGER CHECK (progress_total >= 1),
  progress_unit TEXT,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  replays INTEGER NOT NULL DEFAULT 0 CHECK (replays >= 0),
  tags TEXT
)`
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    avatar TEXT,
    session_version INTEGER NOT NULL DEFAULT 1
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
// Indonesian words to English ones, and the lists of types and statuses grew.
const columnsOf = (table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (column) => column.name,
  )
const itemColumns = columnsOf('items')
const itemsSql = (
  db.prepare("SELECT sql FROM sqlite_master WHERE name = 'items'").get() as { sql: string }
).sql
const rebuildItems =
  !itemColumns.includes('franchise_id') ||
  [...TYPES, ...STATUSES].some((value) => !itemsSql.includes(`'${value}'`))
if (rebuildItems) {
  db.exec('BEGIN')
  if (!itemColumns.includes('franchise_id')) {
    db.exec(`INSERT OR IGNORE INTO franchises (name)
               SELECT DISTINCT franchise FROM items WHERE franchise IS NOT NULL`)
  }
  db.exec(`CREATE TABLE items_new ${ITEMS_SCHEMA}`)
  // Every column both tables have is copied as it is; columns the old table
  // lacks take their default.
  let kept = columnsOf('items_new').filter(
    (name) => itemColumns.includes(name) && name !== 'franchise_id' && name !== 'status',
  )
  let franchiseId = itemColumns.includes('franchise_id')
    ? 'franchise_id'
    : '(SELECT id FROM franchises WHERE name = items.franchise)'
  db.exec(`
    INSERT INTO items_new (${kept.join(', ')}, franchise_id, status)
      SELECT ${kept.join(', ')}, ${franchiseId},
             CASE status
               WHEN 'rencana' THEN 'planned'
               WHEN 'sedang' THEN 'ongoing'
               WHEN 'tamat' THEN 'finished'
               ELSE status
             END
      FROM items;
    DROP TABLE items;
    ALTER TABLE items_new RENAME TO items;
    COMMIT;
  `)
}
// Plain additions need no rebuild (a rebuilt table already has them). The
// tracking columns (started_at through tags) came with two new statuses, so
// every table older than them gets them from the rebuild.
for (let name of ['released', 'platforms', 'description']) {
  if (!rebuildItems && !itemColumns.includes(name)) {
    db.exec(`ALTER TABLE items ADD COLUMN ${name} TEXT`)
  }
}

// Profile photos came later than accounts, and so did session versions.
const userColumns = columnsOf('users')
if (!userColumns.includes('avatar')) {
  db.exec('ALTER TABLE users ADD COLUMN avatar TEXT')
}
if (!userColumns.includes('session_version')) {
  db.exec('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1')
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

// A session holds its account's version from sign-in; it is only valid while
// they match, so bumping the version signs out every session at once.
export function sessionVersion(userId: number): number | undefined {
  let user = db.prepare('SELECT session_version FROM users WHERE id = ?').get(userId) as
    | { session_version: number }
    | undefined
  return user?.session_version
}

export function endSessions(userId: number): void {
  db.prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?').run(userId)
}

// Returns false, changing nothing, when the current password is wrong. Other
// sessions are signed out; the caller gives its own the new version.
export function changePassword(userId: number, current: string, next: string): boolean {
  let user = db.prepare('SELECT password FROM users WHERE id = ?').get(userId) as
    | { password: string }
    | undefined
  if (!user || !passwordMatches(user.password, current)) return false
  db.prepare(
    'UPDATE users SET password = ?, session_version = session_version + 1 WHERE id = ?',
  ).run(hashPassword(next), userId)
  return true
}

// For a forgotten password (scripts/reset-password.ts): no current password
// needed, and every session is signed out. False when there is no such account.
export function resetPassword(username: string, password: string): boolean {
  return (
    db
      .prepare(
        'UPDATE users SET password = ?, session_version = session_version + 1 WHERE username = ?',
      )
      .run(hashPassword(password), username).changes > 0
  )
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
// Start and finish dates are full dates.
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// Progress, its total and replays are whole numbers of at least `min`.
export const isCount = (value: unknown, min = 0) => Number.isInteger(value) && Number(value) >= min

// Returns null when the submitted form is not a valid item.
export function parseItem(form: FormData): ItemInput | null {
  let text = (name: string) => {
    let value = form.get(name)
    return typeof value === 'string' ? value.trim() : ''
  }
  let title = text('title')
  let type = text('type') as Item['type']
  let status = text('status') as Item['status']
  let startedAt = text('started_at')
  let finishedAt = text('finished_at')
  // The form sends the franchise by name (a searchable field); it has to exist.
  let franchise = text('franchise')
    ? (db.prepare('SELECT id FROM franchises WHERE name = ?').get(text('franchise')) as
        | { id: number }
        | undefined)
    : null

  let rating = text('rating') ? Number(text('rating')) : null
  let released = text('released')
  // Empty number fields fall back to the default.
  let number = (name: string) => (text(name) ? Number(text(name)) : null)
  let progress = number('progress') ?? 0
  let progressTotal = number('progress_total')
  let replays = number('replays') ?? 0

  if (!title || !TYPES.includes(type) || !STATUSES.includes(status)) return null
  if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 10)) return null
  if (startedAt && !DATE_PATTERN.test(startedAt)) return null
  if (finishedAt && !DATE_PATTERN.test(finishedAt)) return null
  if (franchise === undefined) return null
  if (released && !RELEASED_PATTERN.test(released)) return null
  if (!isCount(progress) || !isCount(replays)) return null
  if (progressTotal !== null && !isCount(progressTotal, 1)) return null

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
    started_at: startedAt || null,
    progress,
    progress_total: progressTotal,
    progress_unit: text('progress_unit') || null,
    favorite: text('favorite') ? 1 : 0,
    replays,
    tags: text('tags') || null,
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
  'started_at',
  'progress',
  'progress_total',
  'progress_unit',
  'favorite',
  'replays',
  'tags',
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

// Moves an item one step along: planned -> ongoing -> finished; on hold, dropped
// and finished go (back) to ongoing. Starting notes the day, unless it already has one.
export function toggleItem(id: string): void {
  let day = today()
  db.prepare(
    `UPDATE items SET
       finished_at = CASE status WHEN 'ongoing' THEN ? ELSE NULL END,
       started_at = CASE status WHEN 'ongoing' THEN started_at ELSE COALESCE(started_at, ?) END,
       status = CASE status WHEN 'ongoing' THEN 'finished' ELSE 'ongoing' END
     WHERE id = ?`,
  ).run(day, day, id)
}

// One more chapter, episode, hour…, but never past a known total.
export function advanceItem(id: string): void {
  db.prepare(
    `UPDATE items SET progress = progress + 1
     WHERE id = ? AND (progress_total IS NULL OR progress < progress_total)`,
  ).run(id)
}

export function toggleFavorite(id: string): void {
  db.prepare('UPDATE items SET favorite = 1 - favorite WHERE id = ?').run(id)
}

// Goes through a finished title again: counts the replay and starts a new run
// today, from no progress. Only finished titles count, so a repeated post adds nothing.
export function replayItem(id: string): void {
  db.prepare(
    `UPDATE items SET replays = replays + 1, status = 'ongoing', started_at = ?,
       finished_at = NULL, progress = 0
     WHERE id = ? AND status = 'finished'`,
  ).run(today(), id)
}

export function deleteItem(id: string): void {
  db.prepare('DELETE FROM items WHERE id = ?').run(id)
}

// Bulk edits from the Titles page work on titles picked by id, passed as one
// JSON array; ids of titles that no longer exist match nothing.
const PICKED = 'items.id IN (SELECT value FROM json_each($ids))'

export function pickedItems(ids: number[]): Item[] {
  return db
    .prepare(`${ITEM_SELECT} WHERE ${PICKED}`)
    .all({ ids: JSON.stringify(ids) }) as unknown as Item[]
}

// Starting notes the day unless there is one, as the step button does, and so
// does finishing. A title that is not finished has no finish date.
export function setStatus(ids: number[], status: Item['status']): void {
  db.prepare(
    `UPDATE items SET
       started_at = CASE $status WHEN 'ongoing' THEN COALESCE(started_at, $day) ELSE started_at END,
       finished_at = CASE $status WHEN 'finished' THEN COALESCE(finished_at, $day) ELSE NULL END,
       status = $status
     WHERE ${PICKED}`,
  ).run({ status, day: today(), ids: JSON.stringify(ids) })
}

export function setFranchise(ids: number[], franchiseId: number | null): void {
  db.prepare(`UPDATE items SET franchise_id = $franchise WHERE ${PICKED}`).run({
    franchise: franchiseId,
    ids: JSON.stringify(ids),
  })
}

export function setFavorite(ids: number[], favorite: 0 | 1): void {
  db.prepare(`UPDATE items SET favorite = $favorite WHERE ${PICKED}`).run({
    favorite,
    ids: JSON.stringify(ids),
  })
}

// Adds each tag to the titles that do not have it yet, in any case.
export function addTags(items: Item[], tags: string[]): void {
  let update = db.prepare('UPDATE items SET tags = ? WHERE id = ?')
  for (let item of items) {
    let next = item.tags
    for (let tag of tags) if (!inList(next, tag)) next = next ? `${next}, ${tag}` : tag
    if (next !== item.tags) update.run(next, item.id)
  }
}

export function deleteItems(ids: number[]): void {
  db.prepare(`DELETE FROM items WHERE ${PICKED}`).run({ ids: JSON.stringify(ids) })
}

// A title to do next, at random: planned or on hold when there is one, else
// anything not finished. An empty type picks from every type.
export function randomItem(type: string): { id: number } | undefined {
  return db
    .prepare(
      `SELECT id FROM items WHERE status != 'finished' AND ($type = '' OR type = $type)
       ORDER BY status IN ('planned', 'on_hold') DESC, random() LIMIT 1`,
    )
    .get({ type }) as { id: number } | undefined
}

// Names from a comma-separated field (platforms, tags).
export function splitList(list: string | null): string[] {
  return (list ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
}

// Whether a comma-separated field holds a name, in any case.
export const inList = (list: string | null, name: string) =>
  splitList(list).some((entry) => entry.toLowerCase() === name.toLowerCase())

export function today(): string {
  return new Date().toLocaleDateString('sv') // YYYY-MM-DD in local time
}
