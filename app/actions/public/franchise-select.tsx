import { clientEntry, on } from 'remix/component'
import type { Handle } from 'remix/component'

interface FranchiseSelectProps {
  id: string
  names: string[]
  value: string
  // Regular expression source that only matches existing names.
  pattern?: string
}

const NONE = 'No franchise'

// Franchise picker: a text field that opens the full list on focus and narrows
// it while typing. Without JavaScript it is a plain validated text field.
export const FranchiseSelect = clientEntry(
  import.meta.url,
  function FranchiseSelect(handle: Handle<FranchiseSelectProps>) {
    let value = handle.props.value
    let open = false
    // Text the list is narrowed by; empty right after opening so every name shows.
    let query = ''
    let active = 0

    return () => {
      let { id, names, pattern } = handle.props
      let listId = `${id}-list`
      let matches = names.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()))
      // The empty name stands for "no franchise" and is always offered first.
      let options = ['', ...matches]

      let show = () => {
        if (open) return
        open = true
        query = ''
        // Highlight the current choice in the full, unfiltered list.
        active = Math.max(0, ['', ...names].indexOf(value))
        handle.update()
      }
      let choose = (name: string) => {
        value = name
        open = false
        handle.update()
      }

      return (
        <div class="combo">
          <input
            id={id}
            name="franchise"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            autocomplete="off"
            value={value}
            pattern={pattern}
            title="Pick an existing franchise, or leave it empty"
            placeholder={names.length ? 'Pick one or type to search…' : 'No franchises yet'}
            disabled={names.length === 0}
            mix={[
              on('focus', show),
              on('click', show),
              on('input', (event) => {
                value = event.currentTarget.value
                query = value
                open = true
                active = value ? 1 : 0
                handle.update()
              }),
              on('keydown', (event) => {
                if (event.key === 'Escape') {
                  if (!open) return
                  event.preventDefault()
                  open = false
                } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  if (!open) return show()
                  let step = event.key === 'ArrowDown' ? 1 : -1
                  active = (active + step + options.length) % options.length
                } else if (event.key === 'Enter' && open) {
                  // Enter picks the highlighted name instead of submitting the form.
                  event.preventDefault()
                  return choose(options[Math.min(active, options.length - 1)])
                } else {
                  return
                }
                handle.update()
              }),
              on('blur', () => {
                // Typed text snaps to the stored spelling of the franchise it names.
                let typed = value.trim().toLowerCase()
                value = names.find((name) => name.toLowerCase() === typed) ?? value.trim()
                open = false
                handle.update()
              }),
            ]}
          />
          {open && (
            <ul id={listId} role="listbox">
              {options.map((name, index) => (
                <li
                  key={name}
                  role="option"
                  aria-selected={name === value}
                  class={index === active ? 'active' : undefined}
                  // pointerdown, not click: it runs before the field loses focus.
                  mix={on('pointerdown', (event) => {
                    event.preventDefault()
                    choose(name)
                  })}
                >
                  {name || NONE}
                </li>
              ))}
              {matches.length === 0 && <li class="none">No matching franchise</li>}
            </ul>
          )}
        </div>
      )
    }
  },
)
