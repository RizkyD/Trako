import {
  detectMultipleImportMapSupport,
  importModule,
  preloadShim,
} from 'remix/multiple-import-maps-polyfill'
import { run } from 'remix/component'

const app = run({
  async loadModule(moduleUrl, exportName) {
    let mod = await importModule(moduleUrl)
    let Component = mod[exportName]
    if (typeof Component !== 'function') {
      throw new Error(`Unknown component: ${moduleUrl}#${exportName}`)
    }
    return Component
  },
  async processClientEntryPreloads(preloads) {
    if (await detectMultipleImportMapSupport()) return preloads

    preloadShim(preloads)
    return []
  },
})

// Fonts, styles and icons are kept by a service worker (public/sw.js). Browsers
// only run one over https:// or on localhost; over plain http there is none.
navigator.serviceWorker?.register('/sw.js')

// Close open dialogs before an in-app navigation re-renders the page. Otherwise
// an open popover element can be reused for the next page's content and stay
// floating in the top layer (e.g. after confirming a delete).
;(window as { navigation?: EventTarget }).navigation?.addEventListener('navigate', () => {
  for (let popover of document.querySelectorAll<HTMLElement>(':popover-open')) {
    popover.hidePopover()
  }
})

// Franchise panels are <details>, always served open (so they stay open without
// JavaScript). This browser remembers which franchises were collapsed.
let collapsed = new Set<string>()
try {
  collapsed = new Set(JSON.parse(localStorage.getItem('collapsed-franchises') ?? '[]'))
} catch {
  // Storage blocked or unreadable: every panel starts open.
}
let panels = () => document.querySelectorAll<HTMLDetailsElement>('details[data-franchise]')
let restorePanels = () => {
  for (let panel of panels()) panel.open = !collapsed.has(panel.dataset.franchise ?? '')
}
restorePanels()

// Selection mode on the Titles page: the bar counts the ticked titles.
let ticks = () => document.querySelectorAll<HTMLInputElement>('#bulk input[name="id"]')
let countSelected = () => {
  let text = `${[...ticks()].filter((box) => box.checked).length} selected`
  for (let count of document.querySelectorAll('[data-selected]')) {
    // Only when it differs: this runs after every page update, its own included.
    if (count.textContent !== text) count.textContent = text
  }
}
countSelected()
document.addEventListener('change', countSelected)
// "Select all shown" and "Clear" tick or untick every title in place; without
// JavaScript they are links to the list served that way.
document.addEventListener('click', (event) => {
  let link = event.target instanceof Element ? event.target.closest('[data-select]') : null
  if (!link) return
  event.preventDefault()
  for (let box of ticks()) box.checked = link.getAttribute('data-select') === 'all'
  countSelected()
})

// Each page a navigation brings in arrives with its panels open and the
// server's count (ticks survive it); close the remembered panels and recount
// before it is painted.
new MutationObserver(() => {
  restorePanels()
  countSelected()
}).observe(document.body, {
  childList: true,
  subtree: true,
  attributeFilter: ['data-franchise'],
})
// `toggle` does not bubble, hence the capture.
document.addEventListener(
  'toggle',
  (event) => {
    let panel = event.target
    if (!(panel instanceof HTMLDetailsElement) || !panel.dataset.franchise) return
    if (panel.open) collapsed.delete(panel.dataset.franchise)
    else collapsed.add(panel.dataset.franchise)
    try {
      localStorage.setItem('collapsed-franchises', JSON.stringify([...collapsed]))
    } catch {
      // Storage blocked: the panel still toggles, it is just not remembered.
    }
  },
  true,
)
// Collapse all / Expand all; the toggle listener above remembers the result.
document.addEventListener('click', (event) => {
  let button = event.target instanceof Element ? event.target.closest('[data-panels]') : null
  if (!button) return
  for (let panel of panels()) panel.open = button.getAttribute('data-panels') === 'expand'
})

// The progress unit field suggests a unit that fits the type picked in its form.
document.addEventListener('change', (event) => {
  let select = event.target
  if (!(select instanceof HTMLSelectElement) || select.name !== 'type') return
  let unit = select.form?.elements.namedItem('progress_unit')
  if (unit instanceof HTMLInputElement && unit.dataset.hints) {
    unit.placeholder = JSON.parse(unit.dataset.hints)[select.value] ?? ''
  }
})

if (import.meta.hot) {
  import.meta.hot.on('server:update', async () => {
    try {
      await app.ready()
      await app.frames.top.reload()
    } catch (error) {
      console.error('Error reloading top frame on server update', error)
    }
  })
}
