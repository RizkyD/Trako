import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { lookup, USER_AGENT } from './lookup.ts'

interface FixturePage {
  title: string
  wikitext?: string
  extract?: string
  thumbnail?: string
  disambiguation?: boolean
}

// Wikipedia's answer to a search, the hits given in search order. The API lists
// pages in its own order, so they go out reversed.
const wikipediaReply = (pages: FixturePage[]) =>
  Response.json({
    query: {
      pages: pages
        .map((page, index) => ({
          title: page.title,
          index: index + 1,
          extract: page.extract,
          thumbnail: page.thumbnail && { source: page.thumbnail },
          pageprops: page.disambiguation ? { disambiguation: '' } : undefined,
          revisions: [{ slots: { main: { content: page.wikitext ?? '' } } }],
        }))
        .reverse(),
    },
  })

// A fetch that answers Wikipedia and AniList requests with the given replies (a
// source without one is down) and keeps every request.
function stub(replies: { wikipedia?: () => Response; anilist?: () => Response }) {
  let requests: { url: string; init: RequestInit }[] = []
  let fetchImpl = (async (url: string, init: RequestInit) => {
    requests.push({ url, init })
    let reply = url.startsWith('https://en.wikipedia.org/w/api.php?') ? replies.wikipedia : replies.anilist
    return reply ? reply() : new Response('Service Unavailable', { status: 503 })
  }) as unknown as typeof fetch
  return { fetchImpl, requests }
}

const CELESTE = `{{Short description|2018 video game}}
{{Infobox video game
| title = Celeste
| image = Celeste box art full.png
| developer = [[Maddy Makes Games]]
| released = {{ubl
  | '''PC, Switch, PS4'''<br />{{video game release|WW|January 25, 2018}}
  | '''Xbox One'''<br />{{video game release|WW|January 26, 2018}}
  }}
| genre = [[Platform game|Platform]]<ref>{{cite web|title=Genre|access-date=2019-02-01}}</ref>
| platforms = {{ubl
  | [[Linux]]
  | [[Microsoft Windows|Windows]]<!-- PC -->
  | [[Nintendo Switch]]
  }}
| modes = [[Single-player]]
}}
'''''Celeste''''' is a 2018 [[platform video game]].`

// A manga article that carries its anime's infobox too.
const CHAINSAW_MAN = `{{Infobox animanga/Header
| genre = {{UBL|[[Action fiction|Action]]<ref name="viz"/>|[[Dark fantasy]]}}
}}
{{Infobox animanga/Print
| type = manga
| first = December 3, 2018
| volumes = 22 ([[List of Chainsaw Man chapters|List of volumes]])
}}
{{Infobox animanga/Video
| type = tv series
| first = {{Start date|2022|10|12}}
| episodes = 12
}}`

describe('lookup', () => {
  it('reads release, platforms, genres, intro and cover from Wikipedia', async () => {
    let { fetchImpl, requests } = stub({
      wikipedia: () =>
        wikipediaReply([
          { title: 'Celeste', wikitext: 'Celeste may refer to:', disambiguation: true },
          { title: 'Celeste (name)', wikitext: "'''Celeste''' is a given name.", extract: 'A name.' },
          {
            title: 'Celeste (video game)',
            wikitext: CELESTE,
            extract: 'Celeste ( ) is a 2018 platform video game ( ; pronounced).',
            thumbnail: 'https://thumb.wikimedia.org/celeste.png',
          },
        ]),
    })

    // Not the disambiguation page, nor an article about no title at all.
    assert.deepEqual(await lookup('Celeste', 'game', fetchImpl), [
      {
        source: 'wikipedia',
        title: 'Celeste (video game)',
        released: '2018-01-25',
        platforms: 'Linux, Windows, Nintendo Switch',
        description: 'Celeste is a 2018 platform video game (pronounced).',
        cover_url: 'https://thumb.wikimedia.org/celeste.png',
        progress_total: null,
        progress_unit: null,
        tags: 'Platform',
      },
    ])
    // One request, naming the app, that gives up after a while.
    assert.equal(requests.length, 1)
    let url = new URL(requests[0].url)
    assert.equal(url.searchParams.get('gsrsearch'), 'Celeste')
    assert.equal(url.searchParams.get('rvsection'), '0')
    assert.equal((requests[0].init.headers as Record<string, string>)['User-Agent'], USER_AGENT)
    assert.ok(requests[0].init.signal instanceof AbortSignal)
  })

  it('ranks the article named as searched first, then the one fitting the type', async () => {
    let page = (title: string) => ({ title, wikitext: '\n| released = 2001' })
    let { fetchImpl } = stub({
      wikipedia: () =>
        wikipediaReply([
          page('Persona 5 Royal'),
          page('Persona 5'),
          page('Persona 5 (film)'),
          page('Persona 5 (manga)'),
        ]),
    })
    let titles = async (type: 'game' | 'manga') =>
      (await lookup('persona 5', type, fetchImpl))?.map((match) => match.title)
    assert.deepEqual(await titles('game'), ['Persona 5', 'Persona 5 (film)', 'Persona 5 (manga)', 'Persona 5 Royal'])
    assert.deepEqual(await titles('manga'), ['Persona 5 (manga)', 'Persona 5', 'Persona 5 (film)', 'Persona 5 Royal'])
  })

  it('reads dates as each infobox writes them, and episodes or volumes', async () => {
    let cases = [
      ['film', '| released = {{Film date|2001|07|20|Japan}}', '2001-07-20', null, null],
      ['novel', '| published = 26 June 1997 ([[Bloomsbury]])', '1997-06-26', null, null],
      ['series', '| released = {{Start date|2008|1|20}}\n| num_episodes = 1,062', '2008-01-20', 1062, 'episodes'],
      ['game', '| released = October 2018', '2018-10', null, null],
      ['game', '| release_date = [[1989]] (Japan)', '1989', null, null],
      ['manga', CHAINSAW_MAN, '2018-12-03', 22, 'volumes'],
      // The anime's own infobox, in the manga's article.
      ['anime', CHAINSAW_MAN, '2022-10-12', 12, 'episodes'],
    ] as const
    for (let [type, wikitext, released, total, unit] of cases) {
      let { fetchImpl } = stub({ wikipedia: () => wikipediaReply([{ title: 'X', wikitext: `{{Infobox\n${wikitext}\n}}` }]) })
      let [match] = (await lookup('X', type, fetchImpl)) ?? []
      assert.deepEqual([match?.released, match?.progress_total, match?.progress_unit], [released, total, unit], wikitext)
    }
    let { fetchImpl } = stub({ wikipedia: () => wikipediaReply([{ title: 'X', wikitext: CHAINSAW_MAN }]) })
    assert.equal((await lookup('X', 'anime', fetchImpl))?.[0].tags, 'Action, Dark fantasy')
  })

  it('reads AniList matches first for anime and manga', async (t) => {
    let { fetchImpl, requests } = stub({
      wikipedia: () => wikipediaReply([{ title: 'Frieren (TV series)', wikitext: '\n| released = 2023\n| num_episodes = 38' }]),
      anilist: () =>
        Response.json({
          data: {
            Page: {
              media: [
                {
                  title: { english: null, romaji: 'Sousou no Frieren' },
                  startDate: { year: 2023, month: 9, day: 29 },
                  episodes: 28,
                  chapters: null,
                  volumes: null,
                  format: 'TV',
                  genres: ['Adventure', 'Drama'],
                  description: 'The adventure is <i>over</i>.<br><br>\n(Source: Crunchyroll)',
                  coverImage: { large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx154587.jpg' },
                },
                {
                  title: { english: 'Frieren Season 3', romaji: 'Sousou no Frieren 3rd Season' },
                  startDate: { year: 2027, month: 10, day: null },
                  episodes: null,
                  chapters: null,
                  volumes: null,
                  format: 'TV_SHORT',
                  genres: [],
                  description: null,
                  coverImage: { large: null },
                },
              ],
            },
          },
        }),
    })
    let matches = await lookup('Frieren', 'anime', fetchImpl)
    assert.deepEqual(matches?.slice(0, 2), [
      {
        source: 'anilist',
        title: 'Sousou no Frieren',
        released: '2023-09-29',
        platforms: 'TV',
        description: 'The adventure is over.',
        cover_url: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx154587.jpg',
        progress_total: 28,
        progress_unit: 'episodes',
        tags: 'Adventure, Drama',
      },
      {
        source: 'anilist',
        title: 'Frieren Season 3',
        released: '2027-10',
        platforms: 'TV short',
        description: null,
        cover_url: null,
        progress_total: null,
        progress_unit: 'episodes',
        tags: null,
      },
    ])
    assert.deepEqual(matches?.slice(2).map((match) => [match.source, match.title]), [['wikipedia', 'Frieren (TV series)']])
    let anilist = requests.find((request) => request.url === 'https://graphql.anilist.co')
    assert.equal(anilist?.init.method, 'POST')
    assert.deepEqual(JSON.parse(String(anilist?.init.body)).variables, { search: 'Frieren', type: 'ANIME' })
    assert.equal((anilist?.init.headers as Record<string, string>)['User-Agent'], USER_AGENT)

    // Manga count chapters, or volumes when the chapters are unknown.
    let manga = stub({
      anilist: () =>
        Response.json({
          data: {
            Page: {
              media: [
                {
                  title: { english: 'Berserk', romaji: 'Berserk' },
                  startDate: { year: 1989, month: null, day: null },
                  episodes: null,
                  chapters: null,
                  volumes: 42,
                  format: 'MANGA',
                  genres: ['Action'],
                  description: 'Guts.',
                  coverImage: { large: null },
                },
              ],
            },
          },
        }),
    })
    let [berserk] = (await lookup('Berserk', 'manga', manga.fetchImpl)) ?? []
    assert.deepEqual(
      [berserk.released, berserk.platforms, berserk.progress_total, berserk.progress_unit],
      ['1989', 'Manga', 42, 'volumes'],
    )
    assert.equal(JSON.parse(String(manga.requests.find((request) => request.url.includes('anilist'))?.init.body)).variables.type, 'MANGA')
  })

  it('keeps one source’s matches when the other fails, and fails when both do', async () => {
    let anilist = () =>
      Response.json({
        data: {
          Page: {
            media: [
              {
                title: { english: 'Dandadan', romaji: 'Dandadan' },
                startDate: { year: 2024, month: null, day: null },
                episodes: 12,
                chapters: null,
                volumes: null,
                format: 'TV',
                genres: [],
                description: null,
                coverImage: { large: null },
              },
            ],
          },
        },
      })
    // A throttled Wikipedia answers with an HTML page.
    let throttled = () => new Response('<!DOCTYPE html><p>Too many requests</p>', { headers: { 'Content-Type': 'text/html' } })
    let wikipedia = () => wikipediaReply([{ title: 'Dandadan', wikitext: '\n| first = 2021' }])
    let sources = async (fetchImpl: typeof fetch, type: 'anime' | 'game' = 'anime') =>
      (await lookup('Dandadan', type, fetchImpl))?.map((match) => match.source) ?? null

    assert.deepEqual(await sources(stub({ wikipedia: throttled, anilist }).fetchImpl), ['anilist'])
    assert.deepEqual(await sources(stub({ wikipedia }).fetchImpl), ['wikipedia'])
    assert.equal(await sources(stub({ wikipedia: throttled }).fetchImpl), null)
    assert.equal(await sources(stub({}).fetchImpl, 'game'), null)
    // Answering with no hits is not a failure.
    assert.deepEqual(await sources(stub({ wikipedia: () => Response.json({ batchcomplete: true }) }).fetchImpl, 'game'), [])
    let offline = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    assert.equal(await sources(offline), null)
  })
})
