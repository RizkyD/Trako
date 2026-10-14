import * as assert from 'remix/assert'
import { beforeEach, describe, it } from 'remix/test'

import { routes } from '../routes.ts'
import { get, post, reset, signIn } from '../test-helpers.ts'

// A day relative to today, in local time, as dates are stored.
function day(offset: number) {
  let date = new Date()
  date.setDate(date.getDate() + offset)
  return date.toLocaleDateString('sv')
}
const later = String(new Date().getFullYear() + 2)

describe('browse', () => {
  let cookie = ''
  beforeEach(async () => {
    reset()
    cookie = await signIn()
  })
  let page = async (query: string) => (await get(routes.home.href() + query, cookie)).text()
  // The titles a page lists, each once (an upcoming title is listed twice).
  let titles = async (query: string) => [
    ...new Set([...(await page(query)).matchAll(/<div class="title"><a href="\/items\/\d+">([^<]+)</g)].map((match) => match[1])),
  ]
  let add = (fields: Record<string, string>) =>
    post(routes.itemCreate.href(), { type: 'game', status: 'planned', ...fields }, cookie)
  // The Trails series, and two more franchises: released, coming out and
  // undated titles, rated or not, on several platforms.
  let addTrails = async () => {
    for (let name of ['Trails', 'Ys', 'Xanadu']) await post(routes.franchiseCreate.href(), { name }, cookie)
    let trails = (fields: Record<string, string>) => add({ franchise: 'Trails', ...fields })
    await trails({
      title: 'Trails in the Sky',
      status: 'finished',
      released: '2004-06-24',
      rating: '9',
      platforms: 'Windows, PSP',
      tags: 'JRPG, falcom',
      description: 'Estelle and Joshua **travel** the land.',
    })
    await trails({
      title: 'Trails of Cold Steel',
      released: '2013-09',
      rating: '7',
      platforms: 'PlayStation 3, Vita',
      note: 'Rean becomes a *teacher* later.',
    })
    await trails({ title: 'Trails beyond the Horizon', released: day(10), platforms: 'PlayStation 5, Windows' })
    await trails({ title: 'Trails to Come', released: later })
    await trails({ title: 'Trails of Today', released: day(0) })
    await trails({ title: 'Trails of This Month', released: day(0).slice(0, 7) })
    await trails({ title: 'Trails in Motion', type: 'anime', status: 'ongoing' })
  }

  it('searches titles in any case, along with the other filters', async () => {
    await add({ title: 'Celeste', status: 'finished' })
    await add({ title: 'Hades', status: 'ongoing' })
    let found = await page('?q=hAd')
    assert.match(found, /href="\/items\/2"/)
    assert.doesNotMatch(found, /href="\/items\/1"/)
    assert.match(await page('?q=hAd&status=finished'), /No titles match/)
  })

  it('searches descriptions, notes, platforms and tags too', async () => {
    await addTrails()
    assert.deepEqual(await titles('?q=TRAVEL'), ['Trails in the Sky'])
    assert.deepEqual(await titles('?q=teacher'), ['Trails of Cold Steel'])
    assert.deepEqual(await titles('?q=vita'), ['Trails of Cold Steel'])
    assert.deepEqual(await titles('?q=jrpg'), ['Trails in the Sky'])
  })

  it('lists one type at a time, novels and series included', async () => {
    await add({ title: 'Celeste' })
    for (let type of ['novel', 'series']) {
      assert.equal((await add({ title: `A ${type}`, type })).status, 302)
      let listed = await page(`?type=${type}`)
      assert.match(listed, new RegExp(`class="tag ${type}">${type}<`))
      assert.doesNotMatch(listed, /Celeste/)
    }
  })

  it('ranks titles in one list by rating, finish date or release', async () => {
    await add({ title: 'Celeste', status: 'finished', rating: '9', released: '2018-01-25' })
    await add({ title: 'Hades', status: 'ongoing', rating: '10', released: '2020-09' })
    let order = (html: string) => html.indexOf('href="/items/2"') - html.indexOf('href="/items/1"')
    let byRating = await page('?sort=rating')
    assert.match(byRating, /Highest rated/)
    assert.ok(order(byRating) < 0, 'the 10 ranks above the 9')
    let lowFirst = await page('?sort=rating&dir=asc')
    assert.match(lowFirst, /Lowest rated/)
    assert.ok(order(lowFirst) > 0, 'ascending puts the 9 above the 10')
    assert.ok(order(await page('?sort=finished')) > 0, 'the finished title ranks above the unfinished one')
    let oldest = await page('?sort=released')
    assert.match(oldest, /Oldest releases/)
    assert.ok(order(oldest) > 0, '2018 comes before 2020')
    assert.ok(order(await page('?sort=released&dir=desc')) < 0, 'descending puts 2020 first')
  })

  it('lists upcoming releases first, soonest first, with how long is left', async () => {
    await addTrails()
    // A year or a month counts from its first day; today's releases are out.
    let trails = await page('?q=Trails')
    let upcoming = /<section class="group upcoming">.*?<\/section>/s.exec(trails)?.[0] ?? ''
    assert.match(upcoming, /Trails beyond the Horizon<\/a><small><span class="tag game">game<\/span>[^<]+ · <strong>in 10 days</)
    assert.match(upcoming, new RegExp(`Trails to Come</a><small><span class="tag game">game</span>${later} · <strong>in \\d+ months<`))
    assert.ok(upcoming.indexOf('Trails beyond the Horizon') < upcoming.indexOf('Trails to Come'))
    assert.doesNotMatch(upcoming, /Today|This Month|Sky|Cold Steel|Motion/)
    // They stay in their franchise panel too.
    assert.equal(trails.split('>Trails beyond the Horizon</a>').length, 3)
    assert.doesNotMatch(await page('?q=Trails&type=anime'), /class="group upcoming"/)
  })

  it('serves franchise panels open, with a heading per type and buttons to fold them all', async () => {
    await addTrails()
    // Panels collapse: served open, as <details>. Several types get a heading each.
    let trails = await page('?q=Trails')
    assert.match(trails, /<details open data-franchise="\d+" class="group"><summary><h2>Trails<\/h2>/)
    assert.match(trails, /<h3 class="kind"><i class="swatch game"><\/i>Games <span>6<\/span><\/h3>/)
    assert.ok(trails.indexOf('>Games <span>') < trails.indexOf('>Anime <span>1</span>'))
    assert.doesNotMatch(await page('?q=Trails&type=game'), /class="kind"/)
    // Collapse all / Expand all come with three panels or more.
    assert.doesNotMatch(trails, /data-panels/)
    await add({ title: 'Ys Origin', franchise: 'Ys', tags: 'falcom' })
    await add({ title: 'Xanadu Next', franchise: 'Xanadu', tags: 'falcom' })
    assert.match(await page('?tag=falcom'), /data-panels="collapse"[^]*data-panels="expand"/)
  })

  it('shows a timeline, a row per release year, undated titles last', async () => {
    await addTrails()
    // Either direction; the sort is ignored (and not offered), and so are
    // upcoming and franchise panels.
    let years = (html: string) => [...html.matchAll(/<div class="year"><h2>(\w+)<\/h2>/g)].map((match) => match[1])
    let dated = [...new Set(['2004', '2013', day(0).slice(0, 4), day(10).slice(0, 4), later])].sort()
    let timeline = await page('?q=Trails&view=timeline')
    assert.deepEqual(years(timeline), [...dated, 'Unknown'])
    assert.deepEqual(years(await page('?q=Trails&view=timeline&sort=rating')), [...dated, 'Unknown'])
    assert.deepEqual(years(await page('?q=Trails&view=timeline&sort=rating&dir=desc')), [...dated.reverse(), 'Unknown'])
    assert.doesNotMatch(timeline, /aria-label="Sort by"|class="group upcoming"|<details/)
    let rows = Object.fromEntries(
      timeline.split('<div class="year"><h2>').slice(1).map((row) => [row.slice(0, row.indexOf('<')), row]),
    )
    assert.match(rows['2004'], /Trails in the Sky/)
    assert.doesNotMatch(rows['2004'], /Cold Steel/)
    assert.match(rows['2013'], /Trails of Cold Steel<\/a><small><span class="tag game">game<\/span>Trails</)
    assert.match(rows.Unknown, /Trails in Motion/)
    assert.deepEqual(years(await page('?q=Trails&view=timeline&type=anime')), ['Unknown'])
  })

  it('filters by platform, a whole name in any case, offered from every platform listed', async () => {
    await addTrails()
    assert.deepEqual((await titles('?platform=windows')).sort(), ['Trails beyond the Horizon', 'Trails in the Sky'])
    assert.deepEqual(await titles('?platform=PlayStation'), [])
    // Along with the other filters.
    assert.deepEqual(await titles('?platform=windows&status=finished'), ['Trails in the Sky'])
    assert.deepEqual(await titles('?platform=windows&type=anime'), [])
    let windows = await page('?platform=windows')
    assert.match(windows, /<option value="Vita">Vita<\/option>/)
    assert.match(windows, /<option value="Windows" selected>Windows<\/option>/)
  })

  it('filters by a minimum rating; other values filter nothing', async () => {
    await addTrails()
    assert.deepEqual(await titles('?q=Trails&rating=8'), ['Trails in the Sky'])
    assert.deepEqual((await titles('?q=Trails&rating=7')).sort(), ['Trails in the Sky', 'Trails of Cold Steel'])
    assert.deepEqual(await titles('?rating=7&status=planned&type=game'), ['Trails of Cold Steel'])
    assert.deepEqual(await titles('?rating=7&type=anime'), [])
    assert.deepEqual(await titles('?q=Trails&rating=11'), await titles('?q=Trails'))
  })

  it('shows platform and rating filters as removable chips, and carries them along', async () => {
    await addTrails()
    let both = await page('?status=finished&platform=Windows&rating=8')
    assert.match(both, /<a href="\/\?status=finished&amp;rating=8" class="chip">Windows <span aria-hidden="true">×/)
    assert.match(both, /<a href="\/\?status=finished&amp;platform=Windows" class="chip">Rating ≥ 8 <span aria-hidden="true">×/)
    assert.match(
      both,
      /<input type="hidden" name="status" value="finished" \/><input type="hidden" name="platform" value="Windows" \/><input type="hidden" name="rating" value="8" \/><input type="search"/,
    )
    assert.match(both, /class="list-filters"><input type="hidden" name="status" value="finished" \/><select name="platform"/)
    assert.match(both, /action="\/items\/\d+\/toggle\?status=finished&amp;platform=Windows&amp;rating=8"/)
    let sky = /href="\/items\/(\d+)"/.exec(both)?.[1] ?? ''
    let starred = await post(routes.itemFavorite.href({ id: sky }) + '?platform=Windows&rating=8', {}, cookie)
    assert.equal(starred.headers.get('Location'), '/?platform=Windows&rating=8')
  })
})
