import type { Item } from './db.ts'

// A match for a title, to fill in the add and edit forms. Any field can be unknown.
export interface Candidate {
  source: 'wikipedia' | 'anilist'
  title: string
  released: string | null
  platforms: string | null
  description: string | null
  cover_url: string | null
  progress_total: number | null
  progress_unit: string | null
  tags: string | null
}

// Every request the app makes names it, as Wikipedia asks of API clients.
export const USER_AGENT = 'Trako/1.0 (personal media tracker; https://github.com/trako)'

// Wikipedia for every type, AniList too for anime and manga (its matches first).
// One source failing still shows the other's; null when every source failed.
export async function lookup(
  query: string,
  type: Item['type'],
  fetchImpl = fetch,
): Promise<Candidate[] | null> {
  let sources = [wikipedia(query, type, fetchImpl)]
  if (type === 'anime' || type === 'manga') sources.unshift(anilist(query, type, fetchImpl))
  let results = await Promise.allSettled(sources)
  if (results.every((result) => result.status === 'rejected')) return null
  return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])).slice(0, 5)
}

async function getJson(
  fetchImpl: typeof fetch,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) {
  let response = await fetchImpl(url, {
    ...init,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...init.headers },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  // A throttled Wikipedia answers with an HTML page, which fails here too.
  return response.json()
}

interface WikiPage {
  title: string
  // Rank in the search results, from 1.
  index: number
  extract?: string
  thumbnail?: { source: string }
  pageprops?: { disambiguation?: string }
  revisions?: { slots: { main: { content: string } } }[]
}

// Words in an article title that name what it is about, e.g. "Celeste (video game)".
const HINT: Record<Item['type'], RegExp> = {
  game: /video game/i,
  manga: /manga/i,
  novel: /novel/i,
  film: /film/i,
  series: /series/i,
  anime: /anime|series/i,
}

// One request: the search, and for each hit the intro, the cover and the
// infobox (section 0 of the wikitext).
async function wikipedia(query: string, type: Item['type'], fetchImpl: typeof fetch) {
  let params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    redirects: '1',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: '6',
    gsrnamespace: '0',
    prop: 'revisions|extracts|pageimages|pageprops',
    rvprop: 'content',
    rvslots: 'main',
    rvsection: '0',
    exintro: '1',
    explaintext: '1',
    exsentences: '2',
    exlimit: 'max',
    piprop: 'thumbnail',
    pithumbsize: '500',
    // Box art and posters are mostly non-free images, which the default leaves out.
    pilicense: 'any',
    ppprop: 'disambiguation',
  })
  let data = await getJson(fetchImpl, `https://en.wikipedia.org/w/api.php?${params}`)
  let pages: WikiPage[] = data.query?.pages ?? []
  // Search order, except that an article named as searched comes first, and among
  // those (Celeste, Celeste (video game)…) the one whose name fits the type.
  let wanted = query.trim().toLowerCase()
  let rank = (page: WikiPage) =>
    (page.title.replace(/\s*\([^)]*\)$/, '').toLowerCase() === wanted ? 0 : 20) +
    (HINT[type].test(page.title) ? 0 : 10) +
    page.index
  return (
    pages
      .filter((page) => page.pageprops?.disambiguation === undefined)
      .sort((a, b) => rank(a) - rank(b))
      .map((page) => fromArticle(page, type))
      // Hits without any of these (people, places…) are not titles to track.
      .filter((hit) => hit.released || hit.platforms || hit.progress_total || hit.tags)
  )
}

const RELEASED_FIELDS = ['released', 'release_date', 'first_aired', 'first', 'published', 'pub_date']
// Infobox fields that count episodes or volumes, with the unit they count in.
const COUNTS: Partial<Record<Item['type'], [string, string][]>> = {
  anime: [['episodes', 'episodes'], ['num_episodes', 'episodes']],
  series: [['episodes', 'episodes'], ['num_episodes', 'episodes']],
  manga: [['volumes', 'volumes'], ['chapters', 'chapters']],
  novel: [['volumes', 'volumes'], ['chapters', 'chapters']],
}

function fromArticle(page: WikiPage, type: Item['type']): Candidate {
  let text = (page.revisions?.[0]?.slots.main.content ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
  // A manga article can hold its anime's infobox too; for an anime's dates and
  // episodes, that one counts.
  let own = type === 'anime' ? text.slice(Math.max(0, text.search(/\{\{\s*Infobox animanga\/Video/i))) : text

  let progressTotal: number | null = null
  let progressUnit: string | null = null
  for (let [name, unit] of COUNTS[type] ?? []) {
    let count = Number(/\d[\d,]*/.exec(field(own, name))?.[0].replaceAll(',', ''))
    if (count >= 1) {
      progressTotal = count
      progressUnit = unit
      break
    }
  }

  return {
    source: 'wikipedia',
    title: page.title,
    released: RELEASED_FIELDS.map((name) => firstDate(plain(field(own, name)))).find(Boolean) ?? null,
    platforms: names(field(text, 'platforms')),
    // The intro's first sentences, minus the brackets left empty where a
    // pronunciation was taken out.
    description:
      page.extract
        ?.replace(/\(\s*[,;]\s*/g, '(')
        .replace(/\s*\(\s*\)/g, '')
        .trim() || null,
    cover_url: page.thumbnail?.source ?? null,
    progress_total: progressTotal,
    progress_unit: progressUnit,
    tags: names(field(text, 'genre')),
  }
}

// The value of an infobox field: from "| name =" to the next field at the same
// level of templates and links, or the end of the infobox.
function field(wikitext: string, name: string): string {
  let start = wikitext.search(new RegExp(String.raw`\n\s*\|\s*${name}\s*=`, 'i'))
  if (start < 0) return ''
  let rest = wikitext.slice(start).replace(/^\n\s*\|[^=]*=/, '')
  let depth = 0
  let i = 0
  for (; i < rest.length; i++) {
    let two = rest.slice(i, i + 2)
    if (two === '{{' || two === '[[') depth++
    else if (two === '}}' || two === ']]') depth--
    else if (depth === 0 && rest[i] === '\n' && /^\n\s*\|\s*[\w ]+=/.test(rest.slice(i, i + 60))) break
    else continue
    if (depth < 0) break
    i++
  }
  return rest.slice(0, i)
}

// Wikitext as text: links as their label, no bold or italics, no HTML tags
// (line breaks become new lines).
const plain = (text: string) =>
  text
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')

// The names in a list field, whether a {{ubl|…}} or {{Plainlist|…}}, lines or
// commas, as one comma-separated list.
function names(value: string): string | null {
  let list = plain(value)
    .replace(/\{\{[^{}|]*\|/g, '|')
    .split(/[|\n,;•*]|\}\}/)
    .map((name) => name.trim())
    .filter((name) => name && !/[={}]/.test(name))
  return list.length ? [...new Set(list)].join(', ') : null
}

const MONTHS = 'january february march april may june july august september october november december'.split(' ')
const MONTH = `(?<month>${MONTHS.join('|')})`
// Dates as infoboxes write them: {{Start date|2018|1|25}}, 2018-01-25,
// January 25, 2018, 25 January 2018, January 2018, or a lone year.
const DATE = new RegExp(
  [
    String.raw`(?<year>\d{4})(?:-|\s*\|\s*)(?<number>\d{1,2})(?:(?:-|\s*\|\s*)(?<day>\d{1,2}))?`,
    String.raw`${MONTH}\s+(?<day>\d{1,2}),?\s+(?<year>\d{4})`,
    String.raw`(?<day>\d{1,2})\s+${MONTH}\s+(?<year>\d{4})`,
    String.raw`${MONTH},?\s+(?<year>\d{4})`,
    String.raw`\b(?<year>\d{4})\b`,
  ].join('|'),
  'i',
)

// The first date in a field, as YYYY, YYYY-MM or YYYY-MM-DD.
function firstDate(value: string): string | null {
  let groups = DATE.exec(value)?.groups
  if (!groups) return null
  // Every form has a year; the groups of the forms that did not match are undefined.
  let { year, number, month, day } = groups
  let monthNumber = number ?? (month && String(MONTHS.indexOf(month.toLowerCase()) + 1))
  return [year, monthNumber, monthNumber && day]
    .filter(Boolean)
    .map((part) => part.padStart(2, '0'))
    .join('-')
}

interface AniListMedia {
  title: { english: string | null; romaji: string }
  startDate: { year: number | null; month: number | null; day: number | null }
  episodes: number | null
  chapters: number | null
  volumes: number | null
  format: string | null
  genres: string[]
  description: string | null
  coverImage: { large: string | null }
}

const ANILIST_QUERY = `query ($search: String, $type: MediaType) {
  Page(perPage: 3) {
    media(search: $search, type: $type) {
      title { english romaji }
      startDate { year month day }
      episodes chapters volumes format genres
      description(asHtml: false)
      coverImage { large }
    }
  }
}`

// AniList's formats in words, for the platforms field.
const FORMAT: Record<string, string> = {
  TV: 'TV',
  TV_SHORT: 'TV short',
  MOVIE: 'Movie',
  SPECIAL: 'Special',
  OVA: 'OVA',
  ONA: 'ONA',
  MUSIC: 'Music',
  MANGA: 'Manga',
  NOVEL: 'Light novel',
  ONE_SHOT: 'One shot',
}

async function anilist(query: string, type: 'anime' | 'manga', fetchImpl: typeof fetch) {
  let data = await getJson(fetchImpl, 'https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: ANILIST_QUERY,
      variables: { search: query, type: type === 'anime' ? 'ANIME' : 'MANGA' },
    }),
  })
  let media: AniListMedia[] = data.data?.Page?.media ?? []
  return media.map((entry): Candidate => {
    let { year, month, day } = entry.startDate
    let pad = (part: number) => `-${String(part).padStart(2, '0')}`
    let [total, unit]: [number | null, string] =
      type === 'anime'
        ? [entry.episodes, 'episodes']
        : entry.chapters
          ? [entry.chapters, 'chapters']
          : entry.volumes
            ? [entry.volumes, 'volumes']
            : [null, 'chapters']
    return {
      source: 'anilist',
      title: entry.title.english ?? entry.title.romaji,
      released: year ? `${year}${month ? pad(month) + (day ? pad(day) : '') : ''}` : null,
      platforms: entry.format ? (FORMAT[entry.format] ?? entry.format) : null,
      // The first paragraph, as text: the summary without the source notes.
      description:
        entry.description
          ?.replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]*>/g, '')
          .split(/\n\s*\n/)[0]
          .trim() || null,
      cover_url: entry.coverImage?.large ?? null,
      progress_total: total,
      progress_unit: unit,
      tags: entry.genres?.join(', ') || null,
    }
  })
}
