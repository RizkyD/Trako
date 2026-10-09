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
})
