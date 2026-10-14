import * as assert from 'remix/assert'
import { beforeEach, describe, it, type TestContext } from 'remix/test'

import { routes } from '../routes.ts'
import { cookieOf, exported, get, post, reset, signIn } from '../test-helpers.ts'

const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'cover.png', { type: 'image/png' })

// Image hosts as cover downloads meet them; every request lands here instead of
// on the network.
function fakeImageHosts(t: TestContext) {
  let requested: string[] = []
  // Megabytes of endless.png handed out.
  let streamed = 0
  let image = () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } })
  let replies: Record<string, () => Response> = {
    'https://upload.wikimedia.org/cover.png': image,
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
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    let url = String(input)
    requested.push(url)
    return replies[url]?.() ?? new Response('Not Found', { status: 404 })
  })
  return { requested, streamed: () => streamed }
}

describe('items', () => {
  let cookie = ''
  beforeEach(async () => {
    reset()
    cookie = await signIn()
  })
  let page = async (query = '') => (await get(routes.home.href() + query, cookie)).text()
  // Posts the add form; the list it goes back to may carry a message, so the
  // session is kept.
  let add = async (fields: Record<string, string | File>) => {
    let response = await post(routes.itemCreate.href(), { type: 'game', status: 'planned', ...fields }, cookie)
    cookie = cookieOf(response) || cookie
    return response
  }
  // A title's id is in its edit link; `shows` checks that a page lists it.
  let idOf = async (title: string) => /href="\/items\/(\d+)"/.exec(await page(`?q=${title}`))?.[1] ?? ''
  let shows = (html: string, id: string) => html.includes(`href="/items/${id}"`)
  let step = (id: string) => post(routes.itemToggle.href({ id }), {}, cookie)
  let advance = (id: string) => post(routes.itemAdvance.href({ id }), {}, cookie)
  let today = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date())
  let coverOf = async (title: string) => (await exported(cookie)).find((item) => item.title === title)?.cover ?? null

  it('adds titles, and refuses invalid ones', async () => {
    // A title without a franchise is fine.
    assert.equal((await add({ title: 'Celeste', status: 'ongoing', franchise: '' })).status, 302)
    for (let [name, value] of [
      ['type', 'buku'],
      ['status', 'paused'],
      // Ratings are optional, 1 to 10.
      ['rating', '11'],
      // Releases are a year, a month or a day.
      ['released', '97'],
      ['progress', '-1'],
      ['progress', '1.5'],
      ['progress_total', '0'],
      ['replays', 'two'],
      ['started_at', '3 Jan 2026'],
    ]) {
      assert.equal((await add({ title: 'x', [name]: value })).status, 400, `${name}=${value}`)
    }
  })

  it('moves titles along one step at a time, back on the same list', async () => {
    await add({ title: 'Celeste', status: 'ongoing', franchise: '' })
    // A planned title with a note; one step moves it from planned to ongoing.
    await add({ title: 'Hades', note: 'nunggu diskon' })
    let planned = await page('?status=planned')
    assert.match(planned, /Hades/)
    assert.match(planned, /nunggu diskon/)
    assert.match(planned, /Start/)
    let editForm = await (await get(routes.itemEdit.href({ id: 2 }), cookie)).text()
    assert.match(editForm, /<textarea[^>]*>nunggu diskon<\/textarea>/)
    await step('2')
    assert.match(await page('?status=ongoing'), /Hades/)

    let toggled = await post(routes.itemToggle.href({ id: 1 }) + '?status=ongoing', {}, cookie)
    assert.equal(toggled.headers.get('Location'), '/?status=ongoing')
    let html = await page()
    assert.match(html, /Celeste/)
    // Titles without a franchise stand on their own, with no group heading.
    assert.match(html, /class="group loose"/)
    assert.doesNotMatch(html, /class="group"/)
    assert.match(html, /1 of 2 titles finished/)
  })

  it('shows the rating on the card and in the form', async () => {
    await add({ title: 'Celeste', status: 'ongoing' })
    await post(routes.itemUpdate.href({ id: 1 }), { title: 'Celeste', type: 'game', status: 'finished', rating: '9' }, cookie)
    assert.match(await page(), /★ 9/)
    let ratedForm = await (await get(routes.itemEdit.href({ id: 1 }), cookie)).text()
    assert.match(ratedForm, /name="rating"[^>]*value="9"/)
  })

  it('shows the release date, as precise as known, platforms and description on the card', async () => {
    await add({ title: 'Celeste' })
    await add({ title: 'Hades' })
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
    await post(routes.itemUpdate.href({ id: 2 }), { title: 'Hades', type: 'game', status: 'ongoing', released: '2020-09' }, cookie)
    let dated = await page()
    assert.match(dated, /Released 25 Jan 2018/)
    assert.match(dated, /Released Sept? 2020/)
    assert.match(dated, /<span>Nintendo Switch<\/span>/)
    assert.match(dated, /class="more">\+1</)
    assert.match(dated, /A platformer about climbing a mountain\./)
  })

  it('formats descriptions and notes, and escapes anything else in them', async () => {
    await add({
      title: 'Formatting check',
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
    let editPage = await (await get(routes.itemEdit.href({ id: await idOf('formatting') }), cookie)).text()
    assert.match(editPage, /<div class="description"><p><strong>Bold<\/strong>/)
    assert.match(editPage, /<textarea name="description"[^>]*>\*\*Bold\*\* &lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    assert.match(editPage, /<textarea name="note"[^>]*>line one\nline two\n\n- item<\/textarea>/)
  })

  it('lists, counts and filters titles on hold or dropped', async () => {
    assert.equal((await add({ title: 'Berserk', type: 'manga', status: 'on_hold', started_at: '2026-01-03' })).status, 302)
    assert.equal((await add({ title: 'Bleach', type: 'manga', status: 'dropped', favorite: 'on' })).status, 302)
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
  })

  it('resumes titles, and notes the day a title is first started', async () => {
    await add({ title: 'Berserk', type: 'manga', status: 'on_hold', started_at: '2026-01-03' })
    await add({ title: 'Bleach', type: 'manga', status: 'dropped' })
    await add({ title: 'Dandadan', type: 'manga' })
    let [berserk, bleach, dandadan] = [await idOf('Berserk'), await idOf('Bleach'), await idOf('Dandadan')]
    // Resume brings both back in progress; a start date already set stays.
    await step(berserk)
    await step(bleach)
    let resumed = await page('?status=ongoing')
    assert.ok(shows(resumed, berserk) && shows(resumed, bleach))
    assert.match(resumed, /Started 3 Jan 2026/)
    assert.match(resumed, new RegExp(`Started ${today}`))

    // The first start notes the day.
    assert.doesNotMatch(await page('?q=Dandadan'), /Started /)
    await step(dandadan)
    assert.match(await page('?q=Dandadan'), new RegExp(`Started ${today}`))
  })

  it('counts progress up to the total, with a +1 only when there is a unit', async () => {
    await add({ title: 'Dandadan', status: 'ongoing', progress: '1', progress_total: '3', progress_unit: 'chapters' })
    await add({ title: 'Berserk', status: 'ongoing' })
    let dandadan = await idOf('Dandadan')
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
  })

  it('offers Reopen and Replay once finished, and counts the replays', async () => {
    await add({ title: 'Dandadan', status: 'ongoing', progress: '3', progress_total: '3', progress_unit: 'chapters' })
    let dandadan = await idOf('Dandadan')
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
  })

  it('toggles favorites, which have a filter of their own', async () => {
    await add({ title: 'Berserk' })
    await add({ title: 'Bleach', favorite: 'on' })
    await add({ title: 'Dandadan' })
    let [berserk, bleach, dandadan] = [await idOf('Berserk'), await idOf('Bleach'), await idOf('Dandadan')]
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
  })

  it('links tags to their list, in any case, and suggests them in the form', async () => {
    await add({ title: 'Berserk', type: 'manga' })
    await add({ title: 'Bleach', type: 'manga', status: 'dropped' })
    let [berserk, bleach] = [await idOf('Berserk'), await idOf('Bleach')]
    await post(
      routes.itemUpdate.href({ id: bleach }),
      { title: 'Bleach', type: 'manga', status: 'dropped', tags: 'Shonen, swords' },
      cookie,
    )
    let tagged = await page('?tag=shonen')
    assert.ok(shows(tagged, bleach) && !shows(tagged, berserk))
    assert.match(tagged, /href="\/\?tag=swords">#swords</)
    assert.match(tagged, /#shonen <span aria-hidden="true">×/)
    assert.match(await page(), /<datalist id="tag-names"><option value="Shonen"/)
  })

  it('stores an uploaded cover, and refuses files that are not pictures or are too big', async () => {
    // The forms' file inputs are plain ones until the browser shrinks pictures
    // (image-input.tsx), so posting the file as is stands for a browser without JavaScript.
    await add({ title: 'Persona 5', cover: png() })
    let html = await page()
    assert.match(html, /<input name="cover" type="file"/)
    let coverPath = /src="(\/covers\/[^"]+)"/.exec(html)?.[1]
    assert.ok(coverPath)
    let cover = await get(coverPath, cookie)
    assert.equal(cover.headers.get('Content-Type'), 'image/png')
    assert.equal((await cover.arrayBuffer()).byteLength, 4)
    // Only for the signed-in account, and only from the covers folder.
    assert.equal((await get(coverPath)).status, 302)
    assert.equal((await get('/covers/..%2Ftracker.db', cookie)).status, 404)

    let script = new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })
    assert.equal((await add({ title: 'y', cover: script })).status, 400)
    let huge = new File([new Uint8Array(6 * 1024 * 1024)], 'big.png', { type: 'image/png' })
    assert.equal((await add({ title: 'z', cover: huge })).status, 400)
  })

  it('confirms deleting in a dialog, and deletes the cover file along', async () => {
    await add({ title: 'Persona 5', cover: png() })
    let coverPath = /src="(\/covers\/[^"]+)"/.exec(await page())?.[1] ?? ''
    assert.equal((await get(coverPath, cookie)).status, 200)
    // The edit page's only delete form sits in the dialog.
    let editPage = await (await get(routes.itemEdit.href({ id: 1 }), cookie)).text()
    assert.match(editPage, /popovertarget="confirm-delete"/)
    assert.match(editPage, /id="confirm-delete"[^>]*popover[^]*action="\/items\/1\/delete"/)
    assert.equal(editPage.split('/items/1/delete').length, 2)
    // It names the title and its cover; Cancel closes it, no script needed.
    assert.match(editPage, /<h2>Delete this title\?<\/h2><p><strong>Persona 5<\/strong> will be removed from your list, along with its cover\./)
    assert.match(editPage, /popovertarget="confirm-delete" popovertargetaction="hide"[^>]*>Cancel</)
    await post(routes.itemDelete.href({ id: 1 }), {}, cookie)
    assert.equal((await get(coverPath, cookie)).status, 404)
  })

  it('looks titles up for the forms, as JSON, when signed in', async (t) => {
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
    // Nothing reaches the network.
    t.mock.method(globalThis, 'fetch', async (input: string | URL) =>
      String(input).startsWith('https://en.wikipedia.org/w/api.php?') ? wikipedia() : new Response('Not Found', { status: 404 }),
    )

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
    let addForm = await page()
    assert.match(addForm, /"href":"\/lookup"/)
    assert.match(addForm, /<input id="title" name="title"[^>]*required/)
    assert.doesNotMatch(addForm, /Fetch details/)
  })

  it('downloads a picked cover when the title is saved, only from known image hosts', async (t) => {
    let network = fakeImageHosts(t)
    let stored = { extension: 'png', data: 'iVBORw==' }
    // Redirects included.
    assert.equal((await add({ title: 'Celeste', cover_url: 'https://upload.wikimedia.org/cover.png' })).status, 302)
    assert.deepEqual(await coverOf('Celeste'), stored)
    await add({ title: 'Moved', cover_url: 'https://s4.anilist.co/moved.png' })
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
      assert.equal((await add({ title, cover_url: coverUrl })).status, 302, title)
      assert.equal(await coverOf(title), null, title)
      assert.match(await page(), /Saved, but the cover could not be fetched\./, title)
    }
    // Reading stopped soon after the size limit, not at the end of the 100 MB.
    assert.ok(network.streamed() <= 8, `read ${network.streamed()} MB`)
    // Hosts off the list are never contacted, not even through a redirect.
    assert.deepEqual(network.requested.filter((url) => !/^https:\/\/(upload\.wikimedia\.org|s4\.anilist\.co)\//.test(url)), [])
  })

  it('takes a picked cover on edit, unless a file is uploaded or the cover removed', async (t) => {
    let network = fakeImageHosts(t)
    let picked = 'https://upload.wikimedia.org/cover.png'
    await add({ title: 'Elsewhere' })
    let id = await idOf('Elsewhere')
    let edit = (fields: Record<string, string | File>) =>
      post(routes.itemUpdate.href({ id }), { title: 'Elsewhere', type: 'game', status: 'planned', ...fields }, cookie)
    let stored = { extension: 'png', data: 'iVBORw==' }

    // A picked cover replaces the current one, but not an uploaded file or a
    // ticked "Remove the current cover".
    await edit({ cover_url: picked })
    assert.deepEqual(await coverOf('Elsewhere'), stored)
    let gif = new File([new Uint8Array([71, 73, 70])], 'up.gif', { type: 'image/gif' })
    let before = network.requested.length
    await edit({ cover: gif, cover_url: picked })
    assert.deepEqual(await coverOf('Elsewhere'), { extension: 'gif', data: 'R0lG' })
    await edit({ remove_cover: 'on', cover_url: picked })
    assert.equal(await coverOf('Elsewhere'), null)
    assert.equal(network.requested.length, before)
    // Without a picked cover, the current one stays.
    await edit({ cover_url: picked })
    await edit({})
    assert.deepEqual(await coverOf('Elsewhere'), stored)
  })
})
