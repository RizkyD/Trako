import * as assert from 'remix/assert'
import { beforeEach, describe, it } from 'remix/test'

import { today } from './db.ts'
import { routes } from './routes.ts'
import { cookieOf, exported, get, post, reset, signIn } from './test-helpers.ts'

const file = (text: string, name = 'backup.json') => new File([text], name, { type: 'application/json' })

describe('transfer', () => {
  let cookie = ''
  beforeEach(async () => {
    reset()
    cookie = await signIn()
  })
  // Posts a form from the settings page and returns that page, with the message
  // the post left in the session.
  let send = async (path: string, fields: Record<string, string | File>) => {
    let response = await post(path, fields, cookie)
    cookie = cookieOf(response) || cookie
    return (await get(routes.settings.href(), cookie)).text()
  }
  let add = (fields: Record<string, string | File>) =>
    post(routes.itemCreate.href(), { type: 'game', status: 'planned', ...fields }, cookie)
  // Three titles; Persona 5, the third, has a franchise and a cover.
  let addThree = async () => {
    await post(routes.franchiseCreate.href(), { name: 'Persona' }, cookie)
    await add({ title: 'Celeste', status: 'finished' })
    await add({ title: 'Hades', status: 'ongoing' })
    let png = new File([new Uint8Array([137, 80, 78, 71])], 'cover.png', { type: 'image/png' })
    await add({ title: 'Persona 5', franchise: 'Persona', cover: png })
  }
  let coverPath = async () =>
    /src="(\/covers\/[^"]+)"/.exec(await (await get(routes.home.href() + '?q=persona', cookie)).text())?.[1] ?? ''

  it('exports every title with its cover, and never the account', async () => {
    await addThree()
    assert.equal((await get(routes.export.href())).status, 302)
    let response = await get(routes.export.href(), cookie)
    assert.match(response.headers.get('Content-Disposition') ?? '', /attachment; filename="trako-export-/)
    let backup = await response.text()
    let parsed = JSON.parse(backup)
    assert.equal(parsed.items.length, 3)
    assert.equal(parsed.items.find((item: { title: string }) => item.title === 'Persona 5').cover.data, 'iVBORw==')
    assert.doesNotMatch(backup, /rahasia|password/)
  })

  it('imports an export, skipping the titles already in the list', async () => {
    await addThree()
    let backup = await (await get(routes.export.href(), cookie)).text()
    await post(routes.itemDelete.href({ id: 3 }), {}, cookie)
    assert.match(await send(routes.import.href(), { file: file(backup) }), /Imported 1 titles, skipped 2/)
    // The deleted title is back, cover included.
    let restoredCover = await coverPath()
    assert.ok(restoredCover)
    assert.equal((await (await get(restoredCover, cookie)).arrayBuffer()).byteLength, 4)
  })

  it('changes nothing with a file that is not an export', async () => {
    await addThree()
    assert.match(await send(routes.import.href(), { file: file('{"items": 1}'), replace: 'on' }), /not a valid Trako export/)
    assert.equal((await exported(cookie)).length, 3)
  })

  it('replaces the whole list, franchises included, once confirmed', async () => {
    await addThree()
    let cover = await coverPath()
    // Replacing is confirmed in a dialog whose button submits the import form.
    let importPage = await (await get(routes.settings.href(), cookie)).text()
    assert.match(importPage, /id="confirm-replace"[^>]*popover[^]*<button[^>]*form="import"[^>]*>/)
    assert.match(importPage, /popovertarget="confirm-replace"[^>]*>Replace everything/)
    assert.match(importPage, /<h2>Replace everything\?<\/h2><p>All 3 current titles, their covers and every franchise will be deleted/)
    assert.match(importPage, /popovertarget="confirm-replace" popovertargetaction="hide"[^>]*>Cancel</)

    let other = JSON.stringify({
      app: 'trako',
      franchises: ['Zelda'],
      items: [{ title: 'Ocarina of Time', type: 'game', status: 'planned', franchise: 'Zelda' }],
    })
    await send(routes.import.href(), { file: file(other), replace: 'on' })
    let replaced = JSON.parse(await (await get(routes.export.href(), cookie)).text())
    assert.deepEqual(replaced.franchises, ['Zelda'])
    assert.deepEqual(replaced.items.map((item: { title: string }) => item.title), ['Ocarina of Time'])
    assert.equal((await get(cover, cookie)).status, 404)
  })

  it('carries progress, start dates, favorites, replays and tags through export and import', async () => {
    await add({
      title: 'Dandadan',
      type: 'manga',
      status: 'ongoing',
      started_at: today(),
      progress: '3',
      progress_total: '3',
      progress_unit: 'chapters',
      replays: '1',
    })
    await add({ title: 'Bleach', type: 'manga', status: 'dropped', favorite: 'on', tags: 'Shonen, swords' })
    await add({ title: 'Berserk', type: 'manga', status: 'on_hold', started_at: '2026-01-03' })
    let backup = await (await get(routes.export.href(), cookie)).text()
    let entry = JSON.parse(backup).items.find((item: { title: string }) => item.title === 'Dandadan')
    assert.equal(entry.started_at, today())
    assert.deepEqual(
      [entry.progress, entry.progress_total, entry.progress_unit, entry.favorite, entry.replays],
      [3, 3, 'chapters', false, 1],
    )
    // Importing the file restores them as they were.
    assert.match(await send(routes.import.href(), { file: file(backup), replace: 'on' }), /Imported \d+ titles/)
    let restored = await (await get(routes.export.href(), cookie)).text()
    assert.deepEqual(JSON.parse(restored).items, JSON.parse(backup).items)
  })

  it('imports files from before the newer fields, with defaults, and refuses bad values', async () => {
    let old = { title: 'Akira', type: 'film', status: 'finished', finished_at: '2020-01-01' }
    assert.match(await send(routes.import.href(), { file: file(JSON.stringify({ app: 'trako', items: [old] })) }), /Imported 1 titles/)
    let akira = (await exported(cookie)).find((item) => item.title === 'Akira')!
    assert.deepEqual(
      [akira.started_at, akira.progress, akira.progress_total, akira.progress_unit, akira.favorite, akira.replays, akira.tags],
      [null, 0, null, null, false, 0, null],
    )
    for (let bad of [
      { status: 'paused' },
      { started_at: '2026-1-3' },
      { progress: -1 },
      { progress_total: 0 },
      { replays: 1.5 },
      { favorite: 'yes' },
    ]) {
      let text = JSON.stringify({ app: 'trako', items: [{ title: 'y', type: 'game', status: 'planned', ...bad }] })
      assert.match(await send(routes.import.href(), { file: file(text) }), /not a valid Trako export/, JSON.stringify(bad))
    }
  })

  it('offers imports from MyAnimeList, CSV files and Steam', async () => {
    let settings = await (await get(routes.settings.href(), cookie)).text()
    for (let action of ['/import/mal', '/import/csv', '/import/steam']) assert.match(settings, new RegExp(`action="${action}"`))
  })

  it('imports a MyAnimeList export, into the franchise typed', async () => {
    let mal = `<myanimelist>
      <anime><series_title><![CDATA[Mushishi]]></series_title><series_type>TV</series_type>
        <series_episodes>26</series_episodes><my_watched_episodes>26</my_watched_episodes>
        <my_finish_date>2020-02-02</my_finish_date><my_score>9</my_score><my_status>Completed</my_status></anime>
      <manga><manga_title><![CDATA[Blame!]]></manga_title><manga_chapters>0</manga_chapters>
        <my_read_chapters>12</my_read_chapters><my_score>0</my_score><my_status>Reading</my_status></manga>
      <manga><manga_title><![CDATA[Odd]]></manga_title><my_status>Rereading</my_status></manga>
    </myanimelist>`
    // Every title goes into the franchise typed, made if need be.
    let page = await send(routes.importMal.href(), { file: file(mal, 'animelist.xml'), franchise: 'From MAL' })
    assert.match(page, /<p role="status">Imported 2 titles\.<\/p>/)
    assert.match(page, /<p role="alert">Not imported, as a value is missing or not valid: entry 3\.<\/p>/)
    assert.deepEqual(
      (await exported(cookie)).map((item) => [item.title, item.type, item.status, item.franchise, item.rating, item.finished_at, item.progress]),
      [
        ['Blame!', 'manga', 'ongoing', 'From MAL', null, null, 12],
        ['Mushishi', 'anime', 'finished', 'From MAL', 9, '2020-02-02', 26],
      ],
    )
    page = await send(routes.importMal.href(), { file: file(mal, 'animelist.xml') })
    assert.match(page, /Imported 0 titles, skipped 2 already in your list\./)
    page = await send(routes.importMal.href(), { file: file('{"app": "trako"}', 'x.json') })
    assert.match(page, /That is not a MyAnimeList export file\. Nothing was changed\./)
  })

  it('imports a CSV file, where a row’s own franchise and type beat the form’s', async () => {
    let csv = 'title,type,franchise,rating\r\nHades,,,10\r\n"Ys I, Chronicles",,Ys,\r\nSecret,,,12\r\n'
    let page = await send(routes.importCsv.href(), { file: file(csv, 'list.csv'), type: 'game', franchise: 'Indie' })
    assert.match(page, /Imported 2 titles\./)
    // Bad rows are named.
    assert.match(page, /Not imported, as a value is missing or not valid: row 4\./)
    assert.deepEqual(
      (await exported(cookie)).map((item) => [item.title, item.franchise, item.rating, item.status]),
      [
        ['Hades', 'Indie', 10, 'planned'],
        ['Ys I, Chronicles', 'Ys', null, 'planned'],
      ],
    )
    page = await send(routes.importCsv.href(), { file: file('name\nHades', 'list.csv'), type: 'game' })
    assert.match(page, /That CSV file has no title column\. Nothing was changed\./)
  })

  it('imports the games a Steam account owns, with playtime and covers', async (t) => {
    await add({ title: 'Hades' })
    let requested: string[] = []
    let steam = () =>
      Response.json({
        response: {
          games: [
            { appid: 504230, name: 'Celeste', playtime_forever: 600 },
            { appid: 1145360, name: 'Hades', playtime_forever: 90 },
            { appid: 7, name: 'Unboxed', playtime_forever: 0 },
          ],
        },
      })
    // Nothing reaches the network; the CDN has a cover for Celeste only.
    t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
      let url = String(input)
      requested.push(url)
      if (url.startsWith('https://api.steampowered.com/')) return steam()
      if (url.includes('/504230/')) return new Response(new Uint8Array([255, 216, 255]), { headers: { 'Content-Type': 'image/jpeg' } })
      return new Response('Not Found', { status: 404 })
    })
    let page = await send(routes.importSteam.href(), { key: 'KEY123', steam_id: '76561197960287930', franchise: '' })
    assert.match(page, /Imported 2 titles, skipped 1 already in your list\./)
    assert.match(new URL(requested[0]).search, /key=KEY123&steamid=76561197960287930/)
    // Hades was in the list already, so its cover was not even asked for.
    assert.deepEqual(requested.slice(1), [
      'https://cdn.cloudflare.steamstatic.com/steam/apps/504230/library_600x900.jpg',
      'https://cdn.cloudflare.steamstatic.com/steam/apps/7/library_600x900.jpg',
    ])
    let games = Object.fromEntries((await exported(cookie)).map((item) => [item.title, item]))
    assert.deepEqual(
      [games.Celeste.status, games.Celeste.progress, games.Celeste.progress_unit, games.Celeste.platforms, games.Celeste.cover],
      ['ongoing', 10, 'hours', 'Steam', { extension: 'jpg', data: '/9j/' }],
    )
    assert.deepEqual([games.Unboxed.status, games.Unboxed.cover], ['planned', null])
    // The key is not kept.
    assert.doesNotMatch(await (await get(routes.settings.href(), cookie)).text(), /KEY123/)

    steam = () => Response.json({ response: {} })
    page = await send(routes.importSteam.href(), { key: 'KEY123', steam_id: '76561197960287930' })
    assert.match(page, /Steam returned no games\. Check the key and the SteamID/)
    assert.equal((await exported(cookie)).length, 3)
  })
})
