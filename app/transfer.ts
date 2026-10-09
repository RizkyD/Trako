import { deleteCover, readCover, writeCover } from './covers.ts'
import {
  createFranchise,
  createItem,
  db,
  listFranchises,
  listItems,
  RELEASED_PATTERN,
  STATUSES,
  TYPES,
  type Item,
} from './db.ts'

// Export file: every franchise and title, with cover images embedded as base64
// so one file is a complete backup. The account is not part of it.
interface ExportedItem {
  title: string
  type: Item['type']
  franchise: string | null
  status: Item['status']
  finished_at: string | null
  note: string | null
  rating: number | null
  released: string | null
  platforms: string | null
  description: string | null
  cover: { extension: string; data: string } | null
}

export async function exportData(): Promise<string> {
  let items: ExportedItem[] = []
  for (let item of listItems()) {
    let cover = item.cover ? await readCover(item.cover) : null
    items.push({
      title: item.title,
      type: item.type,
      franchise: item.franchise,
      status: item.status,
      finished_at: item.finished_at,
      note: item.note,
      rating: item.rating,
      released: item.released,
      platforms: item.platforms,
      description: item.description,
      cover: cover && { extension: cover.extension, data: cover.bytes.toString('base64') },
    })
  }
  return JSON.stringify(
    {
      app: 'trako',
      version: 1,
      exported_at: new Date().toISOString(),
      franchises: listFranchises().map((franchise) => franchise.name),
      items,
    },
    null,
    2,
  )
}

// Checks one exported title. Returns null when anything about it is off.
function parseExported(raw: unknown): ExportedItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  let entry = raw as Record<string, unknown>
  let text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)

  let title = text(entry.title)
  let type = entry.type as Item['type']
  let status = entry.status as Item['status']
  let finishedAt = text(entry.finished_at)
  let rating = (entry.rating ?? null) as number | null
  if (!title || !TYPES.includes(type) || !STATUSES.includes(status)) return null
  if (finishedAt && !/^\d{4}-\d{2}-\d{2}$/.test(finishedAt)) return null
  if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 10)) return null
  let released = text(entry.released)
  if (released && !RELEASED_PATTERN.test(released)) return null

  let cover: ExportedItem['cover'] = null
  if (entry.cover != null) {
    let { extension, data } = entry.cover as Record<string, unknown>
    if (typeof extension !== 'string' || typeof data !== 'string') return null
    cover = { extension, data }
  }

  return {
    title,
    type,
    status,
    rating,
    cover,
    franchise: text(entry.franchise),
    finished_at: status === 'finished' ? finishedAt : null,
    note: text(entry.note),
    released,
    platforms: text(entry.platforms),
    description: text(entry.description),
  }
}

// Loads an export file. By default it adds to what is there and skips titles
// that already exist (same title and type); with `replace` it first removes
// every current title and franchise. Returns null, changing nothing, when the
// file is not a valid Trako export.
// ponytail: not one transaction (cover files are written along the way); a crash
// mid-import leaves a partial import that importing again completes.
export async function importData(
  text: string,
  replace: boolean,
): Promise<{ added: number; skipped: number } | null> {
  let data: { app?: unknown; franchises?: unknown; items?: unknown }
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  if (data.app !== 'trako' || !Array.isArray(data.items)) return null
  let entries = data.items.map(parseExported)
  if (entries.includes(null)) return null
  let franchises = Array.isArray(data.franchises) ? data.franchises : []
  if (franchises.some((name) => typeof name !== 'string')) return null

  if (replace) {
    for (let item of listItems()) await deleteCover(item.cover)
    db.exec('DELETE FROM items; DELETE FROM franchises')
  }

  for (let name of franchises) createFranchise(name)
  let exists = db.prepare('SELECT 1 FROM items WHERE title = ? COLLATE NOCASE AND type = ?')
  let franchiseId = db.prepare('SELECT id FROM franchises WHERE name = ?')
  let added = 0
  for (let entry of entries as ExportedItem[]) {
    if (exists.get(entry.title, entry.type)) continue
    if (entry.franchise) createFranchise(entry.franchise)
    let franchise = entry.franchise
      ? (franchiseId.get(entry.franchise) as { id: number } | undefined)
      : undefined
    // A cover that is not an acceptable image is dropped; the title still imports.
    let cover = entry.cover
      ? await writeCover(Buffer.from(entry.cover.data, 'base64'), entry.cover.extension)
      : null
    createItem({ ...entry, franchise_id: franchise?.id ?? null }, cover)
    added++
  }
  return { added, skipped: entries.length - added }
}
