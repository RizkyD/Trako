import type { Handle, RemixNode } from 'remix/component'

import { COVER_ACCEPT } from '../covers.ts'
import { STATUSES, TYPES, type Franchise, type Item, type User } from '../db.ts'
import { routes } from '../routes.ts'
import { Document } from './document.tsx'
import { FranchiseSelect } from './public/franchise-select.tsx'
import { SearchBox } from './public/search-box.tsx'
import { ThemePicker } from './public/theme-toggle.tsx'

const APP = 'Trako'
const STATUS_LABEL = { planned: 'Planned', ongoing: 'In progress', finished: 'Finished' }
const NEXT_STEP = { planned: 'Start', ongoing: 'Mark finished', finished: 'Reopen' }

// Sort orders. The default groups titles by franchise; the others rank every
// shown title in one flat list.
const SORTS = {
  '': { label: 'Franchise', asc: '', desc: '' },
  rating: { label: 'Rating', asc: 'Lowest rated', desc: 'Highest rated' },
  finished: { label: 'Finish date', asc: 'Earliest finished', desc: 'Recently finished' },
  released: { label: 'Release date', asc: 'Oldest releases', desc: 'Newest releases' },
}
type Sort = keyof typeof SORTS
type Direction = 'asc' | 'desc'

const byTitle = (a: Item, b: Item) => a.title.localeCompare(b.title)

const SORT_KEY = {
  rating: (item: Item) => item.rating,
  finished: (item: Item) => item.finished_at,
  released: (item: Item) => item.released,
}

// Ranks titles by rating or by finish or release date, in the given direction.
// Titles without that value (unrated, unfinished, undated) go last either way,
// by title.
function rank(items: Item[], sort: keyof typeof SORT_KEY, direction: Direction): Item[] {
  let key = SORT_KEY[sort]
  let flip = direction === 'asc' ? 1 : -1
  let valued = items
    .filter((item) => key(item) !== null)
    .sort((a, b) => flip * String(key(a)).localeCompare(String(key(b)), 'en', { numeric: true }) || byTitle(a, b))
  return [...valued, ...items.filter((item) => key(item) === null).sort(byTitle)]
}

// A release date is a year, a year and month, or a full date.
function formatReleased(released: string): string {
  let [year, month, day] = released.split('-')
  if (!month) return year
  let date = new Date(Number(year), Number(month) - 1, Number(day ?? 1))
  return date.toLocaleDateString('en-GB', {
    day: day ? 'numeric' : undefined,
    month: 'short',
    year: 'numeric',
  })
}

// Platform names from the comma-separated field.
function platformsOf(item: Item): string[] {
  return (item.platforms ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
}

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

interface Filter {
  status?: string
  type?: string
  franchise?: string
  view?: string
  q?: string
  sort?: string
  dir?: string
}

function homeHref(filter: Filter): string {
  let query = new URLSearchParams()
  for (let [key, value] of Object.entries(filter)) {
    if (value) query.set(key, value)
  }
  return `${routes.home.href()}?${query}`
}

function Brand() {
  return () => (
    <>
      <i class="logo" />
      <span>
        {APP}
        <small lang="ja">トラコ</small>
      </span>
    </>
  )
}

export function LoginPage(handle: Handle<{ setup: boolean; error?: string }>) {
  return () => {
    let { setup, error } = handle.props
    return (
      <Document title={`Sign in — ${APP}`}>
        <main class="auth">
          <div class="panel">
            <span class="brand">
              <Brand />
            </span>
            <h1>{setup ? 'Create your account' : 'Welcome back'}</h1>
            <p class="muted">
              {setup
                ? 'No account yet. Create the first one to get started.'
                : 'Pick up where you left off.'}
            </p>
            {error && <p role="alert">{error}</p>}
            <form method="post" action={routes.loginSubmit.href()} class="fields">
              <label class="wide">
                Username
                <input name="username" autocomplete="username" required autofocus />
              </label>
              <label class="wide">
                Password
                <input
                  name="password"
                  type="password"
                  autocomplete={setup ? 'new-password' : 'current-password'}
                  minlength={setup ? 8 : undefined}
                  required
                />
              </label>
              <button type="submit" class="wide primary">
                {setup ? 'Create account' : 'Sign in'}
              </button>
            </form>
          </div>
        </main>
      </Document>
    )
  }
}

interface HomeProps extends Required<Filter> {
  user: User
  items: Item[]
  franchises: Franchise[]
}

export function HomePage(handle: Handle<HomeProps>) {
  return () => {
    let { user, items, franchises, status, type, franchise, view, q } = handle.props
    let sort: Sort = handle.props.sort in SORTS ? (handle.props.sort as Sort) : ''
    // Franchises read A to Z and releases oldest first by default; rankings
    // start from the top.
    let direction: Direction =
      handle.props.dir === 'asc' || handle.props.dir === 'desc'
        ? handle.props.dir
        : sort === '' || sort === 'released'
          ? 'asc'
          : 'desc'
    let filter = { status, type, franchise, view, q, sort, dir: handle.props.dir }
    let needle = q.trim().toLowerCase()
    let shown = items.filter(
      (item) =>
        (!status || item.status === status) &&
        (!type || item.type === type) &&
        (!franchise || String(item.franchise_id) === franchise) &&
        // The search matches the title or the franchise name.
        (!needle || `${item.title}\n${item.franchise ?? ''}`.toLowerCase().includes(needle)),
    )
    let groups: Map<string, Item[]>
    if (sort === '') {
      // Items arrive ordered by franchise name, with franchise-less ones last.
      // Those stand on their own after the franchise panels, under the empty name.
      let named = Map.groupBy(
        shown.filter((item) => item.franchise),
        (item) => item.franchise ?? '',
      )
      let loose = shown.filter((item) => !item.franchise)
      groups = new Map([
        ...(direction === 'asc' ? [...named] : [...named].reverse()),
        ...(loose.length ? [['', loose] as const] : []),
      ])
    } else {
      groups = new Map(shown.length ? [[SORTS[sort][direction], rank(shown, sort, direction)]] : [])
    }
    // Progress counts every entry of the franchise, not only the filtered ones.
    let totals = Map.groupBy(items, (item) => item.franchise ?? '')
    let finished = items.filter((item) => item.status === 'finished').length
    let percent = items.length ? Math.round((finished / items.length) * 100) : 0
    let heading = status in STATUS_LABEL ? STATUS_LABEL[status as Item['status']] : 'All titles'
    let activeFranchise = franchises.find((entry) => String(entry.id) === franchise)

    return (
      <Document title={APP}>
        <Shell user={user} items={items} filter={filter} active="home">
          <header class="page">
            <div>
              <h1>
                {heading}
                {type && <span class="muted"> · {type}</span>}
              </h1>
              <p class="muted">
                {shown.length} {shown.length === 1 ? 'title' : 'titles'} shown
                {activeFranchise && (
                  <a class="chip" href={homeHref({ ...filter, franchise: '' })}>
                    {activeFranchise.name} <span aria-hidden="true">×</span>
                    <span class="sr">Clear franchise filter</span>
                  </a>
                )}
                {needle && (
                  <a class="chip" href={homeHref({ ...filter, q: '' })}>
                    “{q.trim()}” <span aria-hidden="true">×</span>
                    <span class="sr">Clear search</span>
                  </a>
                )}
              </p>
            </div>
            <button type="button" class="primary" popovertarget="add">
              <span aria-hidden="true">+</span> Add title
            </button>
          </header>

          <div class="toolbar">
            <SearchBox
              action={routes.home.href()}
              q={q}
              hidden={Object.fromEntries(
                Object.entries({ ...filter, q: '' }).filter(([, value]) => value),
              )}
            />
            <nav class="segmented" aria-label="Sort by">
              {(Object.keys(SORTS) as Sort[]).map((value) => (
                <a
                  key={value}
                  // Switching the sort goes back to that sort's default direction.
                  href={homeHref({ ...filter, sort: value, dir: '' })}
                  aria-current={sort === value ? 'true' : undefined}
                >
                  {SORTS[value].label}
                </a>
              ))}
            </nav>
            <nav class="segmented" aria-label="Sort direction">
              <a
                href={homeHref({ ...filter, dir: 'asc' })}
                aria-current={direction === 'asc' ? 'true' : undefined}
                title="Ascending"
              >
                <span aria-hidden="true">↑</span> Asc
              </a>
              <a
                href={homeHref({ ...filter, dir: 'desc' })}
                aria-current={direction === 'desc' ? 'true' : undefined}
                title="Descending"
              >
                <span aria-hidden="true">↓</span> Desc
              </a>
            </nav>
            <nav class="segmented" aria-label="View">
              <a
                href={homeHref({ ...filter, view: '' })}
                aria-current={view !== 'list' ? 'true' : undefined}
              >
                Grid
              </a>
              <a
                href={homeHref({ ...filter, view: 'list' })}
                aria-current={view === 'list' ? 'true' : undefined}
              >
                List
              </a>
            </nav>
          </div>

          <nav class="types" aria-label="Type filter">
            <a href={homeHref({ ...filter, type: '' })} aria-current={!type ? 'true' : undefined}>
              All types
              <span>{items.length}</span>
            </a>
            {TYPES.map((value) => (
              <a
                key={value}
                href={homeHref({ ...filter, type: value })}
                aria-current={type === value ? 'true' : undefined}
              >
                <i class={`swatch ${value}`} />
                {value}
                <span>{items.filter((item) => item.type === value).length}</span>
              </a>
            ))}
          </nav>

          {items.length > 0 && (
            <div class="overall">
              <strong>{percent}%</strong>
              <div>
                <span>
                  {finished} of {items.length} titles finished
                </span>
                <progress value={finished} max={items.length} aria-label="Overall progress" />
              </div>
            </div>
          )}

          {shown.length === 0 && (
            <div class="empty">
              <i class="logo" />
              <p>
                {items.length === 0
                  ? 'Nothing here yet. Add the title you are working through right now.'
                  : 'No titles match these filters.'}
              </p>
            </div>
          )}

          {[...groups].map(([name, entries]) => {
            let all = totals.get(name) ?? []
            let done = all.filter((item) => item.status === 'finished').length
            return (
              <section
                key={name}
                class={name ? 'group' : 'group loose'}
                aria-label={name ? undefined : 'Titles without a franchise'}
              >
                {name && (
                  <header>
                    <h2>{name}</h2>
                    {sort === '' ? (
                      <>
                        <span class="pill">
                          {done}/{all.length} finished
                        </span>
                        <progress value={done} max={all.length} aria-label={`${name} progress`} />
                      </>
                    ) : (
                      <span class="pill">{entries.length} ranked</span>
                    )}
                  </header>
                )}
                <ul class={view === 'list' ? 'list' : 'grid'}>
                  {entries.map((item) => (
                    <li key={item.id}>
                      <a class={`cover ${item.type}`} href={routes.itemEdit.href({ id: item.id })}>
                        {item.cover ? (
                          <img
                            src={routes.covers.href({ file: item.cover })}
                            alt=""
                            loading="lazy"
                          />
                        ) : (
                          <span aria-hidden="true">{item.title.slice(0, 1)}</span>
                        )}
                        <i class={`state ${item.status}`} title={STATUS_LABEL[item.status]} />
                      </a>
                      <div class="title">
                        <a href={routes.itemEdit.href({ id: item.id })}>{item.title}</a>
                        <small>
                          <span>
                            <span class={`tag ${item.type}`}>{item.type}</span>
                            {item.rating && (
                              <span class="rating" title={`Rated ${item.rating} out of 10`}>
                                ★ {item.rating}
                              </span>
                            )}
                          </span>
                          {/* Ranked lists are not grouped, so each title names its franchise. */}
                          {sort !== '' && item.franchise && <span>{item.franchise}</span>}
                          {item.released && <span>Released {formatReleased(item.released)}</span>}
                          <span>
                            {STATUS_LABEL[item.status]}
                            {item.finished_at &&
                              ` · ${dateFormat.format(new Date(item.finished_at))}`}
                          </span>
                        </small>
                        {item.platforms && (
                          // Cards show the first few platforms; the list view shows all.
                          <p class="platforms" title={platformsOf(item).join(', ')}>
                            {platformsOf(item).map((name) => (
                              <span key={name}>{name}</span>
                            ))}
                            {platformsOf(item).length > 3 && (
                              <span class="more">+{platformsOf(item).length - 3}</span>
                            )}
                          </p>
                        )}
                        {item.description && <p class="description">{item.description}</p>}
                        {item.note && <p class="note">{item.note}</p>}
                      </div>
                      <form
                        method="post"
                        action={routes.itemToggle.href({ id: item.id }) + homeHref(filter).slice(1)}
                      >
                        <button type="submit" class="ghost">
                          {NEXT_STEP[item.status]}
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}

          <div id="add" popover="auto" class="dialog">
            <h2>Add title</h2>
            {/* Full document navigation so the dialog closes and its fields reset. */}
            <form
              method="post"
              action={routes.itemCreate.href()}
              enctype="multipart/form-data"
              class="fields"
              data-rmx-document
            >
              <ItemFields franchises={franchises} />
              <div class="wide actions">
                <button type="button" class="ghost" popovertarget="add" popovertargetaction="hide">
                  Cancel
                </button>
                <button type="submit" class="primary">
                  Add
                </button>
              </div>
            </form>
          </div>
        </Shell>
      </Document>
    )
  }
}

export function EditPage(
  handle: Handle<{ user: User; item: Item; items: Item[]; franchises: Franchise[] }>,
) {
  return () => {
    let { user, item, items, franchises } = handle.props
    return (
      <Document title={`Edit ${item.title} — ${APP}`}>
        <Shell user={user} items={items} filter={{}}>
          <header class="page">
            <div>
              <a href={routes.home.href()} class="back">
                ← All titles
              </a>
              <h1>{item.title}</h1>
            </div>
          </header>
          <div class="panel edit">
            {item.cover && (
              <img class="preview" src={routes.covers.href({ file: item.cover })} alt="Cover" />
            )}
            <div>
              <form
                id="edit"
                method="post"
                action={routes.itemUpdate.href({ id: item.id })}
                enctype="multipart/form-data"
                class="fields"
                data-rmx-document
              >
                <ItemFields item={item} franchises={franchises} />
              </form>
              <div class="actions split">
                <button type="button" class="danger" popovertarget="confirm-delete">
                  Delete title
                </button>
                <button type="submit" form="edit" class="primary">
                  Save
                </button>
              </div>
            </div>
          </div>

          {/* Deleting asks first; the form that actually deletes lives in this dialog. */}
          <div id="confirm-delete" popover="auto" class="dialog confirm">
            <h2>Delete this title?</h2>
            <p>
              <strong>{item.title}</strong> will be removed from your list
              {item.cover ? ', along with its cover' : ''}. This cannot be undone.
            </p>
            <form method="post" action={routes.itemDelete.href({ id: item.id })} class="actions">
              <button
                type="button"
                class="ghost"
                popovertarget="confirm-delete"
                popovertargetaction="hide"
              >
                Cancel
              </button>
              <button type="submit" class="danger solid">
                Delete
              </button>
            </form>
          </div>
        </Shell>
      </Document>
    )
  }
}

export function FranchisesPage(
  handle: Handle<{ user: User; items: Item[]; franchises: Franchise[]; error?: string }>,
) {
  return () => {
    let { user, items, franchises, error } = handle.props
    return (
      <Document title={`Franchises — ${APP}`}>
        <Shell user={user} items={items} filter={{}} active="franchises">
          <header class="page">
            <div>
              <h1>Franchises</h1>
              <p class="muted">
                Franchises added here can be picked when you add or edit a title.
              </p>
            </div>
          </header>

          <form
            method="post"
            action={routes.franchiseCreate.href()}
            class="panel inline"
            data-rmx-document
          >
            <label>
              New franchise
              <input name="name" placeholder="e.g. Persona" required />
            </label>
            <button type="submit" class="primary">
              Add
            </button>
          </form>
          {error && <p role="alert">{error}</p>}

          {franchises.length === 0 ? (
            <div class="empty">
              <i class="logo" />
              <p>No franchises yet. Titles can still be tracked without one.</p>
            </div>
          ) : (
            <section class="group">
              <ul class="list">
                {franchises.map((franchise) => {
                  let own = items.filter((item) => item.franchise_id === franchise.id)
                  let done = own.filter((item) => item.status === 'finished').length
                  return (
                    <li key={franchise.id}>
                      <form
                        id={`franchise-${franchise.id}`}
                        method="post"
                        action={routes.franchiseUpdate.href({ id: franchise.id })}
                        class="title"
                      >
                        <input
                          name="name"
                          value={franchise.name}
                          aria-label="Franchise name"
                          required
                        />
                        <small>
                          <a href={homeHref({ franchise: String(franchise.id) })}>
                            {own.length} {own.length === 1 ? 'title' : 'titles'}
                          </a>
                          {own.length > 0 && ` · ${done}/${own.length} finished`}
                        </small>
                      </form>
                      <button type="submit" form={`franchise-${franchise.id}`} class="ghost">
                        Save
                      </button>
                      <button
                        type="button"
                        class="danger"
                        popovertarget={`confirm-franchise-${franchise.id}`}
                      >
                        Delete
                      </button>
                      {/* Deleting asks first; the form that deletes lives in this dialog. */}
                      <div
                        id={`confirm-franchise-${franchise.id}`}
                        popover="auto"
                        class="dialog confirm"
                      >
                        <h2>Delete this franchise?</h2>
                        <p>
                          <strong>{franchise.name}</strong> will be removed.{' '}
                          {own.length === 0
                            ? 'No titles belong to it.'
                            : `Its ${own.length} ${own.length === 1 ? 'title stays' : 'titles stay'} in your list, without a franchise.`}
                        </p>
                        <form
                          method="post"
                          action={routes.franchiseDelete.href({ id: franchise.id })}
                          class="actions"
                        >
                          <button
                            type="button"
                            class="ghost"
                            popovertarget={`confirm-franchise-${franchise.id}`}
                            popovertargetaction="hide"
                          >
                            Cancel
                          </button>
                          <button type="submit" class="danger solid">
                            Delete
                          </button>
                        </form>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </Shell>
      </Document>
    )
  }
}

export function SettingsPage(
  handle: Handle<{ user: User; items: Item[]; notice?: string; error?: string }>,
) {
  return () => {
    let { user, items, notice, error } = handle.props
    return (
      <Document title={`Settings — ${APP}`}>
        <Shell user={user} items={items} filter={{}} active="settings">
          <header class="page">
            <div>
              <h1>Settings</h1>
              <p class="muted">Appearance, your account, and backing up or loading your list.</p>
            </div>
          </header>
          {notice && <p role="status">{notice}</p>}
          {error && <p role="alert">{error}</p>}

          <section class="panel stack">
            <h2>Appearance</h2>
            <p class="muted">
              Choose light or dark mode, or follow your device. The choice is remembered in this
              browser.
            </p>
            <div>
              <ThemePicker />
            </div>
          </section>

          <section class="panel stack">
            <h2>Profile photo</h2>
            <form
              method="post"
              action={routes.avatarChange.href()}
              enctype="multipart/form-data"
              class="profile"
              data-rmx-document
            >
              <Avatar user={user} />
              <div class="stack">
                <label>
                  Photo <span class="muted">(JPG, PNG, WebP, GIF · max 5 MB)</span>
                  <input name="avatar" type="file" accept={COVER_ACCEPT} required />
                </label>
                <div class="actions split bare">
                  {user.avatar ? (
                    // Removing needs no file, so it skips the form's validation.
                    <button type="submit" name="remove" value="on" class="danger" formnovalidate>
                      Remove photo
                    </button>
                  ) : (
                    <span />
                  )}
                  <button type="submit" class="primary">
                    Upload
                  </button>
                </div>
              </div>
            </form>
          </section>

          <section class="panel stack">
            <h2>Username</h2>
            <form method="post" action={routes.usernameChange.href()} class="stack" data-rmx-document>
              <label>
                Username
                <input name="username" value={user.username} autocomplete="username" required />
              </label>
              <label>
                Password <span class="muted">(to confirm it is you)</span>
                <input
                  name="current_password"
                  type="password"
                  autocomplete="current-password"
                  required
                />
              </label>
              <div>
                <button type="submit" class="primary">
                  Change username
                </button>
              </div>
            </form>
          </section>

          <section class="panel stack">
            <h2>Password</h2>
            <form method="post" action={routes.passwordChange.href()} class="stack" data-rmx-document>
              <label>
                Current password
                <input
                  name="current_password"
                  type="password"
                  autocomplete="current-password"
                  required
                />
              </label>
              <label>
                New password <span class="muted">(at least 8 characters)</span>
                <input
                  name="new_password"
                  type="password"
                  autocomplete="new-password"
                  minlength={8}
                  required
                />
              </label>
              <label>
                Confirm new password
                <input
                  name="confirm_password"
                  type="password"
                  autocomplete="new-password"
                  minlength={8}
                  required
                />
              </label>
              <div>
                <button type="submit" class="primary">
                  Change password
                </button>
              </div>
            </form>
          </section>

          <section class="panel stack">
            <h2>Export</h2>
            <p class="muted">
              Downloads one JSON file with every title, franchise, rating, note and cover image.
              Your account is not included.
            </p>
            <div>
              {/* A plain link: the browser downloads the file instead of navigating. */}
              <a class="button primary" href={routes.export.href()} download data-rmx-document>
                Export {items.length} {items.length === 1 ? 'title' : 'titles'}
              </a>
            </div>
          </section>

          <section class="panel stack">
            <h2>Import</h2>
            <p class="muted">
              Loads a Trako export file. Import adds to your list and skips titles already in it
              (same title and type), so importing the same file twice is safe. Replace everything
              swaps your whole list for the file instead.
            </p>
            <form
              method="post"
              id="import"
              action={routes.import.href()}
              enctype="multipart/form-data"
              class="stack"
              data-rmx-document
            >
              <label>
                Export file
                <input name="file" type="file" accept="application/json,.json" required />
              </label>
              <div class="actions split">
                <button type="button" class="danger" popovertarget="confirm-replace">
                  Replace everything…
                </button>
                <button type="submit" class="primary">
                  Import
                </button>
              </div>
            </form>
          </section>

          {/* Replacing asks first. Its button submits the import form above with
              the `replace` flag set. */}
          <div id="confirm-replace" popover="auto" class="dialog confirm">
            <h2>Replace everything?</h2>
            <p>
              All {items.length} current {items.length === 1 ? 'title' : 'titles'}, their covers and
              every franchise will be deleted, then replaced by the contents of the file. This
              cannot be undone.
            </p>
            <div class="actions">
              <button
                type="button"
                class="ghost"
                popovertarget="confirm-replace"
                popovertargetaction="hide"
              >
                Cancel
              </button>
              <button type="submit" form="import" name="replace" value="on" class="danger solid">
                Delete and replace
              </button>
            </div>
          </div>
        </Shell>
      </Document>
    )
  }
}

// The account's photo, or the first letter of its username when it has none.
function Avatar(handle: Handle<{ user: User }>) {
  return () => {
    let { username, avatar } = handle.props.user
    return avatar ? (
      <img class="avatar" src={routes.covers.href({ file: avatar })} alt="" />
    ) : (
      <span class="avatar" aria-hidden="true">
        {username.slice(0, 1).toUpperCase()}
      </span>
    )
  }
}

// Sidebar (pages, then the status filter with counts) around the page content.
function Shell(
  handle: Handle<{
    user: User
    items: Item[]
    filter: Filter
    active?: 'home' | 'franchises' | 'settings'
    children?: RemixNode
  }>,
) {
  return () => {
    let { user, items, filter, active, children } = handle.props
    let { status } = filter
    let count = (value: string) => items.filter((item) => item.status === value).length
    // Filters only read as selected while the list they filter is on screen.
    let current = (selected: boolean) => (active === 'home' && selected ? 'page' : undefined)

    return (
      <div class={active === 'home' ? 'shell home' : 'shell'}>
        <aside>
          <a href={routes.home.href()} class="brand">
            <Brand />
          </a>
          <nav aria-label="Menu">
            <a href={routes.home.href()} aria-current={active === 'home' ? 'true' : undefined}>
              Titles
              <span>{items.length}</span>
            </a>
            <a
              href={routes.franchises.href()}
              aria-current={active === 'franchises' ? 'page' : undefined}
            >
              Franchises
            </a>
            <a
              href={routes.settings.href()}
              aria-current={active === 'settings' ? 'page' : undefined}
            >
              Settings
            </a>
          </nav>
          <nav class="filter" aria-label="Status filter">
            <h3>Status</h3>
            <a href={homeHref({ ...filter, status: '' })} aria-current={current(!status)}>
              <i class="state all" />
              All
              <span>{items.length}</span>
            </a>
            {STATUSES.map((value) => (
              <a
                key={value}
                href={homeHref({ ...filter, status: value })}
                aria-current={current(status === value)}
              >
                <i class={`state ${value}`} />
                {STATUS_LABEL[value]}
                <span>{count(value)}</span>
              </a>
            ))}
          </nav>
          <div class="logout">
            <a class="account" href={routes.settings.href()} title="Settings">
              <Avatar user={user} />
              <strong>{user.username}</strong>
            </a>
            <form method="post" action={routes.logout.href()}>
              <button type="submit" class="ghost">
                Sign out
              </button>
            </form>
          </div>
        </aside>
        <main>{children}</main>
      </div>
    )
  }
}

// Escapes a name for use inside an input's `pattern` attribute.
function escapePattern(text: string): string {
  return text.replace(/[\^$\\.*+?()[\]{}|/]/g, '\\$&')
}

function ItemFields(handle: Handle<{ item?: Item; franchises: Franchise[] }>) {
  return () => {
    let { item, franchises } = handle.props
    return (
      <>
        <label class="wide">
          Title
          <input name="title" value={item?.title} required />
        </label>
        <label>
          Type
          <select name="type">
            {TYPES.map((value) => (
              <option key={value} value={value} selected={item?.type === value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <div>
          <label for="franchise">
            Franchise{' '}
            <a class="muted" href={routes.franchises.href()}>
              (manage)
            </a>
          </label>
          {/* The pattern only accepts a franchise that already exists (or nothing). */}
          <FranchiseSelect
            id="franchise"
            names={franchises.map((franchise) => franchise.name)}
            value={item?.franchise ?? ''}
            pattern={
              franchises.map((franchise) => escapePattern(franchise.name)).join('|') || undefined
            }
          />
        </div>
        <label>
          Status
          <select name="status">
            {STATUSES.map((value) => (
              <option key={value} value={value} selected={(item?.status ?? 'ongoing') === value}>
                {STATUS_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Finish date <span class="muted">(empty = today)</span>
          <input name="finished_at" type="date" value={item?.finished_at ?? ''} />
        </label>
        <label>
          Release date <span class="muted">(year or full date)</span>
          <input
            name="released"
            value={item?.released ?? ''}
            placeholder="1997 or 1997-01-31"
            pattern="\d{4}(-\d{2}(-\d{2})?)?"
            title="A year (1997), a year and month (1997-01) or a full date (1997-01-31)"
          />
        </label>
        <label>
          Rating <span class="muted">(optional · 1–10)</span>
          <input name="rating" type="number" min={1} max={10} step={1} value={item?.rating ?? ''} />
        </label>
        <label class="wide">
          Platforms <span class="muted">(optional · separated by commas)</span>
          <input
            name="platforms"
            value={item?.platforms ?? ''}
            placeholder="PlayStation, Windows, Nintendo Switch"
          />
        </label>
        <label class="wide">
          Description <span class="muted">(optional)</span>
          <textarea name="description" rows={3} value={item?.description ?? ''} />
        </label>
        <label class="wide">
          Cover <span class="muted">(optional · JPG, PNG, WebP, GIF · max 5 MB)</span>
          <input name="cover" type="file" accept={COVER_ACCEPT} />
        </label>
        {item?.cover && (
          <label class="wide check">
            <input name="remove_cover" type="checkbox" /> Remove the current cover
          </label>
        )}
        <label class="wide">
          Notes <span class="muted">(optional)</span>
          <textarea name="note" rows={3} value={item?.note ?? ''} />
        </label>
      </>
    )
  }
}
