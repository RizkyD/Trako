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

// Close open dialogs before an in-app navigation re-renders the page. Otherwise
// an open popover element can be reused for the next page's content and stay
// floating in the top layer (e.g. after confirming a delete).
;(window as { navigation?: EventTarget }).navigation?.addEventListener('navigate', () => {
  for (let popover of document.querySelectorAll<HTMLElement>(':popover-open')) {
    popover.hidePopover()
  }
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
