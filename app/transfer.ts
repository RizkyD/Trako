import { deleteCover, downloadImage, readCover, writeCover } from './covers.ts'
import {
  createFranchise,
  createItem,
  DATE_PATTERN,
  db,
  isCount,
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
  started_at: string | null
  progress: number
  progress_total: number | null
  progress_unit: string | null
  favorite: boolean
  replays: number
  tags: string | null
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
      started_at: item.started_at,
      progress: item.progress,
      progress_total: item.progress_total,
      progress_unit: item.progress_unit,
      favorite: item.favorite === 1,
      replays: item.replays,
      tags: item.tags,
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

// Checks one exported title. Returns null when anything about it is off. Fields
// that files from before them lack take their default.
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
  if (finishedAt && !DATE_PATTERN.test(finishedAt)) return null
  if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 10)) return null
  let released = text(entry.released)
  if (released && !RELEASED_PATTERN.test(released)) return null
  let startedAt = text(entry.started_at)
  if (startedAt && !DATE_PATTERN.test(startedAt)) return null
  let progress = (entry.progress ?? 0) as number
  let progressTotal = (entry.progress_total ?? null) as number | null
  let replays = (entry.replays ?? 0) as number
  if (!isCount(progress) || !isCount(replays)) return null
  if (progressTotal !== null && !isCount(progressTotal, 1)) return null
  let favorite = entry.favorite ?? false
  if (typeof favorite !== 'boolean') return null

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
    started_at: startedAt,
    progress,
    progress_total: progressTotal,
    progress_unit: text(entry.progress_unit),
    favorite,
    replays,
    tags: text(entry.tags),
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
  let franchiseId = db.prepare('SELECT id FROM franchises WHERE name = ?')
  let added = 0
  for (let entry of entries as ExportedItem[]) {
    if (inTheList(entry)) continue
    if (entry.franchise) createFranchise(entry.franchise)
    let franchise = entry.franchise
      ? (franchiseId.get(entry.franchise) as { id: number } | undefined)
      : undefined
    // A cover that is not an acceptable image is dropped; the title still imports.
    let cover = entry.cover
      ? await writeCover(Buffer.from(entry.cover.data, 'base64'), entry.cover.extension)
      : null
    createItem({ ...entry, franchise_id: franchise?.id ?? null, favorite: entry.favorite ? 1 : 0 }, cover)
    added++
  }
  return { added, skipped: entries.length - added }
}

// A title already in the list: the same title, in any case, and type.
const inTheList = (entry: ExportedItem) =>
  db
    .prepare('SELECT 1 FROM items WHERE title = ? COLLATE NOCASE AND type = ?')
    .get(entry.title, entry.type) !== undefined

// Loads titles from another service (MyAnimeList, a CSV file, Steam), given in
// the export file's item shape, each optionally with a `cover_url` to download
// its cover from. Each goes through importData on its own, so the same checks
// apply and only one downloaded cover is held at a time; a title already in the
// list is skipped before its cover is downloaded. Entries that are not valid
// titles are left out and returned by position.
// ponytail: covers download one after another; fetch a few at once if large
// Steam libraries take too long.
export async function importItems(
  items: Record<string, unknown>[],
): Promise<{ added: number; skipped: number; invalid: number[] }> {
  let result = { added: 0, skipped: 0, invalid: [] as number[] }
  for (let [index, item] of items.entries()) {
    let entry = parseExported(item)
    if (!entry) {
      result.invalid.push(index)
    } else if (inTheList(entry)) {
      result.skipped++
    } else {
      let image = typeof item.cover_url === 'string' ? await downloadImage(item.cover_url) : null
      let cover = image && { extension: image.extension, data: Buffer.from(image.bytes).toString('base64') }
      let file = JSON.stringify({ app: 'trako', items: [{ ...item, cover }] })
      result.added += (await importData(file, false))?.added ?? 0
    }
  }
  return result
}
