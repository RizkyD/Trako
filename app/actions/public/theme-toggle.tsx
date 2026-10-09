import { clientEntry, on } from 'remix/component'
import type { Handle } from 'remix/component'

const CHOICES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: '☀ Light' },
  { value: 'dark', label: '☾ Dark' },
] as const
type Choice = (typeof CHOICES)[number]['value']

// Picks the colour theme. A light or dark choice is kept in localStorage and
// applied as <html data-theme>, which /theme.js also does before first paint on
// every page load; "System" clears it so the app follows the device setting.
export const ThemePicker = clientEntry(import.meta.url, function ThemePicker(handle: Handle) {
  // Unknown while rendering on the server; read once the browser has the page.
  let current: Choice | undefined

  handle.queueTask(() => {
    // Read the stored choice itself: <html data-theme> is briefly absent while
    // an in-app navigation re-renders the page.
    let stored: string | null = null
    try {
      stored = localStorage.getItem('theme')
    } catch {
      // Storage blocked: nothing is saved, so the app is following the system.
    }
    current = stored === 'light' || stored === 'dark' ? stored : 'system'
    handle.update()
  })

  let choose = (choice: Choice) => {
    current = choice
    // Storage first: /theme.js keeps <html data-theme> in step with what is stored.
    try {
      if (choice === 'system') localStorage.removeItem('theme')
      else localStorage.setItem('theme', choice)
    } catch {
      // Storage can be blocked; the choice still applies to this page.
    }
    if (choice === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = choice
    handle.update()
  }

  return () => (
    <div class="segmented" role="group" aria-label="Theme">
      {CHOICES.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={current === value}
          mix={on('click', () => choose(value))}
        >
          {label}
        </button>
      ))}
    </div>
  )
})
