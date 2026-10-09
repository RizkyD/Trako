import { gzipSync } from 'node:zlib'

import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { fromCsv, fromMal, fromSteam, parseCsv } from './importers.ts'

// A MyAnimeList export with every status, an unrated film, unknown (0000) and
// partial (-00) dates, an unknown total and a light novel.
const MAL = `<?xml version="1.0" encoding="UTF-8" ?>
<!-- Created by XML Export feature at MyAnimeList.net -->
<myanimelist>
  <myinfo>
    <user_id>1</user_id>
    <user_name><![CDATA[tester]]></user_name>
    <user_export_type>1</user_export_type>
  </myinfo>
  <anime>
    <series_animedb_id>5114</series_animedb_id>
    <series_title><![CDATA[Fullmetal Alchemist: Brotherhood]]></series_title>
    <series_type>TV</series_type>
    <series_episodes>64</series_episodes>
    <my_watched_episodes>64</my_watched_episodes>
    <my_start_date>2015-03-01</my_start_date>
    <my_finish_date>2015-04-20</my_finish_date>
    <my_score>10</my_score>
    <my_status>Completed</my_status>
    <my_comments><![CDATA[Best <3 & then some]]></my_comments>
    <my_times_watched>1</my_times_watched>
    <my_tags><![CDATA[classic, shounen]]></my_tags>
  </anime>
  <anime>
    <series_title><![CDATA[Your Name.]]></series_title>
    <series_type>Movie</series_type>
    <series_episodes>1</series_episodes>
    <my_watched_episodes>0</my_watched_episodes>
    <my_start_date>0000-00-00</my_start_date>
    <my_finish_date>0000-00-00</my_finish_date>
    <my_score>0</my_score>
    <my_status>Plan to Watch</my_status>
    <my_comments><![CDATA[]]></my_comments>
    <my_times_watched>0</my_times_watched>
    <my_tags><![CDATA[]]></my_tags>
  </anime>
  <anime>
    <series_title><![CDATA[One Piece]]></series_title>
    <series_type>TV</series_type>
    <series_episodes>0</series_episodes>
    <my_watched_episodes>400</my_watched_episodes>
    <my_start_date>2019-05-00</my_start_date>
    <my_finish_date>0000-00-00</my_finish_date>
    <my_score>8</my_score>
    <my_status>Watching</my_status>
  </anime>
  <anime>
    <series_title>Tom &amp; Jerry</series_title>
    <series_type>OVA</series_type>
    <series_episodes>2</series_episodes>
    <my_watched_episodes>1</my_watched_episodes>
    <my_score>0</my_score>
    <my_status>On-Hold</my_status>
  </anime>
  <manga>
    <manga_mangadb_id>2</manga_mangadb_id>
    <manga_title><![CDATA[Berserk]]></manga_title>
    <manga_volumes>0</manga_volumes>
    <manga_chapters>0</manga_chapters>
    <my_read_volumes>0</my_read_volumes>
    <my_read_chapters>364</my_read_chapters>
    <my_start_date>2010-01-02</my_start_date>
    <my_finish_date>0000-00-00</my_finish_date>
    <my_score>9</my_score>
    <my_status>Reading</my_status>
    <my_times_read>0</my_times_read>
  </manga>
  <manga>
    <manga_title><![CDATA[Spice and Wolf]]></manga_title>
    <series_type>Light Novel</series_type>
    <manga_chapters>17</manga_chapters>
    <my_read_chapters>3</my_read_chapters>
    <my_score>6</my_score>
    <my_status>Dropped</my_status>
  </manga>
  <manga>
    <manga_title><![CDATA[Vagabond]]></manga_title>
    <manga_chapters>327</manga_chapters>
    <my_read_chapters>0</my_read_chapters>
    <my_score>0</my_score>
    <my_status>Plan to Read</my_status>
  </manga>
</myanimelist>
`

const empty = { note: null, tags: null, replays: 0 }

describe('importers', () => {
  it('reads a MyAnimeList export, packed or not', () => {
    let entries = fromMal(new TextEncoder().encode(MAL))
    assert.deepEqual(entries, [
      {
        title: 'Fullmetal Alchemist: Brotherhood',
        type: 'anime',
        status: 'finished',
        rating: 10,
        started_at: '2015-03-01',
        finished_at: '2015-04-20',
        note: 'Best <3 & then some',
        tags: 'classic, shounen',
        replays: 1,
        progress: 64,
        progress_total: 64,
        progress_unit: 'episodes',
      },
      // A film, so no episodes.
      { title: 'Your Name.', type: 'film', status: 'planned', rating: null, started_at: null, finished_at: null, ...empty },
      {
        title: 'One Piece',
        type: 'anime',
        status: 'ongoing',
        rating: 8,
        started_at: null,
        finished_at: null,
        ...empty,
        progress: 400,
        progress_total: null,
        progress_unit: 'episodes',
      },
      {
        title: 'Tom & Jerry',
        type: 'anime',
        status: 'on_hold',
        rating: null,
        started_at: null,
        finished_at: null,
        ...empty,
        progress: 1,
        progress_total: 2,
        progress_unit: 'episodes',
      },
      {
        title: 'Berserk',
        type: 'manga',
        status: 'ongoing',
        rating: 9,
        started_at: '2010-01-02',
        finished_at: null,
        ...empty,
        progress: 364,
        progress_total: null,
        progress_unit: 'chapters',
      },
      {
        title: 'Spice and Wolf',
        type: 'novel',
        status: 'dropped',
        rating: 6,
        started_at: null,
        finished_at: null,
        ...empty,
        progress: 3,
        progress_total: 17,
        progress_unit: 'chapters',
      },
      {
        title: 'Vagabond',
        type: 'manga',
        status: 'planned',
        rating: null,
        started_at: null,
        finished_at: null,
        ...empty,
        progress: 0,
        progress_total: 327,
        progress_unit: 'chapters',
      },
    ])
    // MyAnimeList downloads it gzipped.
    assert.deepEqual(fromMal(gzipSync(MAL)), entries)
    assert.equal(fromMal(new TextEncoder().encode('{"app": "trako"}')), null)
    assert.equal(fromMal(new Uint8Array([0x1f, 0x8b, 1, 2, 3])), null)
  })

  it('splits CSV on commas, except inside quotes', () => {
    assert.deepEqual(parseCsv('a,"b, c","say ""hi""",\r\n"two\r\nlines",x\n\nlast'), [
      ['a', 'b, c', 'say "hi"', ''],
      ['two\r\nlines', 'x'],
      [''],
      ['last'],
    ])
    assert.deepEqual(parseCsv('title\n'), [['title']])
  })

  it('reads a CSV file with a header row', () => {
    let csv = [
      '﻿Title,Type,Status,Rating,Progress total,Shelf,note',
      '"Persona 5, Royal",game,finished,10,,top,"Said ""yes""\r\nto all"',
      'Celeste,,On hold,9,,,',
      ',,,,,,',
      'Bad,game,finished,11,,,',
      'Dune,novel,in progress,,-3,,',
    ].join('\r\n')
    assert.deepEqual(fromCsv(csv, 'game'), [
      { row: 2, title: 'Persona 5, Royal', type: 'game', status: 'finished', rating: 10, note: 'Said "yes"\r\nto all' },
      // No type: the one picked in the form; "On hold" is on_hold.
      { row: 3, title: 'Celeste', type: 'game', status: 'on_hold', rating: 9 },
      // Blank rows are left out; bad values are left for the import to turn down.
      { row: 5, title: 'Bad', type: 'game', status: 'finished', rating: 11 },
      { row: 6, title: 'Dune', type: 'novel', status: 'in_progress', progress_total: -3 },
    ])
    // Without a type in the form, a row needs its own; without a status it is planned.
    assert.deepEqual(fromCsv('title\nAkira', ''), [{ row: 2, title: 'Akira', type: '', status: 'planned' }])
    assert.equal(fromCsv('name,type\nAkira,manga', 'manga'), null)
    assert.equal(fromCsv('', 'manga'), null)
  })

  it('reads the games a Steam account owns', async (t) => {
    let requests: string[] = []
    let reply = () =>
      Response.json({
        response: {
          game_count: 2,
          games: [
            { appid: 504230, name: 'Celeste', playtime_forever: 1234 },
            { appid: 1145360, name: 'Hades', playtime_forever: 0 },
          ],
        },
      })
    t.mock.method(globalThis, 'fetch', async (url: string) => {
      requests.push(url)
      return reply()
    })
    assert.deepEqual(await fromSteam('ABC123', '76561197960287930'), [
      {
        title: 'Celeste',
        type: 'game',
        status: 'ongoing',
        platforms: 'Steam',
        progress: 21,
        progress_unit: 'hours',
        cover_url: 'https://cdn.cloudflare.steamstatic.com/steam/apps/504230/library_600x900.jpg',
      },
      {
        title: 'Hades',
        type: 'game',
        status: 'planned',
        platforms: 'Steam',
        progress: 0,
        progress_unit: 'hours',
        cover_url: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/library_600x900.jpg',
      },
    ])
    let url = new URL(requests[0])
    assert.equal(url.origin + url.pathname, 'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/')
    assert.deepEqual(
      [url.searchParams.get('key'), url.searchParams.get('steamid'), url.searchParams.get('include_appinfo')],
      ['ABC123', '76561197960287930', '1'],
    )

    // A private profile shows no games; a wrong key is refused; Steam can be down.
    reply = () => Response.json({ response: {} })
    assert.equal(await fromSteam('ABC123', '76561197960287930'), null)
    reply = () => new Response('<html>Forbidden</html>', { status: 403 })
    assert.equal(await fromSteam('wrong', '76561197960287930'), null)
    reply = () => {
      throw new TypeError('fetch failed')
    }
    assert.equal(await fromSteam('ABC123', '76561197960287930'), null)
  })
})
