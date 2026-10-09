import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { assets } from '../assets.ts'
import { coverResponse, deleteCover, saveCover } from '../covers.ts'
import {
  advanceItem,
  changePassword,
  changeUsername,
  createFranchise,
  createItem,
  createUser,
  deleteFranchise,
  deleteItem,
  getItem,
  getUser,
  hasUser,
  listFranchises,
  listItems,
  parseItem,
  renameFranchise,
  replayItem,
  setAvatar,
  toggleFavorite,
  toggleItem,
  updateItem,
  verifyUser,
} from '../db.ts'
import { routes } from '../routes.ts'
import { exportData, importData } from '../transfer.ts'
import { EditPage, FranchisesPage, HomePage, LoginPage, SettingsPage } from './pages.tsx'

const home = () => redirect(routes.home.href())
// The buttons on a listed title carry the active list filter in their query
// string, so the list comes back as it was.
const backToList = (context: { url: URL }) => redirect(routes.home.href() + context.url.search)
// The signed-in account; every page shows it in the sidebar.
const userOf = (context: { session: { get(key: string): unknown } }) =>
  getUser(Number(context.session.get('userId')))
const badRequest = () => new Response('Invalid data', { status: 400 })
const notFound = () => new Response('Not found', { status: 404 })

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
      return context.render(
        <HomePage
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
        />,
      )
    },
    async itemCreate(context) {
      let item = parseItem(context.formData)
      let cover = await saveCover(context.formData.get('cover'))
      if (!item || cover === false) {
        if (cover) await deleteCover(cover)
        return badRequest()
      }
      createItem(item, cover)
      return home()
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

      let cover = uploaded ?? (context.formData.has('remove_cover') ? null : existing.cover)
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

    settings(context) {
      let notice = context.session.get('notice')
      let error = context.session.get('error')
      return context.render(
        <SettingsPage
          items={listItems()}
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
        let skipped = result.skipped ? `, skipped ${result.skipped} already in your list` : ''
        context.session.flash('notice', `Imported ${result.added} titles${skipped}.`)
      } else {
        context.session.flash('error', 'That is not a valid Trako export file. Nothing was changed.')
      }
      return redirect(routes.settings.href())
    },
  },
})
