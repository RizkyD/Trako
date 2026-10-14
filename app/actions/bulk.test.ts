import * as assert from 'remix/assert'
import { beforeEach, describe, it } from 'remix/test'

import { routes } from '../routes.ts'
import { cookieOf, exported, get, post, reset, signIn } from '../test-helpers.ts'

// A known list to start from; Mushishi comes with a cover.
const ITEMS = [
  { title: 'Monster', type: 'manga', status: 'planned' },
  { title: 'Pluto', type: 'manga', status: 'ongoing', started_at: '2026-01-02', tags: 'Urasawa' },
  { title: 'Akira', type: 'film', status: 'finished', finished_at: '2020-01-01' },
  { title: 'Mushishi', type: 'anime', status: 'on_hold', franchise: 'Mushishi', cover: { extension: 'png', data: 'iVBORw==' } },
]

describe('bulk', () => {
  let cookie = ''
  let [monster, pluto, akira, mushishi] = ['', '', '', '']
  let page = async (query: string) => (await get(routes.home.href() + query, cookie)).text()
  let idOf = async (title: string) => /href="\/items\/(\d+)"/.exec(await page(`?q=${title}`))?.[1] ?? ''
  beforeEach(async () => {
    reset()
    cookie = await signIn()
    let file = new File([JSON.stringify({ app: 'trako', items: ITEMS })], 'backup.json', { type: 'application/json' })
    await post(routes.import.href(), { file }, cookie)
    ;[monster, pluto, akira, mushishi] = await Promise.all(ITEMS.map((item) => idOf(item.title)))
  })
  // Every title as the export has it, by title.
  let titles = async () => Object.fromEntries((await exported(cookie)).map((item) => [item.title, item]))
  // The form sends one `id` per ticked title, so its fields are pairs. The list
  // it goes back to says what was done, so the session is kept.
  let bulk = async (query: string, fields: string[][]) => {
    let response = await post(routes.itemsBulk.href() + query, fields, cookie)
    cookie = cookieOf(response) || cookie
    return response
  }
  let ticked = (...ids: string[]) => ids.map((id) => ['id', id])
  let today = new Date().toLocaleDateString('sv')

  it('ticks titles in a form of its own, which confirms deleting', async () => {
    // Selection mode is a link away. It wraps the list in one form, a tick box
    // per title and no buttons of their own; the timeline has none of it.
    assert.match(await page('?type=manga'), /<a href="\/\?type=manga&amp;select=1" class="button">Select<\/a>/)
    let selecting = await page('?type=manga&select=1')
    let form = /<form id="bulk" method="post" action="\/items\/bulk\?type=manga&amp;select=1".*?<\/form>/s.exec(selecting)?.[0] ?? ''
    assert.equal(form.match(/<input type="checkbox" name="id"/g)?.length, 2)
    assert.ok(form.includes(`value="${monster}"`) && form.includes(`value="${pluto}"`))
    assert.doesNotMatch(selecting, /\/toggle/)
    assert.match(form, /<a href="\/\?type=manga&amp;select=all" data-select="all">Select all shown<\/a>/)
    assert.equal((await page('?type=manga&select=all')).match(/name="id" value="\d+" checked/g)?.length, 2)
    assert.doesNotMatch(await page('?view=timeline&select=1'), /name="id"/)
    // Deleting asks first, in a dialog whose button submits the form.
    assert.match(form, /id="confirm-bulk-delete" popover[^]*<button type="submit" name="action" value="delete"/)
    assert.match(form, /popovertarget="confirm-bulk-delete"[^>]*>Delete…/)
    assert.match(form, /<h2>Delete the selected titles\?<\/h2>/)
    assert.match(form, /popovertarget="confirm-bulk-delete" popovertargetaction="hide"[^>]*>Cancel</)
  })

  it('sets the status, noting the start and finish days', async () => {
    // Finishing notes the day, unless there is one; back on the same list, saying so.
    let finished = await bulk('?type=manga&select=1', [['action', 'status'], ['status', 'finished'], ...ticked(monster, pluto, akira)])
    assert.equal(finished.headers.get('Location'), '/?type=manga&select=1')
    assert.match(await page('?type=manga&select=1'), /<p role="status">Updated 3 titles\.<\/p>/)
    let list = await titles()
    assert.deepEqual([list.Monster.status, list.Monster.started_at, list.Monster.finished_at], ['finished', null, today])
    assert.deepEqual([list.Pluto.started_at, list.Pluto.finished_at], ['2026-01-02', today])
    assert.equal(list.Akira.finished_at, '2020-01-01')
    // Starting notes the day, unless there is one; a title not finished has no finish date.
    await bulk('', [['action', 'status'], ['status', 'ongoing'], ...ticked(monster, pluto)])
    await bulk('', [['action', 'status'], ['status', 'planned'], ...ticked(akira)])
    list = await titles()
    assert.deepEqual([list.Monster.started_at, list.Monster.finished_at], [today, null])
    assert.deepEqual([list.Pluto.started_at, list.Pluto.finished_at], ['2026-01-02', null])
    assert.deepEqual([list.Akira.status, list.Akira.finished_at], ['planned', null])
  })

  it('favorites and unfavorites, skipping titles that do not exist', async () => {
    // Ids of titles that do not exist are skipped; with none left, nothing happens.
    await bulk('', [['action', 'favorite'], ...ticked(monster, '9999', 'x', akira)])
    assert.match(await page(''), /Updated 2 titles\./)
    let list = await titles()
    assert.deepEqual([list.Monster.favorite, list.Akira.favorite, list.Pluto.favorite], [true, true, false])
    let nothing = await bulk('?q=x', [['action', 'delete'], ...ticked('9999')])
    assert.equal(nothing.headers.get('Location'), '/?q=x')
    assert.match(await page(''), /<p role="alert">Select at least one title first\.<\/p>/)
    assert.equal(Object.keys(await titles()).length, 4)
    await bulk('', [['action', 'unfavorite'], ...ticked(monster)])
    assert.equal((await titles()).Monster.favorite, false)
  })

  it('moves titles into a franchise picked by id, or out of theirs', async () => {
    let franchise = /<option value="(\d+)">Mushishi<\/option>/.exec(await page('?select=1'))?.[1] ?? ''
    await bulk('', [['action', 'move'], ['franchise', franchise], ...ticked(monster, pluto)])
    await bulk('', [['action', 'move'], ['franchise', ''], ...ticked(pluto, mushishi)])
    let list = await titles()
    assert.deepEqual([list.Monster.franchise, list.Pluto.franchise, list.Mushishi.franchise], ['Mushishi', null, null])
    assert.equal((await bulk('', [['action', 'move'], ['franchise', '999'], ...ticked(pluto)])).status, 400)
  })

  it('adds a tag to the titles that lack it, in any case', async () => {
    await bulk('', [['action', 'tag'], ['tag', ' urasawa '], ...ticked(monster, pluto)])
    await bulk('', [['action', 'tag'], ['tag', 'seinen'], ...ticked(monster, pluto)])
    let list = await titles()
    assert.deepEqual([list.Monster.tags, list.Pluto.tags], ['urasawa, seinen', 'Urasawa, seinen'])
    // An empty one is refused.
    await bulk('', [['action', 'tag'], ['tag', ' '], ...ticked(monster)])
    assert.match(await page(''), /Type the tag to add first\./)
    assert.equal((await titles()).Monster.tags, 'urasawa, seinen')
  })

  it('deletes titles along with their covers', async () => {
    let coverPath = /src="(\/covers\/[^"]+)"/.exec(await page('?q=Mushishi'))?.[1] ?? ''
    assert.equal((await get(coverPath, cookie)).status, 200)
    await bulk('', [['action', 'delete'], ...ticked(mushishi, akira)])
    assert.match(await page(''), /Deleted 2 titles\./)
    assert.deepEqual(Object.keys(await titles()).sort(), ['Monster', 'Pluto'])
    assert.equal((await get(coverPath, cookie)).status, 404)
  })

  it('refuses anything else', async () => {
    assert.equal((await bulk('', [['action', 'explode'], ...ticked(monster)])).status, 400)
    assert.equal((await bulk('', [['action', 'status'], ['status', 'paused'], ...ticked(monster)])).status, 400)
  })
})
