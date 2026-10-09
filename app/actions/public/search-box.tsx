import { clientEntry, on } from 'remix/component'
import type { Handle } from 'remix/component'

interface SearchBoxProps {
  action: string
  q: string
  // The other active filters, resubmitted along with the search.
  hidden: Record<string, string>
}

// A plain GET search form. In the browser it also submits itself shortly after
// each keystroke, so the list filters while typing; without JavaScript, Enter works.
export const SearchBox = clientEntry(
  import.meta.url,
  function SearchBox(handle: Handle<SearchBoxProps>) {
    let timer: ReturnType<typeof setTimeout> | undefined

    return () => {
      let { action, q, hidden } = handle.props
      return (
        <form
          method="get"
          action={action}
          role="search"
          class="search"
          data-rmx-history="replace"
          data-rmx-reset-scroll="false"
        >
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search titles…"
            aria-label="Search titles"
            autocomplete="off"
            mix={on('input', (event) => {
              let input = event.currentTarget
              clearTimeout(timer)
              timer = setTimeout(() => {
                // The browser moves focus to the page once a navigation finishes;
                // hand it straight back so typing can continue.
                let navigation = (window as { navigation?: EventTarget }).navigation
                navigation?.addEventListener('navigatesuccess', () => input.focus(), { once: true })
                input.form?.requestSubmit()
              }, 200)
            })}
          />
        </form>
      )
    }
  },
)
