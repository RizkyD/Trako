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
})
