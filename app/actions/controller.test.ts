import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { router } from '../router.ts'
import { routes } from '../routes.ts'

const origin = 'http://localhost'

function post(path: string, fields: Record<string, string | File>, cookie = '') {
  let hasFile = Object.values(fields).some((value) => value instanceof File)
  let body: FormData | URLSearchParams = new URLSearchParams(fields as Record<string, string>)
  if (hasFile) {
    body = new FormData()
    for (let [key, value] of Object.entries(fields)) body.set(key, value)
  }
  return router.fetch(
    new Request(origin + path, {
      method: 'POST',
      body,
      headers: { Cookie: cookie },
      redirect: 'manual',
    }),
  )
}

function get(path: string, cookie = '') {
  return router.fetch(new Request(origin + path, { headers: { Cookie: cookie } }))
}

function cookieOf(response: Response): string {
  return (response.headers.get('Set-Cookie') ?? '').split(';')[0]
}

describe('tracker', () => {
  it('guards pages, logs in, and tracks items, franchises, and covers', async () => {
    // Not logged in: pages and mutations both bounce to the login page.
    let anonymous = await get(routes.home.href())
    assert.equal(anonymous.status, 302)
    assert.equal(anonymous.headers.get('Location'), routes.login.href())
    let rejected = await post(routes.itemCreate.href(), { title: 'x', type: 'game', status: 'ongoing' })
    assert.equal(rejected.headers.get('Location'), routes.login.href())

    // First submission creates the account; afterwards a wrong password fails.
    let setup = await post(routes.loginSubmit.href(), { username: 'me', password: 'rahasia-123' })
    assert.equal(setup.headers.get('Location'), routes.home.href())
    let wrong = await post(routes.loginSubmit.href(), { username: 'me', password: 'salah-salah' })
    assert.equal(wrong.headers.get('Location'), routes.login.href())
    let login = await post(routes.loginSubmit.href(), { username: 'me', password: 'rahasia-123' })
    let cookie = cookieOf(login)

    // An item without a franchise is accepted and can be marked finished.
    let created = await post(
      routes.itemCreate.href(),
      { title: 'Celeste', type: 'game', status: 'ongoing', franchise: '' },
      cookie,
    )
    assert.equal(created.status, 302)
    let invalid = await post(routes.itemCreate.href(), { title: 'x', type: 'buku', status: 'ongoing' }, cookie)
    assert.equal(invalid.status, 400)

    // A planned item with a note; one step moves it from planned to ongoing.
    await post(
      routes.itemCreate.href(),
      { title: 'Hades', type: 'game', status: 'planned', note: 'nunggu diskon' },
      cookie,
    )
    let planned = await (await get(routes.home.href() + '?status=planned', cookie)).text()
    assert.match(planned, /Hades/)
    assert.match(planned, /nunggu diskon/)
    assert.match(planned, /Start/)
    let editForm = await (await get(routes.itemEdit.href({ id: 2 }), cookie)).text()
    assert.match(editForm, /<textarea[^>]*>nunggu diskon<\/textarea>/)
    await post(routes.itemToggle.href({ id: 2 }), {}, cookie)
    let started = await (await get(routes.home.href() + '?status=ongoing', cookie)).text()
    assert.match(started, /Hades/)

    let toggled = await post(routes.itemToggle.href({ id: 1 }) + '?status=ongoing', {}, cookie)
    assert.equal(toggled.headers.get('Location'), '/?status=ongoing')
    let html = await (await get(routes.home.href(), cookie)).text()
    assert.match(html, /Celeste/)
    // Titles without a franchise stand on their own, with no group heading.
    assert.match(html, /class="group loose"/)
    assert.doesNotMatch(html, /class="group"/)
    assert.match(html, /1 of 2 titles finished/)

    // Search matches titles case-insensitively and keeps the other filters.
    let found = await (await get(routes.home.href() + '?q=hAd', cookie)).text()
    assert.match(found, /href="\/items\/2"/)
    assert.doesNotMatch(found, /href="\/items\/1"/)
    let missed = await (await get(routes.home.href() + '?q=hAd&status=finished', cookie)).text()
    assert.match(missed, /No titles match/)

    // Ratings are optional, 1 to 10.
    let overrated = await post(
      routes.itemCreate.href(),
      { title: 'x', type: 'game', status: 'finished', rating: '11' },
      cookie,
    )
    assert.equal(overrated.status, 400)
    await post(
      routes.itemUpdate.href({ id: 1 }),
      { title: 'Celeste', type: 'game', status: 'finished', rating: '9' },
      cookie,
    )
    let rated = await (await get(routes.home.href(), cookie)).text()
    assert.match(rated, /★ 9/)
    let ratedForm = await (await get(routes.itemEdit.href({ id: 1 }), cookie)).text()
    assert.match(ratedForm, /name="rating"[^>]*value="9"/)

    // Sorting ranks titles in one flat list: by rating, or by finish date.
    await post(
      routes.itemUpdate.href({ id: 2 }),
      { title: 'Hades', type: 'game', status: 'ongoing', rating: '10' },
      cookie,
    )
    let order = (page: string) => page.indexOf('href="/items/2"') - page.indexOf('href="/items/1"')
    let byRating = await (await get(routes.home.href() + '?sort=rating', cookie)).text()
    assert.match(byRating, /Highest rated/)
    assert.ok(order(byRating) < 0, 'the 10 ranks above the 9')
    let lowFirst = await (await get(routes.home.href() + '?sort=rating&dir=asc', cookie)).text()
    assert.match(lowFirst, /Lowest rated/)
    assert.ok(order(lowFirst) > 0, 'ascending puts the 9 above the 10')
    let byDate =await (await get(routes.home.href() + '?sort=finished', cookie)).text()
    assert.ok(order(byDate) > 0, 'the finished title ranks above the unfinished one')

    // Release date (as precise as known), platforms and description show on the
    // card, and titles can be ordered by release.
    let undated = await post(
      routes.itemCreate.href(),
      { title: 'x', type: 'game', status: 'planned', released: '97' },
      cookie,
    )
    assert.equal(undated.status, 400)
    await post(
      routes.itemUpdate.href({ id: 1 }),
      {
        title: 'Celeste',
        type: 'game',
        status: 'finished',
        released: '2018-01-25',
        platforms: 'Windows, Nintendo Switch, PlayStation 4, Xbox One',
        description: 'A platformer about climbing a mountain.',
      },
      cookie,
    )
    await post(
      routes.itemUpdate.href({ id: 2 }),
      { title: 'Hades', type: 'game', status: 'ongoing', released: '2020-09' },
      cookie,
    )
    let dated = await (await get(routes.home.href(), cookie)).text()
    assert.match(dated, /Released 25 Jan 2018/)
    assert.match(dated, /Released Sept? 2020/)
    assert.match(dated, /<span>Nintendo Switch<\/span>/)
    assert.match(dated, /class="more">\+1</)
    assert.match(dated, /A platformer about climbing a mountain\./)
    let oldest = await (await get(routes.home.href() + '?sort=released', cookie)).text()
    assert.match(oldest, /Oldest releases/)
    assert.ok(order(oldest) > 0, '2018 comes before 2020')
    let newest = await (await get(routes.home.href() + '?sort=released&dir=desc', cookie)).text()
    assert.ok(order(newest) < 0, 'descending puts 2020 first')

    // Novels and series are types too.
    for (let type of ['novel', 'series']) {
      let typed = await post(routes.itemCreate.href(), { title: `A ${type}`, type, status: 'planned' }, cookie)
      assert.equal(typed.status, 302)
      let listed = await (await get(routes.home.href() + `?type=${type}`, cookie)).text()
      assert.match(listed, new RegExp(`class="tag ${type}">${type}<`))
      assert.doesNotMatch(listed, /Celeste/)
    }
    for (let id of [3, 4]) await post(routes.itemDelete.href({ id }), {}, cookie)

    // A franchise must exist before an item can pick it; duplicates are refused.
    await post(routes.franchiseCreate.href(), { name: 'Persona' }, cookie)
    await post(routes.franchiseCreate.href(), { name: 'persona' }, cookie)
    let franchisePage = await (await get(routes.franchises.href(), cookie)).text()
    assert.equal(franchisePage.match(/name="name" value="/g)?.length, 1)
    // Deleting a franchise is confirmed in a dialog holding the only delete form.
    assert.match(franchisePage, /popovertarget="confirm-franchise-1"/)
    assert.match(franchisePage, /id="confirm-franchise-1"[^>]*popover[^]*action="\/franchises\/1\/delete"/)
    assert.equal(franchisePage.split('/franchises/1/delete').length, 2)
    let unknown = await post(
      routes.itemCreate.href(),
      { title: 'x', type: 'game', status: 'ongoing', franchise: 'Tidak Ada' },
      cookie,
    )
    assert.equal(unknown.status, 400)

    // An item in that franchise, with an uploaded cover.
    let png = new File([new Uint8Array([137, 80, 78, 71])], 'cover.png', { type: 'image/png' })
    await post(
      routes.itemCreate.href(),
      { title: 'Persona 5', type: 'game', status: 'ongoing', franchise: 'persona', cover: png },
      cookie,
    )
    let withCover = await (await get(routes.home.href() + '?franchise=1', cookie)).text()
    assert.match(withCover, /Persona 5/)
    assert.doesNotMatch(withCover, /Celeste/)
    let coverPath = /src="(\/covers\/[^"]+)"/.exec(withCover)?.[1]
    assert.ok(coverPath)
    let cover = await get(coverPath, cookie)
    assert.equal(cover.headers.get('Content-Type'), 'image/png')
    assert.equal((await cover.arrayBuffer()).byteLength, 4)
    assert.equal((await get(coverPath)).status, 302)
    assert.equal((await get('/covers/..%2Ftracker.db', cookie)).status, 404)

    let script = new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })
    let badCover = await post(
      routes.itemCreate.href(),
      { title: 'y', type: 'game', status: 'ongoing', cover: script },
      cookie,
    )
    assert.equal(badCover.status, 400)
    let huge = new File([new Uint8Array(6 * 1024 * 1024)], 'big.png', { type: 'image/png' })
    let tooBig = await post(
      routes.itemCreate.href(),
      { title: 'z', type: 'game', status: 'ongoing', cover: huge },
      cookie,
    )
    assert.equal(tooBig.status, 400)

    // Deleting the franchise keeps its item, now without a franchise.
    await post(routes.franchiseDelete.href({ id: 1 }), {}, cookie)
    let after = await (await get(routes.home.href(), cookie)).text()
    assert.match(after, /Persona 5/)
    assert.match(after, /1 of 3 titles finished/)

    // Export carries every title with its cover; the account stays out of it.
    assert.equal((await get(routes.export.href())).status, 302)
    let exported = await get(routes.export.href(), cookie)
    assert.match(exported.headers.get('Content-Disposition') ?? '', /attachment; filename="trako-export-/)
    let backup = await exported.text()
    let parsed = JSON.parse(backup)
    assert.equal(parsed.items.length, 3)
    assert.equal(parsed.items.find((item: { title: string }) => item.title === 'Persona 5').cover.data, 'iVBORw==')
    assert.doesNotMatch(backup, /rahasia|password/)

    // Deleting is confirmed in a dialog: the edit page's only delete form sits in it.
    let editPage = await (await get(routes.itemEdit.href({ id: 3 }), cookie)).text()
    assert.match(editPage, /popovertarget="confirm-delete"/)
    assert.match(editPage, /id="confirm-delete"[^>]*popover[^]*action="\/items\/3\/delete"/)
    assert.equal(editPage.split('/items/3/delete').length, 2)

    // Deleting the item removes its cover file too.
    await post(routes.itemDelete.href({ id: 3 }), {}, cookie)
    assert.equal((await get(coverPath, cookie)).status, 404)

    // Importing the backup restores the deleted title and skips the two still there.
    let file = (text: string) => new File([text], 'backup.json', { type: 'application/json' })
    let dataPage = async () => (await get(routes.settings.href(), cookie)).text()
    let merge = await post(routes.import.href(), { file: file(backup) }, cookie)
    cookie = cookieOf(merge) || cookie
    assert.match(await dataPage(), /Imported 1 titles, skipped 2/)
    let restored = await (await get(routes.home.href() + '?q=persona', cookie)).text()
    let restoredCover = /src="(\/covers\/[^"]+)"/.exec(restored)?.[1]
    assert.ok(restoredCover)
    assert.equal((await (await get(restoredCover, cookie)).arrayBuffer()).byteLength, 4)

    // A file that is not an export changes nothing.
    let junk = await post(routes.import.href(), { file: file('{"items": 1}'), replace: 'on' }, cookie)
    cookie = cookieOf(junk) || cookie
    assert.match(await dataPage(), /not a valid Trako export/)
    assert.equal(JSON.parse(await (await get(routes.export.href(), cookie)).text()).items.length, 3)

    // Replacing is confirmed in a dialog whose button submits the import form.
    let importPage = await dataPage()
    assert.match(importPage, /id="confirm-replace"[^>]*popover[^]*<button[^>]*form="import"[^>]*>/)

    // Replace swaps the whole list for the file's contents, franchises included.
    let other = JSON.stringify({
      app: 'trako',
      franchises: ['Zelda'],
      items: [{ title: 'Ocarina of Time', type: 'game', status: 'planned', franchise: 'Zelda' }],
    })
    await post(routes.import.href(), { file: file(other), replace: 'on' }, cookie)
    let replaced = JSON.parse(await (await get(routes.export.href(), cookie)).text())
    assert.deepEqual(replaced.franchises, ['Zelda'])
    assert.deepEqual(replaced.items.map((item: { title: string }) => item.title), ['Ocarina of Time'])
    assert.equal((await get(restoredCover, cookie)).status, 404)

    // Changing the password needs the current one and a matching confirmation.
    let change = async (fields: Record<string, string>) => {
      let response = await post(routes.passwordChange.href(), fields, cookie)
      cookie = cookieOf(response) || cookie
      return dataPage()
    }
    let fresh = { new_password: 'baru-sekali-9', confirm_password: 'baru-sekali-9' }
    assert.match(await change({ current_password: 'salah-salah', ...fresh }), /current password is wrong/)
    assert.match(
      await change({ current_password: 'rahasia-123', ...fresh, confirm_password: 'beda-sekali-9' }),
      /do not match/,
    )
    assert.match(
      await change({ current_password: 'rahasia-123', new_password: 'pendek', confirm_password: 'pendek' }),
      /at least 8 characters/,
    )
    assert.match(await change({ current_password: 'rahasia-123', ...fresh }), /Password changed/)

    // Still signed in; the old password no longer works and the new one does.
    assert.equal((await get(routes.home.href(), cookie)).status, 200)
    let oldLogin = await post(routes.loginSubmit.href(), { username: 'me', password: 'rahasia-123' })
    assert.equal(oldLogin.headers.get('Location'), routes.login.href())
    let newLogin = await post(routes.loginSubmit.href(), { username: 'me', password: 'baru-sekali-9' })
    assert.equal(newLogin.headers.get('Location'), routes.home.href())
    assert.equal((await post(routes.passwordChange.href(), fresh)).headers.get('Location'), routes.login.href())

    // A profile photo shows in the sidebar of every page; removing it deletes the file.
    let photo = async (fields: Record<string, string | File>) => {
      let response = await post(routes.avatarChange.href(), fields, cookie)
      cookie = cookieOf(response) || cookie
      return dataPage()
    }
    assert.doesNotMatch(await dataPage(), /<img[^>]*class="avatar"/)
    let notImage = new File(['x'], 'a.txt', { type: 'text/plain' })
    assert.match(await photo({ avatar: notImage }), /Choose a JPG, PNG, WebP or GIF/)
    assert.match(await photo({ avatar: png }), /Profile photo updated/)
    let withPhoto = await (await get(routes.home.href(), cookie)).text()
    let photoPath = /<img[^>]*src="(\/covers\/[^"]+)"[^>]*class="avatar"/.exec(withPhoto)?.[1]
    assert.ok(photoPath)
    assert.equal((await get(photoPath, cookie)).headers.get('Content-Type'), 'image/png')
    assert.match(await photo({ remove: 'on' }), /Profile photo removed/)
    assert.equal((await get(photoPath, cookie)).status, 404)
    assert.doesNotMatch(await dataPage(), /<img[^>]*class="avatar"/)

    // Changing the username needs the password; afterwards only the new name signs in.
    let rename = async (fields: Record<string, string>) => {
      let response = await post(routes.usernameChange.href(), fields, cookie)
      cookie = cookieOf(response) || cookie
      return dataPage()
    }
    assert.match(await dataPage(), /name="username"[^>]*value="me"/)
    assert.match(await rename({ username: 'aku', current_password: 'salah-salah' }), /password is wrong/)
    assert.match(await rename({ username: '  ', current_password: 'baru-sekali-9' }), /cannot be empty/)
    let renamed = await rename({ username: 'aku', current_password: 'baru-sekali-9' })
    assert.match(renamed, /Username changed to aku/)
    assert.match(renamed, /name="username"[^>]*value="aku"/)
    let oldName = await post(routes.loginSubmit.href(), { username: 'me', password: 'baru-sekali-9' })
    assert.equal(oldName.headers.get('Location'), routes.login.href())
    let newName = await post(routes.loginSubmit.href(), { username: 'aku', password: 'baru-sekali-9' })
    assert.equal(newName.headers.get('Location'), routes.home.href())
  })

  it('tracks statuses, start dates, progress, favorites, replays and tags', async () => {
    // The flow above leaves this account behind; run on its own, this signs it up.
    let cookie = cookieOf(await post(routes.loginSubmit.href(), { username: 'aku', password: 'baru-sekali-9' }))
    let page = async (query: string) => (await get(routes.home.href() + query, cookie)).text()
    let add = (fields: Record<string, string>) =>
      post(routes.itemCreate.href(), { type: 'manga', status: 'planned', ...fields }, cookie)
    // A title's id is in its edit link; `shows` checks that a page lists it.
    let idOf = async (title: string) => /href="\/items\/(\d+)"/.exec(await page(`?q=${title}`))?.[1] ?? ''
    let shows = (html: string, id: string) => html.includes(`href="/items/${id}"`)
    let step = (id: string) => post(routes.itemToggle.href({ id }), {}, cookie)
    let advance = (id: string) => post(routes.itemAdvance.href({ id }), {}, cookie)
    let today = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(
      new Date(),
    )

    // On hold and dropped are statuses like the others: listed, counted and filtered.
    assert.equal((await add({ title: 'Berserk', status: 'on_hold', started_at: '2026-01-03' })).status, 302)
    assert.equal((await add({ title: 'Bleach', status: 'dropped', favorite: 'on' })).status, 302)
    let berserk = await idOf('Berserk')
    let bleach = await idOf('Bleach')
    let onHold = await page('?status=on_hold')
    assert.match(onHold, /<h1>On hold</)
    assert.ok(shows(onHold, berserk) && !shows(onHold, bleach))
    assert.match(onHold, /state on_hold"><\/i>On hold<span>1<\/span>/)
    assert.match(onHold, /state dropped"><\/i>Dropped<span>1<\/span>/)
    assert.match(onHold, />Resume</)
    let editForm = await (await get(routes.itemEdit.href({ id: bleach }), cookie)).text()
    assert.match(editForm, /<option value="dropped" selected/)
    assert.match(editForm, /name="favorite"[^>]*checked/)

    // Resume brings both back in progress; a start date already set stays.
    await step(berserk)
    await step(bleach)
    let resumed = await page('?status=ongoing')
    assert.ok(shows(resumed, berserk) && shows(resumed, bleach))
    assert.match(resumed, /Started 3 Jan 2026/)
    assert.match(resumed, new RegExp(`Started ${today}`))

    // The first start notes the day.
    await add({ title: 'Dandadan', progress: '1', progress_total: '3', progress_unit: 'chapters' })
    let dandadan = await idOf('Dandadan')
    assert.doesNotMatch(await page('?q=Dandadan'), /Started /)
    await step(dandadan)
    assert.match(await page('?q=Dandadan'), new RegExp(`Started ${today}`))

    // +1 counts up to the total and no further, back on the same filtered list.
    let advanced = await post(routes.itemAdvance.href({ id: dandadan }) + '?status=ongoing', {}, cookie)
    assert.equal(advanced.headers.get('Location'), '/?status=ongoing')
    assert.match(await page('?q=Dandadan'), /2 \/ 3 chapters/)
    for (let i = 0; i < 3; i++) await advance(dandadan)
    let full = await page('?q=Dandadan')
    assert.match(full, /3 \/ 3 chapters/)
    assert.match(full, /<progress value="3" max="3"/)
    assert.ok(full.includes(`/items/${dandadan}/advance`))
    // Without a unit there is no +1; Berserk has none.
    assert.doesNotMatch(await page('?q=Berserk'), /\/advance/)

    // Finished titles offer Reopen and Replay, and no +1.
    await step(dandadan)
    let finished = await page('?q=Dandadan')
    assert.doesNotMatch(finished, /\/advance/)
    assert.match(finished, />Reopen</)
    assert.ok(finished.includes(`/items/${dandadan}/replay`))

    // Replay counts the run and starts over from no progress; a second post adds nothing.
    let replayed = await post(routes.itemReplay.href({ id: dandadan }) + '?q=Dandadan', {}, cookie)
    assert.equal(replayed.headers.get('Location'), '/?q=Dandadan')
    await post(routes.itemReplay.href({ id: dandadan }), {}, cookie)
    let again = await page('?status=ongoing&q=Dandadan')
    assert.ok(shows(again, dandadan))
    assert.match(again, /Replayed ×1/)
    assert.match(again, /0 \/ 3 chapters/)
    // Reopen is not a replay.
    for (let i = 0; i < 3; i++) await advance(dandadan)
    await step(dandadan)
    await step(dandadan)
    let reopened = await page('?status=ongoing&q=Dandadan')
    assert.ok(shows(reopened, dandadan))
    assert.match(reopened, /Replayed ×1/)
    assert.match(reopened, /3 \/ 3 chapters/)

    // The heart toggles a favorite; the Favorites filter lists only those.
    let hearted = await post(routes.itemFavorite.href({ id: berserk }) + '?favorite=1', {}, cookie)
    assert.equal(hearted.headers.get('Location'), '/?favorite=1')
    let favorites = await page('?favorite=1')
    assert.match(favorites, /<h1>Favorites</)
    assert.ok(shows(favorites, berserk) && shows(favorites, bleach) && !shows(favorites, dandadan))
    assert.match(favorites, /aria-pressed="true"/)
    await post(routes.itemFavorite.href({ id: bleach }), {}, cookie)
    let fewer = await page('?favorite=1')
    assert.ok(shows(fewer, berserk) && !shows(fewer, bleach))

    // Tags link to the list of titles with that tag (in any case); the form suggests them.
    await post(
      routes.itemUpdate.href({ id: bleach }),
      { title: 'Bleach', type: 'manga', status: 'dropped', tags: 'Shonen, swords' },
      cookie,
    )
    let tagged = await page('?tag=shonen')
    assert.ok(shows(tagged, bleach) && !shows(tagged, berserk))
    assert.match(tagged, /href="\/\?tag=swords">#swords</)
    assert.match(tagged, /#shonen <span aria-hidden="true">×/)
    assert.match(await page(''), /<datalist id="tag-names"><option value="Shonen"/)

    // Invalid values are refused.
    for (let [name, value] of [
      ['status', 'paused'],
      ['progress', '-1'],
      ['progress', '1.5'],
      ['progress_total', '0'],
      ['replays', 'two'],
      ['started_at', '3 Jan 2026'],
    ]) {
      assert.equal((await add({ title: 'x', [name]: value })).status, 400, `${name}=${value}`)
    }

    // Export carries the new fields, and importing the file restores them as they were.
    let backup = await (await get(routes.export.href(), cookie)).text()
    let entry = JSON.parse(backup).items.find((item: { title: string }) => item.title === 'Dandadan')
    assert.equal(entry.started_at, new Date().toLocaleDateString('sv'))
    assert.deepEqual(
      [entry.progress, entry.progress_total, entry.progress_unit, entry.favorite, entry.replays],
      [3, 3, 'chapters', false, 1],
    )
    let file = (text: string) => new File([text], 'backup.json', { type: 'application/json' })
    let load = async (text: string, replace = false) => {
      let response = await post(routes.import.href(), { file: file(text), ...(replace ? { replace: 'on' } : {}) }, cookie)
      cookie = cookieOf(response) || cookie
      return (await get(routes.settings.href(), cookie)).text()
    }
    assert.match(await load(backup, true), /Imported \d+ titles/)
    let restored = await (await get(routes.export.href(), cookie)).text()
    assert.deepEqual(JSON.parse(restored).items, JSON.parse(backup).items)

    // Files from before these fields still import, with the defaults; bad values are refused.
    let old = { title: 'Akira', type: 'film', status: 'finished', finished_at: '2020-01-01' }
    assert.match(await load(JSON.stringify({ app: 'trako', items: [old] })), /Imported 1 titles/)
    let akira = JSON.parse(await (await get(routes.export.href(), cookie)).text()).items.find(
      (item: { title: string }) => item.title === 'Akira',
    )
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
      assert.match(await load(text), /not a valid Trako export/, JSON.stringify(bad))
    }
  })

  it('browses upcoming releases, a timeline, wider search, platform and rating filters', async () => {
    // As above: the account the first flow leaves behind, or a new one when run alone.
    let cookie = cookieOf(await post(routes.loginSubmit.href(), { username: 'aku', password: 'baru-sekali-9' }))
    let page = async (query: string) => (await get(routes.home.href() + query, cookie)).text()
    // The titles a page lists, each once (an upcoming title is listed twice).
    let titles = async (query: string) => [
      ...new Set([...(await page(query)).matchAll(/<div class="title"><a href="\/items\/\d+">([^<]+)</g)].map((match) => match[1])),
    ]
    let add = (fields: Record<string, string>) =>
      post(routes.itemCreate.href(), { type: 'game', status: 'planned', franchise: 'Trails', ...fields }, cookie)
    // A day relative to today, in local time, as dates are stored.
    let day = (offset: number) => {
      let date = new Date()
      date.setDate(date.getDate() + offset)
      return date.toLocaleDateString('sv')
    }
    let later = String(new Date().getFullYear() + 2)

    for (let name of ['Trails', 'Ys', 'Xanadu']) await post(routes.franchiseCreate.href(), { name }, cookie)
    await add({
      title: 'Trails in the Sky',
      status: 'finished',
      released: '2004-06-24',
      rating: '9',
      platforms: 'Windows, PSP',
      tags: 'JRPG, falcom',
      description: 'Estelle and Joshua **travel** the land.',
    })
    await add({
      title: 'Trails of Cold Steel',
      released: '2013-09',
      rating: '7',
      platforms: 'PlayStation 3, Vita',
      note: 'Rean becomes a *teacher* later.',
    })
    await add({ title: 'Trails beyond the Horizon', released: day(10), platforms: 'PlayStation 5, Windows' })
    await add({ title: 'Trails to Come', released: later })
    await add({ title: 'Trails of Today', released: day(0) })
    await add({ title: 'Trails of This Month', released: day(0).slice(0, 7) })
    await add({ title: 'Trails in Motion', type: 'anime', status: 'ongoing' })

    // Titles still to come out are listed first, soonest first, with how long is left.
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

    // Franchise panels collapse: served open, as <details>. Several types get a heading each.
    assert.match(trails, /<details open data-franchise="\d+" class="group"><summary><h2>Trails<\/h2>/)
    assert.match(trails, /<h3 class="kind"><i class="swatch game"><\/i>Games <span>6<\/span><\/h3>/)
    assert.ok(trails.indexOf('>Games <span>') < trails.indexOf('>Anime <span>1</span>'))
    assert.doesNotMatch(await page('?q=Trails&type=game'), /class="kind"/)
    // Collapse all / Expand all come with three panels or more.
    assert.doesNotMatch(trails, /data-panels/)
    await add({ title: 'Ys Origin', franchise: 'Ys', tags: 'falcom' })
    await add({ title: 'Xanadu Next', franchise: 'Xanadu', tags: 'falcom' })
    assert.match(await page('?tag=falcom'), /data-panels="collapse"[^]*data-panels="expand"/)

    // The timeline: a row per release year in either direction, undated titles last.
    // The sort is ignored (and not offered), and so are upcoming and franchise panels.
    let years = (html: string) => [...html.matchAll(/<div class="year"><h2>(\w+)<\/h2>/g)].map((match) => match[1])
    let dated = [...new Set(['2004', '2013', day(0).slice(0, 4), day(10).slice(0, 4), later])].sort()
    let timeline = await page('?q=Trails&view=timeline')
    assert.deepEqual(years(timeline), [...dated, 'Unknown'])
    assert.deepEqual(years(await page('?q=Trails&view=timeline&sort=rating')), [...dated, 'Unknown'])
    assert.deepEqual(years(await page('?q=Trails&view=timeline&sort=rating&dir=desc')), [...dated.reverse(), 'Unknown'])
    assert.doesNotMatch(timeline, /aria-label="Sort by"|class="group upcoming"|<details/)
    let rows = Object.fromEntries(timeline.split('<div class="year"><h2>').slice(1).map((row) => [row.slice(0, row.indexOf('<')), row]))
    assert.match(rows['2004'], /Trails in the Sky/)
    assert.doesNotMatch(rows['2004'], /Cold Steel/)
    assert.match(rows['2013'], /Trails of Cold Steel<\/a><small><span class="tag game">game<\/span>Trails</)
    assert.match(rows.Unknown, /Trails in Motion/)
    assert.deepEqual(years(await page('?q=Trails&view=timeline&type=anime')), ['Unknown'])

    // Search also looks through descriptions, notes, platforms and tags.
    assert.deepEqual(await titles('?q=TRAVEL'), ['Trails in the Sky'])
    assert.deepEqual(await titles('?q=teacher'), ['Trails of Cold Steel'])
    assert.deepEqual(await titles('?q=vita'), ['Trails of Cold Steel'])
    assert.deepEqual(await titles('?q=jrpg'), ['Trails in the Sky'])

    // The platform filter takes a whole name in any case, offered from every
    // platform in the list, and works along with the other filters.
    assert.deepEqual((await titles('?platform=windows')).sort(), ['Trails beyond the Horizon', 'Trails in the Sky'])
    assert.deepEqual(await titles('?platform=PlayStation'), [])
    assert.deepEqual(await titles('?platform=windows&status=finished'), ['Trails in the Sky'])
    assert.deepEqual(await titles('?platform=windows&type=anime'), [])
    let windows = await page('?platform=windows')
    assert.match(windows, /<option value="Vita">Vita<\/option>/)
    assert.match(windows, /<option value="Windows" selected>Windows<\/option>/)

    // The rating filter keeps titles rated at least that; other values filter nothing.
    assert.deepEqual(await titles('?q=Trails&rating=8'), ['Trails in the Sky'])
    assert.deepEqual((await titles('?q=Trails&rating=7')).sort(), ['Trails in the Sky', 'Trails of Cold Steel'])
    assert.deepEqual(await titles('?rating=7&status=planned&type=game'), ['Trails of Cold Steel'])
    assert.deepEqual(await titles('?rating=7&type=anime'), [])
    assert.deepEqual(await titles('?q=Trails&rating=11'), await titles('?q=Trails'))

    // Both show as removable chips, and the forms and buttons carry them along.
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

    // Descriptions and notes are formatted, and anything else in them is escaped.
    await add({
      title: 'Formatting check',
      franchise: '',
      description: '**Bold** <script>alert(1)</script> [site](https://example.com/?a=1&b=2) [bad](javascript:alert(1))',
      note: 'line one\nline two\n\n- item',
    })
    let formatted = await page('?q=formatting')
    assert.match(
      formatted,
      /<div class="description"><p><strong>Bold<\/strong> &lt;script&gt;alert\(1\)&lt;\/script&gt; <a href="https:\/\/example\.com\/\?a=1&amp;b=2" target="_blank" rel="noopener">site<\/a> \[bad\]\(javascript:alert\(1\)\)<\/p><\/div>/,
    )
    assert.match(formatted, /<div class="note"><p>line one<br>line two<\/p><ul><li>item<\/li><\/ul><\/div>/)
    assert.doesNotMatch(formatted, /<script>alert|href="javascript:/)
    // The edit page shows them formatted too; the fields keep the text as written.
    let id = /href="\/items\/(\d+)"/.exec(formatted)?.[1] ?? ''
    let editPage = await (await get(routes.itemEdit.href({ id }), cookie)).text()
    assert.match(editPage, /<div class="description"><p><strong>Bold<\/strong>/)
    assert.match(editPage, /<textarea name="description"[^>]*>\*\*Bold\*\* &lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    assert.match(editPage, /<textarea name="note"[^>]*>line one\nline two\n\n- item<\/textarea>/)
  })

  it('changes, moves, tags, favorites and deletes ticked titles in bulk', async () => {
    // As above: the account the first flow leaves behind, or a new one when run alone.
    let cookie = cookieOf(await post(routes.loginSubmit.href(), { username: 'aku', password: 'baru-sekali-9' }))
    let page = async (query: string) => (await get(routes.home.href() + query, cookie)).text()
    let file = (text: string) => new File([text], 'backup.json', { type: 'application/json' })
    // A known list to start from; Mushishi comes with a cover.
    let items = [
      { title: 'Monster', type: 'manga', status: 'planned' },
      { title: 'Pluto', type: 'manga', status: 'ongoing', started_at: '2026-01-02', tags: 'Urasawa' },
      { title: 'Akira', type: 'film', status: 'finished', finished_at: '2020-01-01' },
      { title: 'Mushishi', type: 'anime', status: 'on_hold', franchise: 'Mushishi', cover: { extension: 'png', data: 'iVBORw==' } },
    ]
    await post(routes.import.href(), { file: file(JSON.stringify({ app: 'trako', items })), replace: 'on' }, cookie)
    let idOf = async (title: string) => /href="\/items\/(\d+)"/.exec(await page(`?q=${title}`))?.[1] ?? ''
    let [monster, pluto, akira, mushishi] = await Promise.all(items.map((item) => idOf(item.title)))
    // Every title as the export has it, by title.
    let titles = async () =>
      Object.fromEntries(
        JSON.parse(await (await get(routes.export.href(), cookie)).text()).items.map(
          (item: { title: string }) => [item.title, item],
        ),
      )
    // The form sends one `id` per ticked title, so its fields are pairs.
    let bulk = async (query: string, fields: string[][]) => {
      let response = await router.fetch(
        new Request(origin + routes.itemsBulk.href() + query, {
          method: 'POST',
          body: new URLSearchParams(fields),
          headers: { Cookie: cookie },
          redirect: 'manual',
        }),
      )
      cookie = cookieOf(response) || cookie
      return response
    }
    let ticked = (...ids: string[]) => ids.map((id) => ['id', id])
    let today = new Date().toLocaleDateString('sv')

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

    // Finishing notes the day, unless there is one; back on the same list, saying so.
    let finished = await bulk('?type=manga&select=1', [
      ['action', 'status'],
      ['status', 'finished'],
      ...ticked(monster, pluto, akira),
    ])
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

    // Ids of titles that do not exist are skipped; with none left, nothing happens.
    await bulk('', [['action', 'favorite'], ...ticked(monster, '9999', 'x', akira)])
    assert.match(await page(''), /Updated 2 titles\./)
    list = await titles()
    assert.deepEqual([list.Monster.favorite, list.Akira.favorite, list.Pluto.favorite], [true, true, false])
    let nothing = await bulk('?q=x', [['action', 'delete'], ...ticked('9999')])
    assert.equal(nothing.headers.get('Location'), '/?q=x')
    assert.match(await page(''), /<p role="alert">Select at least one title first\.<\/p>/)
    assert.equal(Object.keys(await titles()).length, 4)
    await bulk('', [['action', 'unfavorite'], ...ticked(monster)])
    assert.equal((await titles()).Monster.favorite, false)

    // Moving picks a franchise by id; the empty choice takes titles out of theirs.
    let franchise = /<option value="(\d+)">Mushishi<\/option>/.exec(await page('?select=1'))?.[1] ?? ''
    await bulk('', [['action', 'move'], ['franchise', franchise], ...ticked(monster, pluto)])
    await bulk('', [['action', 'move'], ['franchise', ''], ...ticked(pluto, mushishi)])
    list = await titles()
    assert.deepEqual([list.Monster.franchise, list.Pluto.franchise, list.Mushishi.franchise], ['Mushishi', null, null])
    assert.equal((await bulk('', [['action', 'move'], ['franchise', '999'], ...ticked(pluto)])).status, 400)

    // A tag goes to the titles that lack it, in any case; an empty one is refused.
    await bulk('', [['action', 'tag'], ['tag', ' urasawa '], ...ticked(monster, pluto)])
    await bulk('', [['action', 'tag'], ['tag', 'seinen'], ...ticked(monster, pluto)])
    list = await titles()
    assert.deepEqual([list.Monster.tags, list.Pluto.tags], ['urasawa, seinen', 'Urasawa, seinen'])
    await bulk('', [['action', 'tag'], ['tag', ' '], ...ticked(monster)])
    assert.match(await page(''), /Type the tag to add first\./)
    assert.equal((await titles()).Monster.tags, 'urasawa, seinen')

    // Deleting takes the covers along.
    let coverPath = /src="(\/covers\/[^"]+)"/.exec(await page('?q=Mushishi'))?.[1] ?? ''
    assert.equal((await get(coverPath, cookie)).status, 200)
    await bulk('', [['action', 'delete'], ...ticked(mushishi, akira)])
    assert.match(await page(''), /Deleted 2 titles\./)
    assert.deepEqual(Object.keys(await titles()).sort(), ['Monster', 'Pluto'])
    assert.equal((await get(coverPath, cookie)).status, 404)

    // Anything else is refused.
    assert.equal((await bulk('', [['action', 'explode'], ...ticked(monster)])).status, 400)
    assert.equal((await bulk('', [['action', 'status'], ['status', 'paused'], ...ticked(monster)])).status, 400)
  })

  it('counts the list up on the stats page', async () => {
    // As above: the account the first flow leaves behind, or a new one when run alone.
    let cookie = cookieOf(await post(routes.loginSubmit.href(), { username: 'aku', password: 'baru-sekali-9' }))
    let load = (items: object[]) => {
      let file = new File([JSON.stringify({ app: 'trako', items })], 'backup.json', { type: 'application/json' })
      return post(routes.import.href(), { file, replace: 'on' }, cookie)
    }
    let stats = async () => (await get(routes.stats.href(), cookie)).text()
    // A day relative to today, in local time, as dates are stored.
    let day = (offset: number) => {
      let date = new Date()
      date.setDate(date.getDate() + offset)
      return date.toLocaleDateString('sv')
    }

    await load([])
    let empty = await stats()
    assert.match(empty, /<a href="\/stats" aria-current="page">Stats<\/a>/)
    assert.match(empty, /Nothing to count yet/)
    await load([{ title: 'Solo', type: 'novel', status: 'planned' }])
    let bare = await stats()
    for (let text of ['No finished titles yet', 'No ratings yet', 'Nothing in progress with a start date', 'No titles in a franchise yet']) {
      assert.match(bare, new RegExp(text))
    }

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
    // As above: the account the first flow leaves behind, or a new one when run alone.
    let cookie = cookieOf(await post(routes.loginSubmit.href(), { username: 'aku', password: 'baru-sekali-9' }))
    let items = [
      { title: 'Done game', type: 'game', status: 'finished' },
      { title: 'Busy game', type: 'game', status: 'ongoing' },
      { title: 'Planned anime', type: 'anime', status: 'planned' },
      { title: 'Paused anime', type: 'anime', status: 'on_hold' },
      { title: 'Dropped anime', type: 'anime', status: 'dropped' },
      { title: 'Done manga', type: 'manga', status: 'finished' },
    ]
    let file = new File([JSON.stringify({ app: 'trako', items })], 'backup.json', { type: 'application/json' })
    await post(routes.import.href(), { file, replace: 'on' }, cookie)
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

  it('looks titles up and downloads the covers picked, from allowed hosts only', async (t) => {
    // As above: the account the first flow leaves behind, or a new one when run alone.
    let cookie = cookieOf(await post(routes.loginSubmit.href(), { username: 'aku', password: 'baru-sekali-9' }))
    let send = async (path: string, fields: Record<string, string | File>) => {
      let response = await post(path, fields, cookie)
      cookie = cookieOf(response) || cookie
      return response
    }
    let backup = (items: object[]) => new File([JSON.stringify({ app: 'trako', items })], 'b.json')
    await send(routes.import.href(), { file: backup([]), replace: 'on' })
    let exported = async (): Promise<{ title: string; cover: { extension: string; data: string } | null }[]> =>
      JSON.parse(await (await get(routes.export.href(), cookie)).text()).items
    let coverOf = async (title: string) => (await exported()).find((item) => item.title === title)?.cover ?? null

    // Every request to the outside comes here instead: nothing reaches the network.
    let requested: string[] = []
    let png = () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } })
    let replies: Record<string, () => Response> = {
      'https://upload.wikimedia.org/cover.png': png,
      'https://s4.anilist.co/moved.png': () =>
        new Response(null, { status: 302, headers: { Location: 'https://upload.wikimedia.org/cover.png' } }),
      'https://s4.anilist.co/away.png': () =>
        new Response(null, { status: 302, headers: { Location: 'https://evil.example/cover.png' } }),
      'https://upload.wikimedia.org/page.png': () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }),
      // Over 5 MB, as its length says, or only as it streams in.
      'https://upload.wikimedia.org/big.png': () =>
        new Response(new Uint8Array(1), {
          headers: { 'Content-Type': 'image/png', 'Content-Length': String(6 * 1024 * 1024) },
        }),
      'https://upload.wikimedia.org/endless.png': () => {
        let body = new ReadableStream({
          pull(controller) {
            if (streamed++ < 100) controller.enqueue(new Uint8Array(1024 * 1024))
            else controller.close()
          },
        })
        return new Response(body, { headers: { 'Content-Type': 'image/png' } })
      },
    }
    // Megabytes of that last one handed out.
    let streamed = 0
    let wikipedia = () =>
      Response.json({
        query: {
          pages: [
            {
              title: 'Celeste (video game)',
              index: 1,
              extract: 'Celeste is a 2018 platform video game.',
              thumbnail: { source: 'https://thumb.wikimedia.org/celeste.png' },
              revisions: [{ slots: { main: { content: '{{Infobox video game\n| released = 2018\n| platforms = [[Windows]], [[Linux]]\n}}' } } }],
            },
          ],
        },
      })
    t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
      let url = String(input)
      requested.push(url)
      if (url.startsWith('https://en.wikipedia.org/w/api.php?')) return wikipedia()
      return replies[url]?.() ?? new Response('Not Found', { status: 404 })
    })

    // The lookup answers signed-in requests with the matches as JSON.
    assert.equal((await get(routes.lookupTitle.href() + '?q=Celeste&type=game')).headers.get('Location'), routes.login.href())
    assert.equal((await get(routes.lookupTitle.href() + '?q=%20&type=game', cookie)).status, 400)
    assert.equal((await get(routes.lookupTitle.href() + '?q=Celeste&type=book', cookie)).status, 400)
    let found = await get(routes.lookupTitle.href() + '?q=Celeste&type=game', cookie)
    assert.match(found.headers.get('Content-Type') ?? '', /^application\/json/)
    assert.deepEqual(await found.json(), [
      {
        source: 'wikipedia',
        title: 'Celeste (video game)',
        released: '2018',
        platforms: 'Windows, Linux',
        description: 'Celeste is a 2018 platform video game.',
        cover_url: 'https://thumb.wikimedia.org/celeste.png',
        progress_total: null,
        progress_unit: null,
        tags: null,
      },
    ])
    wikipedia = () => new Response('Too many requests', { status: 429 })
    let failed = await get(routes.lookupTitle.href() + '?q=Celeste&type=game', cookie)
    assert.equal(failed.status, 502)
    assert.deepEqual(await failed.json(), { error: 'Lookup failed' })

    // The add form's title field knows the lookup's address; its button needs
    // JavaScript, so the page as served has none.
    let addForm = await (await get(routes.home.href(), cookie)).text()
    assert.match(addForm, /"href":"\/lookup"/)
    assert.match(addForm, /<input id="title" name="title"[^>]*required/)
    assert.doesNotMatch(addForm, /Fetch details/)

    // A picked cover is downloaded when the title is saved, redirects included.
    let add = (title: string, coverUrl: string) =>
      send(routes.itemCreate.href(), { title, type: 'game', status: 'planned', cover_url: coverUrl })
    assert.equal((await add('Celeste', 'https://upload.wikimedia.org/cover.png')).status, 302)
    let stored = await coverOf('Celeste')
    assert.deepEqual(stored, { extension: 'png', data: 'iVBORw==' })
    await add('Moved', 'https://s4.anilist.co/moved.png')
    assert.deepEqual(await coverOf('Moved'), stored)

    // Anything else saves the title without a cover, and says so.
    for (let [title, coverUrl] of [
      ['Elsewhere', 'https://evil.example/cover.png'],
      ['Plain http', 'http://upload.wikimedia.org/cover.png'],
      ['Local', 'https://localhost/cover.png'],
      ['Redirected away', 'https://s4.anilist.co/away.png'],
      ['Not an image', 'https://upload.wikimedia.org/page.png'],
      ['Said too big', 'https://upload.wikimedia.org/big.png'],
      ['Too big', 'https://upload.wikimedia.org/endless.png'],
      ['Missing', 'https://upload.wikimedia.org/missing.png'],
      ['Not a URL', 'cover.png'],
    ]) {
      assert.equal((await add(title, coverUrl)).status, 302, title)
      assert.equal(await coverOf(title), null, title)
      assert.match(await (await get(routes.home.href(), cookie)).text(), /Saved, but the cover could not be fetched\./, title)
    }
    // Reading stopped soon after the size limit, not at the end of the 100 MB.
    assert.ok(streamed <= 8, `read ${streamed} MB`)
    // Hosts off the list are never contacted, not even through a redirect.
    assert.deepEqual(requested.filter((url) => !/^https:\/\/(upload\.wikimedia\.org|s4\.anilist\.co|en\.wikipedia\.org)\//.test(url)), [])

    // Editing: a picked cover replaces the current one, but not an uploaded file
    // or a ticked "Remove the current cover".
    let idOf = async (title: string) =>
      /href="\/items\/(\d+)"/.exec(await (await get(routes.home.href() + `?q=${title}`, cookie)).text())?.[1] ?? ''
    let id = await idOf('Elsewhere')
    let edit = (fields: Record<string, string | File>) =>
      send(routes.itemUpdate.href({ id }), { title: 'Elsewhere', type: 'game', status: 'planned', ...fields })
    await edit({ cover_url: 'https://upload.wikimedia.org/cover.png' })
    assert.deepEqual(await coverOf('Elsewhere'), stored)
    let gif = new File([new Uint8Array([71, 73, 70])], 'up.gif', { type: 'image/gif' })
    let before = requested.length
    await edit({ cover: gif, cover_url: 'https://upload.wikimedia.org/cover.png' })
    assert.deepEqual(await coverOf('Elsewhere'), { extension: 'gif', data: 'R0lG' })
    await edit({ remove_cover: 'on', cover_url: 'https://upload.wikimedia.org/cover.png' })
    assert.equal(await coverOf('Elsewhere'), null)
    assert.equal(requested.length, before)
    // Without a picked cover, the current one stays.
    await edit({ cover_url: 'https://upload.wikimedia.org/cover.png' })
    await edit({})
    assert.deepEqual(await coverOf('Elsewhere'), stored)
  })

  it('imports from MyAnimeList, CSV files and Steam', async (t) => {
    // As above: the account the first flow leaves behind, or a new one when run alone.
    let cookie = cookieOf(await post(routes.loginSubmit.href(), { username: 'aku', password: 'baru-sekali-9' }))
    let send = async (path: string, fields: Record<string, string | File>) => {
      let response = await post(path, fields, cookie)
      cookie = cookieOf(response) || cookie
      return (await get(routes.settings.href(), cookie)).text()
    }
    await send(routes.import.href(), {
      file: new File([JSON.stringify({ app: 'trako', items: [] })], 'b.json'),
      replace: 'on',
    })
    let exported = async (): Promise<Record<string, unknown>[]> =>
      JSON.parse(await (await get(routes.export.href(), cookie)).text()).items
    let titles = async () => (await exported()).map((item) => item.title)
    let file = (text: string, name: string) => new File([text], name)

    let settings = await (await get(routes.settings.href(), cookie)).text()
    for (let action of ['/import/mal', '/import/csv', '/import/steam']) assert.match(settings, new RegExp(`action="${action}"`))

    // MyAnimeList: every title goes into the franchise typed, made if need be.
    let mal = `<myanimelist>
      <anime><series_title><![CDATA[Mushishi]]></series_title><series_type>TV</series_type>
        <series_episodes>26</series_episodes><my_watched_episodes>26</my_watched_episodes>
        <my_finish_date>2020-02-02</my_finish_date><my_score>9</my_score><my_status>Completed</my_status></anime>
      <manga><manga_title><![CDATA[Blame!]]></manga_title><manga_chapters>0</manga_chapters>
        <my_read_chapters>12</my_read_chapters><my_score>0</my_score><my_status>Reading</my_status></manga>
      <manga><manga_title><![CDATA[Odd]]></manga_title><my_status>Rereading</my_status></manga>
    </myanimelist>`
    let page = await send(routes.importMal.href(), { file: file(mal, 'animelist.xml'), franchise: 'From MAL' })
    assert.match(page, /<p role="status">Imported 2 titles\.<\/p>/)
    assert.match(page, /<p role="alert">Not imported, as a value is missing or not valid: entry 3\.<\/p>/)
    assert.deepEqual(
      (await exported()).map((item) => [item.title, item.type, item.status, item.franchise, item.rating, item.finished_at, item.progress]),
      [
        ['Blame!', 'manga', 'ongoing', 'From MAL', null, null, 12],
        ['Mushishi', 'anime', 'finished', 'From MAL', 9, '2020-02-02', 26],
      ],
    )
    page = await send(routes.importMal.href(), { file: file(mal, 'animelist.xml') })
    assert.match(page, /Imported 0 titles, skipped 2 already in your list\./)
    page = await send(routes.importMal.href(), { file: file('{"app": "trako"}', 'x.json') })
    assert.match(page, /That is not a MyAnimeList export file\. Nothing was changed\./)

    // CSV: a row's own franchise and type beat the form's; bad rows are named.
    let csv = 'title,type,franchise,rating\r\nHades,,,10\r\n"Ys I, Chronicles",,Ys,\r\nSecret,,,12\r\n'
    page = await send(routes.importCsv.href(), { file: file(csv, 'list.csv'), type: 'game', franchise: 'Indie' })
    assert.match(page, /Imported 2 titles\./)
    assert.match(page, /Not imported, as a value is missing or not valid: row 4\./)
    let rows = (await exported()).filter((item) => item.type === 'game')
    assert.deepEqual(rows.map((item) => [item.title, item.franchise, item.rating, item.status]), [
      ['Hades', 'Indie', 10, 'planned'],
      ['Ys I, Chronicles', 'Ys', null, 'planned'],
    ])
    page = await send(routes.importCsv.href(), { file: file('name\nHades', 'list.csv'), type: 'game' })
    assert.match(page, /That CSV file has no title column\. Nothing was changed\./)

    // Steam: owned games with their playtime and cover, when the CDN has one.
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
    t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
      let url = String(input)
      requested.push(url)
      if (url.startsWith('https://api.steampowered.com/')) return steam()
      if (url.includes('/504230/')) return new Response(new Uint8Array([255, 216, 255]), { headers: { 'Content-Type': 'image/jpeg' } })
      return new Response('Not Found', { status: 404 })
    })
    page = await send(routes.importSteam.href(), { key: 'KEY123', steam_id: '76561197960287930', franchise: '' })
    assert.match(page, /Imported 2 titles, skipped 1 already in your list\./)
    assert.match(new URL(requested[0]).search, /key=KEY123&steamid=76561197960287930/)
    // Hades was in the list already, so its cover was not even asked for.
    assert.deepEqual(requested.slice(1), [
      'https://cdn.cloudflare.steamstatic.com/steam/apps/504230/library_600x900.jpg',
      'https://cdn.cloudflare.steamstatic.com/steam/apps/7/library_600x900.jpg',
    ])
    let games = Object.fromEntries((await exported()).map((item) => [item.title, item]))
    assert.deepEqual(
      [games.Celeste.status, games.Celeste.progress, games.Celeste.progress_unit, games.Celeste.platforms, games.Celeste.cover],
      ['ongoing', 10, 'hours', 'Steam', { extension: 'jpg', data: '/9j/' }],
    )
    assert.deepEqual([games.Unboxed.status, games.Unboxed.cover], ['planned', null])
    assert.doesNotMatch(await (await get(routes.settings.href(), cookie)).text(), /KEY123/)
    steam = () => Response.json({ response: {} })
    page = await send(routes.importSteam.href(), { key: 'KEY123', steam_id: '76561197960287930' })
    assert.match(page, /Steam returned no games\. Check the key and the SteamID/)
    assert.deepEqual((await titles()).length, 6)
  })
})
