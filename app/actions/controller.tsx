import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { assets } from '../assets.ts'
import { coverResponse, deleteCover, fetchCover, saveCover } from '../covers.ts'
import {
  addTags,
  advanceItem,
  changePassword,
  changeUsername,
  createFranchise,
  createItem,
  createUser,
  deleteFranchise,
  deleteItem,
  deleteItems,
  getItem,
  getUser,
  hasUser,
  listFranchises,
  listItems,
  parseItem,
  pickedItems,
  randomItem,
  renameFranchise,
  replayItem,
  setAvatar,
  setFavorite,
  setFranchise,
  setStatus,
  splitList,
  STATUSES,
  toggleFavorite,
  toggleItem,
  TYPES,
  updateItem,
  verifyUser,
  type Item,
} from '../db.ts'
import { fromCsv, fromMal, fromSteam } from '../importers.ts'
import { lookup } from '../lookup.ts'
import { routes } from '../routes.ts'
import { exportData, importData, importItems } from '../transfer.ts'
import {
  EditPage,
  FranchisesPage,
  HomePage,
  LoginPage,
  SettingsPage,
  StatsPage,
} from './pages.tsx'

const home = () => redirect(routes.home.href())
// The buttons on a listed title carry the active list filter in their query
// string, so the list comes back as it was.
const backToList = (context: { url: URL }) => redirect(routes.home.href() + context.url.search)
// The signed-in account; every page shows it in the sidebar.
const userOf = (context: { session: { get(key: string): unknown } }) =>
  getUser(Number(context.session.get('userId')))
const badRequest = () => new Response('Invalid data', { status: 400 })
const notFound = () => new Response('Not found', { status: 404 })

interface FormContext {
  formData: FormData
  session: { flash(key: string, value: string): void }
}

// The cover picked with "Fetch details", for a form that uploaded none. A failed
// download only loses the cover; the list then says so.
async function fetchedCover(context: FormContext): Promise<string | null> {
  let address = String(context.formData.get('cover_url') ?? '')
  let cover = address ? await fetchCover(address) : null
  if (address && !cover) context.session.flash('notice', 'Saved, but the cover could not be fetched.')
  return cover
}

const importedNotice = (result: { added: number; skipped: number }) =>
  `Imported ${result.added} titles${result.skipped ? `, skipped ${result.skipped} already in your list` : ''}.`

// The end of an import from another service: the franchise typed in its form
// goes to every title that names none of its own; entries that are not valid
// titles are listed (CSV rows by number).
async function importOther(context: FormContext, entries: Record<string, unknown>[]) {
  let franchise = String(context.formData.get('franchise') ?? '').trim() || null
  let result = await importItems(entries.map((entry) => ({ franchise, ...entry })))
  context.session.flash('notice', importedNotice(result))
  if (result.invalid.length) {
    let which = result.invalid.map((index) =>
      entries[index].row ? `row ${entries[index].row}` : `entry ${index + 1}`,
    )
    let more = which.length > 10 ? ` and ${which.length - 10} more` : ''
    context.session.flash(
      'error',
      `Not imported, as a value is missing or not valid: ${which.slice(0, 10).join(', ')}${more}.`,
    )
  }
  return redirect(routes.settings.href())
}

function importFailed(context: FormContext, message: string) {
  context.session.flash('error', `${message} Nothing was changed.`)
  return redirect(routes.settings.href())
}

export default createController(routes, {
  actions: {
    async assets(context) {
      return (await assets.fetch(context.request)) ?? new Response('Not Found', { status: 404 })
    },
    covers(context) {
      return coverResponse(context.params.file)
    },

    login(context) {
      let error = context.session.get('error')
      return context.render(
        <LoginPage setup={!hasUser()} error={typeof error === 'string' ? error : undefined} />,
      )
    },
    loginSubmit(context) {
      let username = String(context.formData.get('username') ?? '').trim()
      let password = String(context.formData.get('password') ?? '')
      let fail = (message: string) => {
        context.session.flash('error', message)
        return redirect(routes.login.href())
      }

      let userId: number | null
      if (hasUser()) {
        userId = verifyUser(username, password)
        if (userId === null) return fail('Wrong username or password')
      } else {
        // First run: the first submission creates the one account.
        if (!username || password.length < 8) return fail('Password must be at least 8 characters')
        userId = createUser(username, password)
      }

      context.session.regenerateId()
      context.session.set('userId', userId)
      return home()
    },
    logout(context) {
      context.session.destroy()
      return redirect(routes.login.href())
    },

    home(context) {
      let query = context.url.searchParams
      let notice = context.session.get('notice')
      let error = context.session.get('error')
      return context.render(
        <HomePage
          notice={typeof notice === 'string' ? notice : undefined}
          error={typeof error === 'string' ? error : undefined}
          user={userOf(context)}
          items={listItems()}
          franchises={listFranchises()}
          status={query.get('status') ?? ''}
          type={query.get('type') ?? ''}
          franchise={query.get('franchise') ?? ''}
          view={query.get('view') ?? ''}
          q={query.get('q') ?? ''}
          sort={query.get('sort') ?? ''}
          dir={query.get('dir') ?? ''}
          favorite={query.get('favorite') ?? ''}
          tag={query.get('tag') ?? ''}
          platform={query.get('platform') ?? ''}
          rating={query.get('rating') ?? ''}
          select={query.get('select') ?? ''}
        />,
      )
    },
    // Selection mode's actions, on every ticked title; ids of titles that are
    // gone are skipped. Back on the list the form came from, as with backToList.
    async itemsBulk(context) {
      let field = (name: string) => String(context.formData.get(name) ?? '').trim()
      let items = pickedItems(context.formData.getAll('id').map(Number))
      let ids = items.map((item) => item.id)
      let action = field('action')
      let status = field('status') as Item['status']
      // Picked by id; the empty choice takes the titles out of their franchise.
      let franchise = field('franchise')
        ? listFranchises().find((entry) => String(entry.id) === field('franchise'))
        : null
      let tags = splitList(field('tag'))
      let fail = (message: string) => {
        context.session.flash('error', message)
        return backToList(context)
      }

      if (ids.length === 0) return fail('Select at least one title first.')
      if (action === 'tag' && tags.length === 0) return fail('Type the tag to add first.')
      if (action === 'status' && STATUSES.includes(status)) setStatus(ids, status)
      else if (action === 'move' && franchise !== undefined) setFranchise(ids, franchise?.id ?? null)
      else if (action === 'tag') addTags(items, tags)
      else if (action === 'favorite') setFavorite(ids, 1)
      else if (action === 'unfavorite') setFavorite(ids, 0)
      else if (action === 'delete') deleteItems(ids)
      else return badRequest()
      // Deleted titles take their cover files along.
      if (action === 'delete') for (let item of items) await deleteCover(item.cover)

      let titles = `${ids.length} ${ids.length === 1 ? 'title' : 'titles'}`
      context.session.flash('notice', `${action === 'delete' ? 'Deleted' : 'Updated'} ${titles}.`)
      return backToList(context)
    },
    // A title to do next, of the type the list shows; the other filters only
    // matter for going back to the list when there is nothing to pick.
    random(context) {
      let item = randomItem(context.url.searchParams.get('type') ?? '')
      if (item) return redirect(routes.itemEdit.href({ id: item.id }))
      context.session.flash('error', 'Nothing left to pick.')
      return backToList(context)
    },
    async itemCreate(context) {
      let item = parseItem(context.formData)
      let cover = await saveCover(context.formData.get('cover'))
      if (!item || cover === false) {
        if (cover) await deleteCover(cover)
        return badRequest()
      }
      createItem(item, cover ?? (await fetchedCover(context)))
      return home()
    },
    // Details for the add and edit forms, from Wikipedia and AniList.
    async lookupTitle(context) {
      let query = context.url.searchParams.get('q')?.trim() ?? ''
      let type = context.url.searchParams.get('type') as Item['type']
      if (!query || !TYPES.includes(type)) return badRequest()
      let candidates = await lookup(query, type)
      return candidates
        ? Response.json(candidates)
        : Response.json({ error: 'Lookup failed' }, { status: 502 })
    },
    itemEdit(context) {
      let item = getItem(context.params.id)
      if (!item) return notFound()
      return context.render(
        <EditPage
          user={userOf(context)}
          item={item}
          items={listItems()}
          franchises={listFranchises()}
        />,
      )
    },
    async itemUpdate(context) {
      let existing = getItem(context.params.id)
      if (!existing) return notFound()

      let item = parseItem(context.formData)
      let uploaded = await saveCover(context.formData.get('cover'))
      if (!item || uploaded === false) {
        if (uploaded) await deleteCover(uploaded)
        return badRequest()
      }

      let cover = context.formData.has('remove_cover')
        ? uploaded
        : (uploaded ?? (await fetchedCover(context)) ?? existing.cover)
      updateItem(context.params.id, item, cover)
      if (cover !== existing.cover) await deleteCover(existing.cover)
      return home()
    },
    itemToggle(context) {
      toggleItem(context.params.id)
      return backToList(context)
    },
    itemAdvance(context) {
      advanceItem(context.params.id)
      return backToList(context)
    },
    itemFavorite(context) {
      toggleFavorite(context.params.id)
      return backToList(context)
    },
    itemReplay(context) {
      replayItem(context.params.id)
      return backToList(context)
    },
    async itemDelete(context) {
      let existing = getItem(context.params.id)
      deleteItem(context.params.id)
      await deleteCover(existing?.cover ?? null)
      return home()
    },

    franchises(context) {
      let error = context.session.get('error')
      return context.render(
        <FranchisesPage
          user={userOf(context)}
          items={listItems()}
          franchises={listFranchises()}
          error={typeof error === 'string' ? error : undefined}
        />,
      )
    },
    franchiseCreate(context) {
      if (!createFranchise(String(context.formData.get('name') ?? ''))) {
        context.session.flash('error', 'That franchise name is empty or already exists.')
      }
      return redirect(routes.franchises.href())
    },
    franchiseUpdate(context) {
      if (!renameFranchise(context.params.id, String(context.formData.get('name') ?? ''))) {
        context.session.flash('error', 'That franchise name is empty or already exists.')
      }
      return redirect(routes.franchises.href())
    },
    franchiseDelete(context) {
      deleteFranchise(context.params.id)
      return redirect(routes.franchises.href())
    },

    stats(context) {
      return context.render(<StatsPage user={userOf(context)} items={listItems()} />)
    },

    settings(context) {
      let notice = context.session.get('notice')
      let error = context.session.get('error')
      return context.render(
        <SettingsPage
          items={listItems()}
          franchises={listFranchises()}
          user={userOf(context)}
          notice={typeof notice === 'string' ? notice : undefined}
          error={typeof error === 'string' ? error : undefined}
        />,
      )
    },
    async avatarChange(context) {
      let userId = Number(context.session.get('userId'))
      let previous = getUser(userId).avatar
      if (context.formData.has('remove')) {
        setAvatar(userId, null)
        await deleteCover(previous)
        context.session.flash('notice', 'Profile photo removed.')
      } else {
        let saved = await saveCover(context.formData.get('avatar'))
        if (saved) {
          setAvatar(userId, saved)
          await deleteCover(previous)
          context.session.flash('notice', 'Profile photo updated.')
        } else {
          context.session.flash('error', 'Choose a JPG, PNG, WebP or GIF image of up to 5 MB.')
        }
      }
      return redirect(routes.settings.href())
    },
    usernameChange(context) {
      let username = String(context.formData.get('username') ?? '').trim()
      let password = String(context.formData.get('current_password') ?? '')
      let userId = Number(context.session.get('userId'))
      if (!username) {
        context.session.flash('error', 'The username cannot be empty.')
      } else if (!changeUsername(userId, password, username)) {
        context.session.flash('error', 'The password is wrong. Nothing was changed.')
      } else {
        context.session.flash('notice', `Username changed to ${username}.`)
      }
      return redirect(routes.settings.href())
    },
    passwordChange(context) {
      let field = (name: string) => String(context.formData.get(name) ?? '')
      let next = field('new_password')
      let error: string | undefined
      if (next.length < 8) {
        error = 'The new password must be at least 8 characters.'
      } else if (next !== field('confirm_password')) {
        error = 'The new password and its confirmation do not match.'
      } else if (!changePassword(Number(context.session.get('userId')), field('current_password'), next)) {
        error = 'The current password is wrong. Nothing was changed.'
      }

      if (error) {
        context.session.flash('error', error)
      } else {
        context.session.regenerateId()
        context.session.flash('notice', 'Password changed.')
      }
      return redirect(routes.settings.href())
    },
    async export() {
      let date = new Date().toLocaleDateString('sv')
      return new Response(await exportData(), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="trako-export-${date}.json"`,
        },
      })
    },
    async import(context) {
      let file = context.formData.get('file')
      let result =
        file instanceof File && file.size > 0
          ? await importData(await file.text(), context.formData.has('replace'))
          : null
      if (result) {
        context.session.flash('notice', importedNotice(result))
      } else {
        context.session.flash('error', 'That is not a valid Trako export file. Nothing was changed.')
      }
      return redirect(routes.settings.href())
    },
    async importMal(context) {
      let file = context.formData.get('file')
      let entries =
        file instanceof File && file.size > 0 ? fromMal(new Uint8Array(await file.arrayBuffer())) : null
      if (!entries) return importFailed(context, 'That is not a MyAnimeList export file.')
      return importOther(context, entries)
    },
    async importCsv(context) {
      let file = context.formData.get('file')
      let type = String(context.formData.get('type') ?? '')
      let entries = file instanceof File && file.size > 0 ? fromCsv(await file.text(), type) : null
      if (!entries) return importFailed(context, 'That CSV file has no title column.')
      return importOther(context, entries)
    },
    async importSteam(context) {
      let field = (name: string) => String(context.formData.get(name) ?? '').trim()
      let entries = await fromSteam(field('key'), field('steam_id'))
      if (!entries) {
        return importFailed(
          context,
          'Steam returned no games. Check the key and the SteamID, and that the profile’s game details are public.',
        )
      }
      return importOther(context, entries)
    },
  },
})
