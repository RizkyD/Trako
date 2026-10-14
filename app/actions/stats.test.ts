import * as assert from 'remix/assert'
import { beforeEach, describe, it } from 'remix/test'

import { routes } from '../routes.ts'
import { cookieOf, get, post, reset, signIn } from '../test-helpers.ts'

// A day relative to today, in local time, as dates are stored.
function day(offset: number) {
  let date = new Date()
  date.setDate(date.getDate() + offset)
  return date.toLocaleDateString('sv')
}

describe('stats', () => {
  let cookie = ''
  beforeEach(async () => {
    reset()
    cookie = await signIn()
  })
  // Replaces the list with these titles, as an export file would.
  let load = (items: object[]) => {
    let file = new File([JSON.stringify({ app: 'trako', items })], 'backup.json', { type: 'application/json' })
    return post(routes.import.href(), { file, replace: 'on' }, cookie)
  }
  let stats = async () => (await get(routes.stats.href(), cookie)).text()

  it('says what there is not enough of to count yet', async () => {
    let empty = await stats()
    assert.match(empty, /<a href="\/stats" aria-current="page">Stats<\/a>/)
    assert.match(empty, /Nothing to count yet/)
    await load([{ title: 'Solo', type: 'novel', status: 'planned' }])
    let bare = await stats()
    for (let text of ['No finished titles yet', 'No ratings yet', 'Nothing in progress with a start date', 'No titles in a franchise yet']) {
      assert.match(bare, new RegExp(text))
    }
  })

  it('counts the list up by type, status, year, rating, run and franchise', async () => {
    await load([
      { title: 'Ys I', type: 'game', status: 'finished', finished_at: '2024-03-01', rating: 8, franchise: 'Ys', favorite: true, replays: 2 },
      { title: 'Ys II', type: 'game', status: 'finished', finished_at: '2025-05-01', rating: 10, franchise: 'Ys' },
      { title: 'Ys III', type: 'game', status: 'ongoing', started_at: day(-100), franchise: 'Ys' },
      { title: 'Frieren', type: 'anime', status: 'finished', finished_at: '2025-07-01', rating: 7, favorite: true, replays: 1 },
      { title: 'Dandadan', type: 'anime', status: 'ongoing', started_at: day(-10) },
      { title: 'Vagabond', type: 'manga', status: 'on_hold', franchise: 'Vagabond' },
    ])
    let html = await stats()
    let section = (name: string) => html.split(`<h2>${name}</h2>`)[1]?.split('</section>')[0] ?? ''
    let names = (part: string) => [...part.matchAll(/<div class="title"><a href="\/items\/\d+">([^<]+)</g)].map((match) => match[1])

    // Tiles: all titles and each type, then each status, favorites and replays.
    for (let [count, label] of [
      [6, 'All titles'],
      [3, 'Games'],
      [1, 'Manga'],
      [0, 'Novels'],
      [2, 'Anime'],
      [0, 'Planned'],
      [2, 'In progress'],
      [1, 'On hold'],
      [3, 'Finished'],
      [2, 'Favorites'],
      [3, 'Replays'],
    ] as const) {
      assert.match(html, new RegExp(`<strong>${count}</strong><span>(<i class="[^"]+"></i>)?${label}</span>`), label)
    }
    // Finished per year, newest first, each bar a share of the busiest year.
    let years = section('Finished per year')
    assert.match(years, /<span class="pill">3 titles<\/span>/)
    assert.deepEqual(
      [...years.matchAll(/<span>(\d{4})<\/span><i style="width: (\d+)%;"><\/i><b>(\d+)<\/b>/g)].map((match) => match.slice(1).join(' ')),
      ['2025 100 2', '2024 50 1'],
    )
    // Average rating overall and per type, out of 10.
    let ratings = section('Average rating')
    assert.match(ratings, /★ 8\.3 overall/)
    assert.deepEqual(
      [...ratings.matchAll(/<span>(\w+) <small>\((\d+)\)<\/small><\/span><i style="width: (\d+)%;"><\/i><b>([\d.]+)<\/b>/g)].map((match) =>
        match.slice(1).join(' '),
      ),
      ['Games 2 90 9.0', 'Anime 1 70 7.0'],
    )
    // The best rated first; the longest in progress first, by days since the start.
    assert.deepEqual(names(section('Top rated')), ['Ys II', 'Ys I', 'Frieren'])
    let running = section('Longest running')
    assert.deepEqual(names(running), ['Ys III', 'Dandadan'])
    assert.match(running, /<strong>100 days<\/strong> · since/)
    assert.match(running, /<strong>10 days<\/strong> · since/)
    // Franchises with the most titles first, each with its finished share.
    assert.deepEqual(
      [...section('Franchises').matchAll(/">([^<]+)<\/a><progress value="(\d+)" max="(\d+)"/g)].map((match) => match.slice(1).join(' ')),
      ['Ys 2 3', 'Vagabond 0 1'],
    )
  })

  it('picks a title to do next', async () => {
    await load([
      { title: 'Done game', type: 'game', status: 'finished' },
      { title: 'Busy game', type: 'game', status: 'ongoing' },
      { title: 'Planned anime', type: 'anime', status: 'planned' },
      { title: 'Paused anime', type: 'anime', status: 'on_hold' },
      { title: 'Dropped anime', type: 'anime', status: 'dropped' },
      { title: 'Done manga', type: 'manga', status: 'finished' },
    ])
    // The title of the edit page a pick goes to.
    let pick = async (query: string) => {
      let picked = await get(routes.random.href() + query, cookie)
      let edit = await (await get(picked.headers.get('Location') ?? '', cookie)).text()
      return /<h1>([^<]+)<\/h1>/.exec(edit)?.[1] ?? ''
    }

    // The list offers it, for the type shown.
    let anime = await (await get(routes.home.href() + '?type=anime', cookie)).text()
    assert.match(anime, /<a href="\/random\?type=anime" class="button">Pick for me<\/a>/)
    // Planned or on hold first, of the type asked for if any; other filters do not count.
    for (let i = 0; i < 10; i++) {
      assert.ok(['Planned anime', 'Paused anime'].includes(await pick('?type=anime&status=finished')))
      assert.ok(['Planned anime', 'Paused anime'].includes(await pick('')))
    }
    // With none of those, anything not finished.
    assert.equal(await pick('?type=game'), 'Busy game')
    // Nothing left: back on the same list, saying so.
    let none = await get(routes.random.href() + '?type=manga&q=x', cookie)
    assert.equal(none.headers.get('Location'), '/?type=manga&q=x')
    let list = await (await get('/?type=manga&q=x', cookieOf(none))).text()
    assert.match(list, /<p role="alert">Nothing left to pick\.<\/p>/)
  })
})
