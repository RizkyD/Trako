import { clientEntry, on } from 'remix/component'
import type { Handle } from 'remix/component'

interface ListFiltersProps {
  action: string
  // Every platform in the list.
  platforms: string[]
  platform: string
  rating: string
  // The other active filters, resubmitted along with these.
  hidden: Record<string, string>
}

const RATINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

// The platform and minimum-rating filters: a plain GET form. In the browser
// picking an option submits it; without JavaScript its Apply button does.
// Rendered here rather than on the server so the picked options follow the
// page after every navigation.
export const ListFilters = clientEntry(
  import.meta.url,
  function ListFilters(handle: Handle<ListFiltersProps>) {
    return () => {
      let { action, platforms, platform, rating, hidden } = handle.props
      let picked = (name: string) => name.toLowerCase() === platform.toLowerCase()
      // A platform no title has any more (an old link) still shows as picked.
      let names = platform && !platforms.some(picked) ? [platform, ...platforms] : platforms
      return (
        <form
          method="get"
          action={action}
          class="list-filters"
          mix={on('change', (event) => {
            // As in the search box: focus goes back to the select once the list is in.
            let select = event.target
            let navigation = (window as { navigation?: EventTarget }).navigation
            if (select instanceof HTMLSelectElement) {
              navigation?.addEventListener('navigatesuccess', () => select.focus(), { once: true })
            }
            event.currentTarget.requestSubmit()
          })}
        >
          {Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <select name="platform" aria-label="Platform">
            <option value="" selected={!platform}>
              All platforms
            </option>
            {names.map((name) => (
              <option key={name} value={name} selected={picked(name)}>
                {name}
              </option>
            ))}
          </select>
          <select name="rating" aria-label="Minimum rating">
            <option value="" selected={!rating}>
              Any rating
            </option>
            {RATINGS.map((value) => (
              <option key={value} value={value} selected={String(value) === rating}>
                Rating ≥ {value}
              </option>
            ))}
          </select>
          <button type="submit" class="ghost">
            Apply
          </button>
        </form>
      )
    }
  },
)
