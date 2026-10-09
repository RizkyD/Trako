import { Fragment, unsafeHTML, type Handle, type RemixNode } from 'remix/component'

import { COVER_ACCEPT } from '../covers.ts'
import {
  inList,
  splitList,
  STATUSES,
  TYPES,
  today,
  type Franchise,
  type Item,
  type User,
} from '../db.ts'
import { markdown } from '../markdown.ts'
import { routes } from '../routes.ts'
import { Document } from './document.tsx'
import { FranchiseSelect } from './public/franchise-select.tsx'
import { ListFilters } from './public/list-filters.tsx'
import { SearchBox } from './public/search-box.tsx'
import { ThemePicker } from './public/theme-toggle.tsx'
import { TitleLookup } from './public/title-lookup.tsx'

const APP = 'Trako'
const STATUS_LABEL = {
  planned: 'Planned',
  ongoing: 'In progress',
  on_hold: 'On hold',
  dropped: 'Dropped',
  finished: 'Finished',
}
const NEXT_STEP = {
  planned: 'Start',
  ongoing: 'Mark finished',
  on_hold: 'Resume',
  dropped: 'Resume',
  finished: 'Reopen',
}
// What progress is usually counted in, per type: the unit field's placeholder.
const UNIT_HINT: Record<Item['type'], string> = {
  game: 'hours',
  manga: 'chapters',
  novel: 'chapters',
  film: '',
  series: 'episodes',
  anime: 'episodes',
}
// Headings for the types inside a franchise that holds more than one.
const TYPE_PLURAL: Record<Item['type'], string> = {
  game: 'Games',
  manga: 'Manga',
  novel: 'Novels',
  film: 'Films',
  series: 'Series',
  anime: 'Anime',
}

// Cards, rows, or one row of compact cards per release year.
const VIEWS = { '': 'Grid', list: 'List', timeline: 'Timeline' }
type View = keyof typeof VIEWS

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

// The day a release date starts: a year or a month counts from its first day.
const firstDay = (released: string) => `${released}-01-01`.slice(0, 10)

const relative = new Intl.RelativeTimeFormat('en')
// "in 12 days" or "in 3 months", from today (YYYY-MM-DD) to a later release.
function untilRelease(released: string, today: string): string {
  let days = (Date.parse(firstDay(released)) - Date.parse(today)) / 86_400_000
  return days < 31
    ? relative.format(days, 'day')
    : relative.format(Math.round(days / 30.44), 'month')
}

// Every name in use in a comma-separated field, A to Z: the tags field
// suggests them, the platform filter offers them.
function namesIn(items: Item[], field: 'tags' | 'platforms'): string[] {
  return [...new Set(items.flatMap((item) => splitList(item[field])))].sort((a, b) =>
    a.localeCompare(b),
  )
}

// Start and finish dates are YYYY-MM-DD, which `new Date` reads as UTC midnight.
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

interface Filter {
  status?: string
  type?: string
  franchise?: string
  view?: string
  q?: string
  sort?: string
  dir?: string
  favorite?: string
  tag?: string
  platform?: string
  // The lowest rating shown, 1 to 10.
  rating?: string
  // Selection mode, for the bulk actions: any value, "all" ticking every shown title.
  select?: string
}

function homeHref(filter: Filter): string {
  let query = new URLSearchParams()
  for (let [key, value] of Object.entries(filter)) {
    if (value) query.set(key, value)
  }
  return `${routes.home.href()}?${query}`
}

// The active filters, as the hidden fields a filter form resubmits.
const activeFilters = (filter: Filter) =>
  Object.fromEntries(Object.entries(filter).filter(([, value]) => value))

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
  notice?: string
  error?: string
}

export function HomePage(handle: Handle<HomeProps>) {
  return () => {
    let { user, items, franchises, status, type, franchise, q, favorite, tag, platform } =
      handle.props
    let { select, notice, error } = handle.props
    let sort: Sort = Object.hasOwn(SORTS, handle.props.sort) ? (handle.props.sort as Sort) : ''
    let view: View = Object.hasOwn(VIEWS, handle.props.view) ? (handle.props.view as View) : ''
    let timeline = view === 'timeline'
    // Selection mode puts a tick box on every title, for the bulk actions. The
    // timeline has none.
    let selecting = !timeline && select !== ''
    // Franchises read A to Z and releases oldest first by default; rankings
    // start from the top. The timeline ignores the sort: it is release order.
    let direction: Direction =
      handle.props.dir === 'asc' || handle.props.dir === 'desc'
        ? handle.props.dir
        : timeline || sort === '' || sort === 'released'
          ? 'asc'
          : 'desc'
    // A minimum rating is 1 to 10; anything else filters nothing.
    let minRating = /^([1-9]|10)$/.test(handle.props.rating) ? Number(handle.props.rating) : 0
    let rating = minRating ? String(minRating) : ''
    let filter = {
      status,
      type,
      franchise,
      view,
      q,
      sort,
      dir: handle.props.dir,
      favorite,
      tag,
      platform,
      rating,
      // Links keep selection mode on, with nothing ticked.
      select: selecting ? '1' : '',
    }
    let needle = q.trim().toLowerCase()
    let shown = items.filter(
      (item) =>
        (!status || item.status === status) &&
        (!type || item.type === type) &&
        (!franchise || String(item.franchise_id) === franchise) &&
        (!favorite || item.favorite === 1) &&
        (!tag || inList(item.tags, tag)) &&
        (!platform || inList(item.platforms, platform)) &&
        (item.rating ?? 0) >= minRating &&
        // The search looks through the title, franchise, description, notes,
        // platforms and tags.
        (!needle ||
          [item.title, item.franchise, item.description, item.note, item.platforms, item.tags]
            .join('\n')
            .toLowerCase()
            .includes(needle)),
    )
    let groups: Map<string, Item[]>
    if (timeline) {
      // One row per release year, then the undated titles.
      groups = Map.groupBy(
        rank(shown, 'released', direction),
        (item) => item.released?.slice(0, 4) ?? 'Unknown',
      )
    } else if (sort === '') {
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
    let heading = favorite
      ? 'Favorites'
      : status in STATUS_LABEL
        ? STATUS_LABEL[status as Item['status']]
        : 'All titles'
    let activeFranchise = franchises.find((entry) => String(entry.id) === franchise)
    // The buttons on each title post with the list filter attached (see backToList).
    let back = homeHref(filter).slice(1)
    // Shown titles still to come out, soonest first. The timeline has them in
    // place, and selection mode only in their panels, where they can be ticked.
    let day = today()
    let upcoming =
      timeline || selecting
        ? []
        : rank(
            shown.filter((item) => item.released && firstDay(item.released) > day),
            'released',
            'asc',
          )
    // Franchise panels collapse; with a few of them, all at once too.
    let panels = timeline || sort !== '' ? 0 : [...groups.keys()].filter(Boolean).length

    let card = (item: Item) => (
      // data-rmx-key: a page update matches each title to itself, not to whatever
      // now sits in its place, so a tick (or focus) never moves to another title.
      <li key={item.id} data-rmx-key={item.id}>
        {selecting && (
          // On a card the whole cover is the tick box's label (see app.css).
          <label class="pick">
            <input
              type="checkbox"
              name="id"
              value={item.id}
              checked={select === 'all'}
              aria-label={`Select ${item.title}`}
            />
          </label>
        )}
        <Cover item={item} />
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
            {item.started_at && (
              <span>Started {dateFormat.format(new Date(item.started_at))}</span>
            )}
            <span>
              {STATUS_LABEL[item.status]}
              {item.finished_at && ` · ${dateFormat.format(new Date(item.finished_at))}`}
            </span>
            {item.replays > 0 && <span>Replayed ×{item.replays}</span>}
          </small>
          {(item.progress_unit || item.progress_total !== null) && (
            <div class="track">
              <span>
                {item.progress}
                {item.progress_total !== null && ` / ${item.progress_total}`}
                {item.progress_unit && ` ${item.progress_unit}`}
              </span>
              {item.progress_total !== null && (
                <progress
                  value={item.progress}
                  max={item.progress_total}
                  aria-label={`${item.title} progress`}
                />
              )}
              {item.progress_unit && item.status !== 'finished' && !selecting && (
                // Submits the title's form (below) to the +1 action.
                <button
                  type="submit"
                  form={`item-${item.id}`}
                  formaction={routes.itemAdvance.href({ id: item.id }) + back}
                  class="ghost"
                  title={`One more (${item.progress_unit})`}
                >
                  +1
                </button>
              )}
            </div>
          )}
          {item.platforms && (
            // Cards show the first few platforms; the list view shows all.
            <p class="platforms" title={splitList(item.platforms).join(', ')}>
              {splitList(item.platforms).map((name) => (
                <span key={name}>{name}</span>
              ))}
              {splitList(item.platforms).length > 3 && (
                <span class="more">+{splitList(item.platforms).length - 3}</span>
              )}
            </p>
          )}
          {item.tags && (
            <p class="tags">
              {splitList(item.tags).map((name) => (
                <a key={name} href={homeHref({ ...filter, tag: name })}>
                  #{name}
                </a>
              ))}
            </p>
          )}
          <Formatted class="description" text={item.description} />
          <Formatted class="note" text={item.note} />
        </div>
        {/* The step button submits to the form's action; the others name their own.
            Selection mode wraps the list in its own form, so these stay out of it. */}
        {!selecting && (
          <form
            id={`item-${item.id}`}
            method="post"
            action={routes.itemToggle.href({ id: item.id }) + back}
            class="buttons"
            data-rmx-reset-scroll="false"
          >
            <button
              type="submit"
              formaction={routes.itemFavorite.href({ id: item.id }) + back}
              class="fav"
              aria-pressed={item.favorite === 1 ? 'true' : 'false'}
              title={item.favorite === 1 ? 'Remove from favorites' : 'Add to favorites'}
            >
              <span aria-hidden="true">♥</span>
              <span class="sr">Favorite</span>
            </button>
            <button type="submit" class="ghost">
              {NEXT_STEP[item.status]}
            </button>
            {item.status === 'finished' && (
              <button
                type="submit"
                formaction={routes.itemReplay.href({ id: item.id }) + back}
                class="ghost"
              >
                Replay
              </button>
            )}
          </form>
        )}
      </li>
    )
    let list = (entries: Item[]) => (
      <ul class={view === 'list' ? 'list' : 'grid'}>{entries.map(card)}</ul>
    )
    // Grid and list: a panel per franchise, or one ranked panel.
    let sections = timeline
      ? []
      : [...groups].map(([name, entries]) => {
          if (!name) {
            return (
              <section key="" class="group loose" aria-label="Titles without a franchise">
                {list(entries)}
              </section>
            )
          }
          if (sort !== '') {
            return (
              <section key={name} class="group">
                <header>
                  <h2>{name}</h2>
                  <span class="pill">{entries.length} ranked</span>
                </header>
                {list(entries)}
              </section>
            )
          }
          let all = totals.get(name) ?? []
          let done = all.filter((item) => item.status === 'finished').length
          // A franchise of several types lists each type under its own heading.
          let types = [...Map.groupBy(entries, (item) => item.type)].sort(
            ([a], [b]) => TYPES.indexOf(a) - TYPES.indexOf(b),
          )
          return (
            // Served open; entry.ts closes the ones collapsed in this browser.
            <details key={name} class="group" open data-franchise={entries[0].franchise_id}>
              <summary>
                <h2>{name}</h2>
                <span class="pill">
                  {done}/{all.length} finished
                </span>
                <progress value={done} max={all.length} aria-label={`${name} progress`} />
              </summary>
              {types.length > 1
                ? types.map(([value, own]) => (
                    <Fragment key={value}>
                      <h3 class="kind">
                        <i class={`swatch ${value}`} />
                        {TYPE_PLURAL[value]} <span>{own.length}</span>
                      </h3>
                      {list(own)}
                    </Fragment>
                  ))
                : list(entries)}
            </details>
          )
        })

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
                {tag && (
                  <a class="chip" href={homeHref({ ...filter, tag: '' })}>
                    #{tag} <span aria-hidden="true">×</span>
                    <span class="sr">Clear tag filter</span>
                  </a>
                )}
                {platform && (
                  <a class="chip" href={homeHref({ ...filter, platform: '' })}>
                    {platform} <span aria-hidden="true">×</span>
                    <span class="sr">Clear platform filter</span>
                  </a>
                )}
                {rating && (
                  <a class="chip" href={homeHref({ ...filter, rating: '' })}>
                    Rating ≥ {rating} <span aria-hidden="true">×</span>
                    <span class="sr">Clear rating filter</span>
                  </a>
                )}
              </p>
            </div>
            <button type="button" class="primary" popovertarget="add">
              <span aria-hidden="true">+</span> Add title
            </button>
          </header>
          {notice && <p role="status">{notice}</p>}
          {error && <p role="alert">{error}</p>}

          <div class="toolbar">
            <SearchBox action={routes.home.href()} q={q} hidden={activeFilters({ ...filter, q: '' })} />
            {/* The timeline is always in release order. */}
            {!timeline && (
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
            )}
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
              {(Object.keys(VIEWS) as View[]).map((value) => (
                <a
                  key={value}
                  href={homeHref({ ...filter, view: value })}
                  aria-current={view === value ? 'true' : undefined}
                >
                  {VIEWS[value]}
                </a>
              ))}
            </nav>
            {!timeline && (
              <a
                class={selecting ? 'button primary' : 'button'}
                href={homeHref({ ...filter, select: selecting ? '' : '1' })}
              >
                {selecting ? 'Done' : 'Select'}
              </a>
            )}
            {/* A title to do next, of the type shown (see the random action). */}
            <a class="button" href={routes.random.href() + back}>
              Pick for me
            </a>
          </div>

          <nav class="types" aria-label="Filters">
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
            <ListFilters
              action={routes.home.href()}
              platforms={namesIn(items, 'platforms')}
              platform={platform}
              rating={rating}
              hidden={activeFilters({ ...filter, platform: '', rating: '' })}
            />
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

          {upcoming.length > 0 && (
            <section class="group upcoming">
              <header>
                <h2>Upcoming</h2>
                <span class="pill">
                  {upcoming.length} {upcoming.length === 1 ? 'title' : 'titles'}
                </span>
              </header>
              <ul class="compact">
                {upcoming.map((item) => (
                  <Compact key={item.id} item={item}>
                    {formatReleased(item.released ?? '')} ·{' '}
                    <strong>{untilRelease(item.released ?? '', day)}</strong>
                  </Compact>
                ))}
              </ul>
            </section>
          )}

          {panels >= 3 && (
            // These need JavaScript (see entry.ts); without it the CSS hides them.
            <div class="segmented panel-toggles" role="group" aria-label="Franchise panels">
              <button type="button" data-panels="collapse">
                Collapse all
              </button>
              <button type="button" data-panels="expand">
                Expand all
              </button>
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

          {timeline && shown.length > 0 && (
            <section class="group timeline" aria-label="Timeline by release year">
              {[...groups].map(([year, entries]) => (
                <div key={year} class="year">
                  <h2>{year}</h2>
                  <ul class="compact">
                    {entries.map((item) => (
                      <Compact key={item.id} item={item}>
                        {item.franchise}
                      </Compact>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}

          {selecting && shown.length > 0 ? (
            // One form around the whole list: the tick boxes and the bar's
            // actions submit together, with or without JavaScript. Keyed, so
            // after an action it stays the same form, ticks and all, even when
            // a message appears above it.
            <form
              id="bulk"
              method="post"
              action={routes.itemsBulk.href() + back}
              class="bulk"
              data-rmx-key="bulk"
              data-rmx-reset-scroll="false"
            >
              {sections}
              <div class="bulkbar" role="group" aria-label="Bulk actions">
                {/* entry.ts keeps the count and ticks or unticks every title in
                    place; without JavaScript the links ask the server instead. */}
                <p>
                  <strong class="pill" data-selected>
                    {select === 'all' ? shown.length : 0} selected
                  </strong>
                  <a href={homeHref({ ...filter, select: 'all' })} data-select="all">
                    Select all shown
                  </a>
                  <a href={homeHref(filter)} data-select="none">
                    Clear
                  </a>
                </p>
                {/* The form's first button is the one Enter submits: add the tag typed. */}
                <span>
                  <input name="tag" list="tag-names" placeholder="Tag" aria-label="Tag to add" />
                  <button type="submit" name="action" value="tag" class="ghost">
                    Add tag
                  </button>
                </span>
                <span>
                  <select name="status" aria-label="New status">
                    {STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {STATUS_LABEL[value]}
                      </option>
                    ))}
                  </select>
                  <button type="submit" name="action" value="status" class="ghost">
                    Set status
                  </button>
                </span>
                <span>
                  <select name="franchise" aria-label="Franchise to move to">
                    <option value="">No franchise</option>
                    {franchises.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                  <button type="submit" name="action" value="move" class="ghost">
                    Move
                  </button>
                </span>
                <span>
                  <button type="submit" name="action" value="favorite" class="ghost">
                    <span aria-hidden="true">♥</span> Favorite
                  </button>
                  <button type="submit" name="action" value="unfavorite" class="ghost">
                    Unfavorite
                  </button>
                </span>
                <button type="button" class="danger" popovertarget="confirm-bulk-delete">
                  Delete…
                </button>
              </div>
              {/* Deleting asks first; the button that deletes lives in this dialog. */}
              <div id="confirm-bulk-delete" popover="auto" class="dialog confirm">
                <h2>Delete the selected titles?</h2>
                <p>
                  They will be removed from your list, along with their covers. This cannot be
                  undone.
                </p>
                <div class="actions">
                  <button
                    type="button"
                    class="ghost"
                    popovertarget="confirm-bulk-delete"
                    popovertargetaction="hide"
                  >
                    Cancel
                  </button>
                  <button type="submit" name="action" value="delete" class="danger solid">
                    Delete
                  </button>
                </div>
              </div>
            </form>
          ) : (
            sections
          )}

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
              <ItemFields franchises={franchises} tags={namesIn(items, 'tags')} />
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
          {(item.description || item.note) && (
            <div class="about">
              <Formatted class="description" text={item.description} />
              <Formatted class="note" text={item.note} />
            </div>
          )}
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
                <ItemFields item={item} franchises={franchises} tags={namesIn(items, 'tags')} />
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

export function StatsPage(handle: Handle<{ user: User; items: Item[] }>) {
  return () => {
    let { user, items } = handle.props
    let day = today()
    let count = (keep: (item: Item) => boolean) => items.filter(keep).length
    let done = (entries: Item[]) => entries.filter((item) => item.status === 'finished').length
    let rated = items.filter((item) => item.rating !== null)
    let average = (entries: Item[]) =>
      (entries.reduce((sum, item) => sum + (item.rating ?? 0), 0) / entries.length).toFixed(1)
    let ratedTypes = TYPES.map((type) => [type, rated.filter((item) => item.type === type)] as const)
      .filter(([, entries]) => entries.length > 0)
    // Finished titles by the year of their finish date, newest first. A bar is
    // as long as its share of the busiest year.
    let years = [
      ...Map.groupBy(
        items.filter((item) => item.finished_at),
        (item) => (item.finished_at ?? '').slice(0, 4),
      ),
    ].sort(([a], [b]) => b.localeCompare(a))
    let busiest = Math.max(...years.map(([, entries]) => entries.length))
    let dated = count((item) => item.finished_at !== null)
    // Days in progress, from the start date to today.
    let days = (item: Item) => (Date.parse(day) - Date.parse(item.started_at ?? day)) / 86_400_000
    let running = items
      .filter((item) => item.status === 'ongoing' && item.started_at && item.started_at <= day)
      .sort((a, b) => days(b) - days(a))
      .slice(0, 10)
    // The franchises with the most titles first.
    let franchises = [
      ...Map.groupBy(
        items.filter((item) => item.franchise),
        (item) => item.franchise ?? '',
      ),
    ].sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b))

    return (
      <Document title={`Stats — ${APP}`}>
        <Shell user={user} items={items} filter={{}} active="stats">
          <header class="page">
            <div>
              <h1>Stats</h1>
              <p class="muted">Your list in numbers.</p>
            </div>
          </header>

          {items.length === 0 ? (
            <div class="empty">
              <i class="logo" />
              <p>Nothing to count yet. Add a few titles and their numbers show up here.</p>
            </div>
          ) : (
            <>
              <nav class="tiles" aria-label="Titles by type">
                <a href={routes.home.href()}>
                  <strong>{items.length}</strong>
                  <span>All titles</span>
                </a>
                {TYPES.map((type) => (
                  <a key={type} href={homeHref({ type })}>
                    <strong>{count((item) => item.type === type)}</strong>
                    <span>
                      <i class={`swatch ${type}`} />
                      {TYPE_PLURAL[type]}
                    </span>
                  </a>
                ))}
              </nav>
              <nav class="tiles" aria-label="Titles by status">
                {STATUSES.map((status) => (
                  <a key={status} href={homeHref({ status })}>
                    <strong>{count((item) => item.status === status)}</strong>
                    <span>
                      <i class={`state ${status}`} />
                      {STATUS_LABEL[status]}
                    </span>
                  </a>
                ))}
                <a href={homeHref({ favorite: '1' })}>
                  <strong>{count((item) => item.favorite === 1)}</strong>
                  <span>
                    <i class="state favorite" />
                    Favorites
                  </span>
                </a>
                <div>
                  <strong>{items.reduce((sum, item) => sum + item.replays, 0)}</strong>
                  <span>Replays</span>
                </div>
              </nav>

              <div class="stats">
                <section class="group">
                  <header>
                    <h2>Finished per year</h2>
                    <span class="pill">
                      {dated} {dated === 1 ? 'title' : 'titles'}
                    </span>
                  </header>
                  {years.length > 0 ? (
                    <ul class="bars">
                      {years.map(([year, entries]) => (
                        <li key={year}>
                          <span>{year}</span>
                          <i style={{ width: `${Math.round((entries.length / busiest) * 100)}%` }} />
                          <b>{entries.length}</b>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p class="muted">No finished titles yet.</p>
                  )}
                </section>

                <section class="group">
                  <header>
                    <h2>Average rating</h2>
                    {rated.length > 0 && <span class="pill">★ {average(rated)} overall</span>}
                  </header>
                  {rated.length > 0 ? (
                    <ul class="bars">
                      {ratedTypes.map(([type, entries]) => (
                        <li key={type}>
                          <span>
                            {TYPE_PLURAL[type]} <small>({entries.length})</small>
                          </span>
                          <i style={{ width: `${Math.round(Number(average(entries)) * 10)}%` }} />
                          <b>{average(entries)}</b>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p class="muted">No ratings yet.</p>
                  )}
                </section>

                <section class="group wide">
                  <header>
                    <h2>Top rated</h2>
                  </header>
                  {rated.length > 0 ? (
                    <ul class="compact">
                      {rank(rated, 'rating', 'desc')
                        .slice(0, 10)
                        .map((item) => (
                          <Compact key={item.id} item={item}>
                            <span class="rating">★ {item.rating}</span>
                            {item.franchise}
                          </Compact>
                        ))}
                    </ul>
                  ) : (
                    <p class="muted">No ratings yet.</p>
                  )}
                </section>

                <section class="group wide">
                  <header>
                    <h2>Longest running</h2>
                    <span class="pill">{count((item) => item.status === 'ongoing')} in progress</span>
                  </header>
                  {running.length > 0 ? (
                    <ul class="compact">
                      {running.map((item) => (
                        <Compact key={item.id} item={item}>
                          <strong>
                            {days(item)} {days(item) === 1 ? 'day' : 'days'}
                          </strong>{' '}
                          · since {dateFormat.format(new Date(item.started_at ?? day))}
                        </Compact>
                      ))}
                    </ul>
                  ) : (
                    <p class="muted">Nothing in progress with a start date.</p>
                  )}
                </section>

                <section class="group wide">
                  <header>
                    <h2>Franchises</h2>
                    <span class="pill">{franchises.length} with titles</span>
                  </header>
                  {franchises.length > 0 ? (
                    <ul class="bars">
                      {franchises.map(([name, entries]) => (
                        <li key={name}>
                          <a href={homeHref({ franchise: String(entries[0].franchise_id) })}>
                            {name}
                          </a>
                          <progress
                            value={done(entries)}
                            max={entries.length}
                            aria-label={`${name} finished`}
                          />
                          <b>
                            {done(entries)}/{entries.length}
                          </b>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p class="muted">No titles in a franchise yet.</p>
                  )}
                </section>
              </div>
            </>
          )}
        </Shell>
      </Document>
    )
  }
}

export function SettingsPage(
  handle: Handle<{
    user: User
    items: Item[]
    franchises: Franchise[]
    notice?: string
    error?: string
  }>,
) {
  return () => {
    let { user, items, franchises, notice, error } = handle.props
    // The imports from other services can put every title they add in a
    // franchise, an existing one or a new one.
    let franchiseField = () => (
      <label>
        Franchise <span class="muted">(optional · for every title it adds)</span>
        <input name="franchise" list="franchise-names" autocomplete="off" />
      </label>
    )
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

          {/* Other services: these only add, skipping titles already in the list. */}
          <datalist id="franchise-names">
            {franchises.map((franchise) => (
              <option key={franchise.id} value={franchise.name} />
            ))}
          </datalist>
          <section class="panel stack">
            <h2>Import from MyAnimeList</h2>
            <p class="muted">
              Loads an anime or manga list from MyAnimeList’s export file (.xml.gz as downloaded, or
              unpacked): statuses, scores, progress, dates, notes and tags. Titles already in your
              list are skipped.
            </p>
            <form
              method="post"
              action={routes.importMal.href()}
              enctype="multipart/form-data"
              class="stack"
              data-rmx-document
            >
              <label>
                Export file
                <input
                  name="file"
                  type="file"
                  accept=".xml,.gz,application/xml,text/xml,application/gzip"
                  required
                />
              </label>
              {franchiseField()}
              <div>
                <button type="submit" class="primary">
                  Import
                </button>
              </div>
            </form>
          </section>

          <section class="panel stack">
            <h2>Import a CSV file</h2>
            <p class="muted">
              A spreadsheet saved as CSV, its first row naming the columns: title (required), type,
              status, franchise, released, platforms, rating, progress, progress_total,
              progress_unit, started_at, finished_at, note, description, tags. Other columns are
              ignored. Dates are written 2024-01-31; a title without a status is planned. Titles
              already in your list are skipped.
            </p>
            <form
              method="post"
              action={routes.importCsv.href()}
              enctype="multipart/form-data"
              class="stack"
              data-rmx-document
            >
              <label>
                CSV file
                <input name="file" type="file" accept=".csv,text/csv" required />
              </label>
              <label>
                Type <span class="muted">(for rows without one)</span>
                <select name="type">
                  <option value="">None: every row names its type</option>
                  {TYPES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              {franchiseField()}
              <div>
                <button type="submit" class="primary">
                  Import
                </button>
              </div>
            </form>
          </section>

          <section class="panel stack">
            <h2>Import from Steam</h2>
            <p class="muted">
              Adds the games a Steam account owns, with hours played as progress and their covers.
              It needs a{' '}
              <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener">
                Steam Web API key
              </a>{' '}
              and the account’s SteamID64, and the profile’s game details must be public. Both are
              used for this one request and not stored. A large library takes a while.
            </p>
            <form method="post" action={routes.importSteam.href()} class="stack" data-rmx-document>
              <label>
                Steam Web API key
                <input name="key" type="password" autocomplete="off" required />
              </label>
              <label>
                SteamID64 <span class="muted">(17 digits)</span>
                <input
                  name="steam_id"
                  inputmode="numeric"
                  pattern="\d{17}"
                  title="The 17-digit SteamID64"
                  autocomplete="off"
                  required
                />
              </label>
              {franchiseField()}
              <div>
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

// A title's cover image, or its first letter, with the status mark on the corner.
function Cover(handle: Handle<{ item: Item }>) {
  return () => {
    let { item } = handle.props
    return (
      <a class={`cover ${item.type}`} href={routes.itemEdit.href({ id: item.id })}>
        {item.cover ? (
          <img src={routes.covers.href({ file: item.cover })} alt="" loading="lazy" />
        ) : (
          <span aria-hidden="true">{item.title.slice(0, 1)}</span>
        )}
        <i class={`state ${item.status}`} title={STATUS_LABEL[item.status]} />
      </a>
    )
  }
}

// A small card for the timeline and the upcoming panel: the cover beside the
// title, its type and one more line.
function Compact(handle: Handle<{ item: Item; children?: RemixNode }>) {
  return () => {
    let { item, children } = handle.props
    return (
      <li>
        <Cover item={item} />
        <div class="title">
          <a href={routes.itemEdit.href({ id: item.id })}>{item.title}</a>
          <small>
            <span class={`tag ${item.type}`}>{item.type}</span>
            {children}
          </small>
        </div>
      </li>
    )
  }
}

// A description or note, through the little markdown formatter. The only raw
// HTML on the pages: markdown() escapes the text before adding its own tags.
function Formatted(handle: Handle<{ class: string; text: string | null }>) {
  return () => {
    let { text } = handle.props
    return text ? <div class={handle.props.class} innerHTML={unsafeHTML(markdown(text))} /> : null
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
    active?: 'home' | 'franchises' | 'stats' | 'settings'
    children?: RemixNode
  }>,
) {
  return () => {
    let { user, items, filter, active, children } = handle.props
    let { status, favorite } = filter
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
            <a href={routes.stats.href()} aria-current={active === 'stats' ? 'page' : undefined}>
              Stats
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
            <a
              href={homeHref({ ...filter, status: '', favorite: '' })}
              aria-current={current(!status && !favorite)}
            >
              <i class="state all" />
              All
              <span>{items.length}</span>
            </a>
            {STATUSES.map((value) => (
              <a
                key={value}
                href={homeHref({ ...filter, status: value, favorite: '' })}
                aria-current={current(status === value && !favorite)}
              >
                <i class={`state ${value}`} />
                {STATUS_LABEL[value]}
                <span>{count(value)}</span>
              </a>
            ))}
            {/* One more choice in this list: picking it or a status clears the other. */}
            <a
              href={homeHref({ ...filter, status: '', favorite: '1' })}
              aria-current={current(!!favorite)}
            >
              <i class="state favorite" />
              Favorites
              <span>{items.filter((item) => item.favorite === 1).length}</span>
            </a>
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

function ItemFields(handle: Handle<{ item?: Item; franchises: Franchise[]; tags: string[] }>) {
  return () => {
    let { item, franchises, tags } = handle.props
    return (
      <>
        <div class="wide">
          <label for="title">Title</label>
          <TitleLookup id="title" value={item?.title ?? ''} href={routes.lookupTitle.href()} />
        </div>
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
          Rating <span class="muted">(optional · 1–10)</span>
          <input name="rating" type="number" min={1} max={10} step={1} value={item?.rating ?? ''} />
        </label>
        <label>
          Start date <span class="muted">(optional)</span>
          <input name="started_at" type="date" value={item?.started_at ?? ''} />
        </label>
        <label>
          Finish date <span class="muted">(empty = today)</span>
          <input name="finished_at" type="date" value={item?.finished_at ?? ''} />
        </label>
        <label>
          Progress
          <input name="progress" type="number" min={0} step={1} value={item?.progress ?? 0} />
        </label>
        <label>
          Total <span class="muted">(optional)</span>
          <input
            name="progress_total"
            type="number"
            min={1}
            step={1}
            value={item?.progress_total ?? ''}
          />
        </label>
        <label>
          Unit <span class="muted">(optional · adds a +1 button)</span>
          {/* The placeholder follows the type picked above (see entry.ts). */}
          <input
            name="progress_unit"
            value={item?.progress_unit ?? ''}
            placeholder={UNIT_HINT[item?.type ?? TYPES[0]]}
            data-hints={JSON.stringify(UNIT_HINT)}
          />
        </label>
        <label>
          Replays <span class="muted">(times through again)</span>
          <input name="replays" type="number" min={0} step={1} value={item?.replays ?? 0} />
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
        <label class="check">
          <input name="favorite" type="checkbox" checked={item?.favorite === 1} /> Favorite
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
          Tags <span class="muted">(optional · separated by commas)</span>
          <input name="tags" value={item?.tags ?? ''} list="tag-names" placeholder="cozy, rewatch" />
          <datalist id="tag-names">
            {tags.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
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
