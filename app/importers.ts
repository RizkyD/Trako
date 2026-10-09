import { gunzipSync } from 'node:zlib'

import type { Item } from './db.ts'
import { USER_AGENT } from './lookup.ts'

// Lists from other services, turned into titles in the export file's item shape
// for importItems (see transfer.ts), which checks them like an export file's.
type Entry = Record<string, unknown>

const MAL_STATUS: Record<string, Item['status']> = {
  Watching: 'ongoing',
  Reading: 'ongoing',
  Completed: 'finished',
  'On-Hold': 'on_hold',
  Dropped: 'dropped',
  'Plan to Watch': 'planned',
  'Plan to Read': 'planned',
}

// A MyAnimeList export: the XML file, or the .xml.gz MyAnimeList downloads.
// Null when it is not one.
export function fromMal(bytes: Uint8Array): Entry[] | null {
  let xml: string
  try {
    let gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b
    xml = (gzipped ? gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }) : Buffer.from(bytes)).toString()
  } catch {
    return null
  }
  if (!xml.includes('<myanimelist>')) return null
  // ponytail: a flat format, read with patterns rather than an XML parser; an
  // entry whose comments contain "</anime>" would be cut short.
  return [...xml.matchAll(/<(anime|manga)>([\s\S]*?)<\/\1>/g)].map(([, kind, entry]) => {
    let value = (name: string) => tag(entry, name)
    let anime = kind === 'anime'
    let type: Item['type'] = anime
      ? value('series_type') === 'Movie'
        ? 'film'
        : 'anime'
      : /novel/i.test(value('series_type'))
        ? 'novel'
        : 'manga'
    let score = Number(value('my_score'))
    return {
      title: value(anime ? 'series_title' : 'manga_title'),
      type,
      status: MAL_STATUS[value('my_status')],
      // 0 is not rated.
      rating: score >= 1 ? score : null,
      started_at: fullDate(value('my_start_date')),
      finished_at: fullDate(value('my_finish_date')),
      note: value('my_comments') || null,
      tags: value('my_tags') || null,
      replays: Number(value(anime ? 'my_times_watched' : 'my_times_read')),
      // A film is not counted in episodes. A total of 0 is unknown.
      ...(type !== 'film' && {
        progress: Number(value(anime ? 'my_watched_episodes' : 'my_read_chapters')),
        progress_total: Number(value(anime ? 'series_episodes' : 'manga_chapters')) || null,
        progress_unit: anime ? 'episodes' : 'chapters',
      }),
    }
  })
}

// An element's text, in CDATA or not.
function tag(xml: string, name: string): string {
  let match = new RegExp(`<${name}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))</${name}>`).exec(xml)
  let text = match?.[1] ?? match?.[2]?.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => XML_ENTITIES[name])
  return text?.trim() ?? ''
}
const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

// MyAnimeList writes an unknown date as 0000-00-00 and an unknown month or day
// as 00; only full dates are kept.
const fullDate = (date: string) => (/^(?!0000)\d{4}-(?!00)\d\d-(?!00)\d\d$/.test(date) ? date : null)

// Rows of a CSV file. Fields are split on commas; a quoted field can hold
// commas, line breaks and doubled quotes. Lines end in LF or CRLF.
export function parseCsv(text: string): string[][] {
  let rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    let char = text[i]
    if (quoted) {
      if (char !== '"') field += char
      else if (text[i + 1] === '"') field += text[++i]
      else quoted = false
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      rows.push([...row, field])
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field || row.length) rows.push([...row, field])
  return rows
}

// The item fields a CSV column can fill, by its header; other columns are ignored.
const CSV_FIELDS = [
  'title',
  'type',
  'status',
  'franchise',
  'released',
  'platforms',
  'rating',
  'progress',
  'progress_total',
  'progress_unit',
  'started_at',
  'finished_at',
  'note',
  'description',
  'tags',
]
const CSV_NUMBERS = ['rating', 'progress', 'progress_total']

// A CSV file with a header row. A row without a type gets `type` (empty: none),
// one without a status is planned. Each title carries its `row` number as a
// spreadsheet shows it (the header is row 1); blank rows are left out. Null
// when there is no title column.
export function fromCsv(text: string, type: string): Entry[] | null {
  let [header = [], ...rows] = parseCsv(text.replace(/^﻿/, ''))
  let columns = header.map((name) => name.trim().toLowerCase().replace(/\s+/g, '_'))
  if (!columns.includes('title')) return null
  return rows.flatMap((cells, index) => {
    if (cells.every((cell) => !cell.trim())) return []
    let entry: Entry = { row: index + 2 }
    for (let [column, name] of columns.entries()) {
      let value = cells[column]?.trim()
      if (value && CSV_FIELDS.includes(name)) {
        entry[name] = CSV_NUMBERS.includes(name) ? Number(value) : value
      }
    }
    entry.type = String(entry.type ?? type).toLowerCase()
    // "On hold" and "on-hold" are on_hold.
    entry.status = String(entry.status ?? 'planned').toLowerCase().replace(/[\s-]+/g, '_')
    return [entry]
  })
}

// The games a Steam account owns, with playtime as progress in hours. The key
// and SteamID serve this one request and are kept nowhere. Null when Steam
// refuses or shows no games (wrong key or ID, or the profile's game details
// are not public).
export async function fromSteam(key: string, steamId: string): Promise<Entry[] | null> {
  let query = new URLSearchParams({ key, steamid: steamId, include_appinfo: '1', format: 'json' })
  try {
    let response = await fetch(
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?${query}`,
      { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) },
    )
    let games: { appid: number; name: string; playtime_forever: number }[] | undefined = response.ok
      ? (await response.json()).response?.games
      : undefined
    if (!Array.isArray(games)) return null
    return games.map((game) => ({
      title: game.name,
      type: 'game',
      status: game.playtime_forever > 0 ? 'ongoing' : 'planned',
      platforms: 'Steam',
      progress: Math.round(game.playtime_forever / 60),
      progress_unit: 'hours',
      cover_url: `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appid}/library_600x900.jpg`,
    }))
  } catch {
    return null
  }
}
