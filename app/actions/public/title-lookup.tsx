import { clientEntry, on } from 'remix/component'
import type { Handle } from 'remix/component'

import type { Candidate } from '../../lookup.ts'

interface TitleLookupProps {
  id: string
  value: string
  // The lookup route.
  href: string
}

const SOURCE = { wikipedia: 'Wikipedia', anilist: 'AniList' }
// The fields a picked match fills in, when they are still empty.
const FIELDS = ['released', 'platforms', 'description', 'progress_total', 'progress_unit', 'tags'] as const

// The title field, with a "Fetch details" button that looks the title up and
// lists the matches; picking one fills in the form's empty fields and offers its
// cover. The button needs JavaScript, so it only shows once the page has it.
export const TitleLookup = clientEntry(
  import.meta.url,
  function TitleLookup(handle: Handle<TitleLookupProps>) {
    let title = handle.props.value
    let ready = false
    handle.queueTask(() => {
      ready = true
      handle.update()
    })
    let searching = false
    let failed = false
    // Null until a lookup answers, and again once a match is picked.
    let matches: Candidate[] | null = null
    let cover: { url: string; source: string } | null = null

    let pick = (form: HTMLFormElement | null, match: Candidate) => {
      for (let name of FIELDS) {
        let field = form?.elements.namedItem(name)
        let value = match[name]
        // Only into empty fields: what was typed stays.
        if (
          (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) &&
          !field.value.trim() &&
          value !== null
        ) {
          field.value = String(value)
        }
      }
      if (match.cover_url) cover = { url: match.cover_url, source: SOURCE[match.source] }
      matches = null
      handle.update()
    }

    return () => (
      <div class="lookup">
        <div>
          <input
            id={handle.props.id}
            name="title"
            value={title}
            required
            mix={on('input', (event) => {
              title = event.currentTarget.value
              handle.update()
            })}
          />
          {ready && (
            <button
              type="button"
              class="ghost"
              disabled={!title.trim() || searching}
              mix={on('click', async (event, signal) => {
                let type = event.currentTarget.form?.elements.namedItem('type')
                let query = new URLSearchParams({
                  q: title.trim(),
                  type: type instanceof HTMLSelectElement ? type.value : '',
                })
                searching = true
                failed = false
                matches = null
                handle.update()
                try {
                  let response = await fetch(`${handle.props.href}?${query}`, { signal })
                  if (!response.ok) throw new Error(`Lookup answered ${response.status}`)
                  matches = await response.json()
                } catch {
                  failed = true
                }
                if (signal.aborted) return
                searching = false
                handle.update()
              })}
            >
              {searching ? 'Searching…' : 'Fetch details'}
            </button>
          )}
        </div>
        {failed && <p class="muted">Lookup failed. Try again in a moment.</p>}
        {matches?.length === 0 && <p class="muted">Nothing found.</p>}
        {matches && matches.length > 0 && (
          <ul aria-label="Matches">
            {matches.map((match, index) => (
              <li key={index}>
                <button
                  type="button"
                  mix={on('click', (event) => pick(event.currentTarget.form, match))}
                >
                  {match.title}
                  <small>
                    {SOURCE[match.source]}
                    {match.released && ` · ${match.released.slice(0, 4)}`}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        )}
        {cover && (
          <p class="picked">
            <input type="hidden" name="cover_url" value={cover.url} />
            <img src={cover.url} alt="" />
            <span>Cover from {cover.source}</span>
            <button
              type="button"
              class="ghost"
              mix={on('click', () => {
                cover = null
                handle.update()
              })}
            >
              Clear
            </button>
          </p>
        )}
      </div>
    )
  },
)
