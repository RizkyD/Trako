import * as assert from 'remix/assert'
import { render } from 'remix/component/test'
import { describe, it, type TestContext } from 'remix/test'

// Its listeners work on whatever the page holds, so each test mounts the bit of
// page it needs, marked up as pages.tsx serves it.
import './public/enhancements.ts'

function mount(t: TestContext, node: Parameters<typeof render>[0]) {
  let result = render(node)
  t.after(result.cleanup)
  return result
}

// A panel's `toggle` event comes a moment after it opens or closes.
let toggled = (panel: HTMLElement) => new Promise((resolve) => panel.addEventListener('toggle', resolve, { once: true }))
// Mutation observers run a moment after the change.
let settled = () => new Promise((resolve) => setTimeout(resolve))
let remembered = () => JSON.parse(localStorage.getItem('collapsed-franchises') ?? '[]')

describe('enhancements', () => {
  it('counts the ticked titles, also when all are picked or cleared', async (t) => {
    let { $, $$ } = mount(
      t,
      <form id="bulk">
        <input type="checkbox" name="id" value="1" />
        <input type="checkbox" name="id" value="2" />
        <p>
          <strong data-selected>0 selected</strong>
          <a href="/?select=all" data-select="all">
            Select all shown
          </a>
          <a href="/" data-select="none">
            Clear
          </a>
        </p>
      </form>,
    )
    let boxes = [...$$('input[name="id"]')] as HTMLInputElement[]
    let count = () => $('[data-selected]')?.textContent
    boxes[0].click()
    assert.equal(count(), '1 selected')
    // The links tick or untick every title in place instead of loading the list.
    $('[data-select="all"]')?.click()
    assert.deepEqual(boxes.map((box) => box.checked), [true, true])
    assert.equal(count(), '2 selected')
    $('[data-select="none"]')?.click()
    assert.deepEqual(boxes.map((box) => box.checked), [false, false])
    assert.equal(count(), '0 selected')

    // A navigation brings the server's count back; the ticks stay, and are counted again.
    boxes[1].click()
    let served = document.createElement('strong')
    served.setAttribute('data-selected', '')
    served.textContent = '0 selected'
    $('[data-selected]')?.replaceWith(served)
    await settled()
    assert.equal(served.textContent, '1 selected')
  })

  it('remembers collapsed franchise panels when the page is rendered again', async (t) => {
    t.after(() => localStorage.removeItem('collapsed-franchises'))
    let { $ } = mount(
      t,
      <div>
        <details open data-franchise="7">
          <summary>Trails</summary>
        </details>
        <details open data-franchise="8">
          <summary>Ys</summary>
        </details>
      </div>,
    )
    await settled()
    let panel = $('[data-franchise="7"]') as HTMLDetailsElement
    panel.open = false
    await toggled(panel)
    assert.deepEqual(remembered(), ['7'])

    // The next page arrives with every panel open; the collapsed one closes again.
    let served = document.createElement('details')
    served.open = true
    served.dataset.franchise = '7'
    panel.replaceWith(served)
    await settled()
    assert.equal(served.open, false)
    assert.equal(($('[data-franchise="8"]') as HTMLDetailsElement).open, true)

    // Opening it again forgets it.
    served.open = true
    await toggled(served)
    assert.deepEqual(remembered(), [])
  })

  it('collapses and expands every panel at once, and remembers that', async (t) => {
    t.after(() => localStorage.removeItem('collapsed-franchises'))
    let { $, $$ } = mount(
      t,
      <div>
        <button type="button" data-panels="collapse">
          Collapse all
        </button>
        <button type="button" data-panels="expand">
          Expand all
        </button>
        <details open data-franchise="21">
          <summary>Trails</summary>
        </details>
        <details open data-franchise="22">
          <summary>Ys</summary>
        </details>
      </div>,
    )
    await settled()
    let panels = [...$$('details')] as HTMLDetailsElement[]
    $('[data-panels="collapse"]')?.click()
    assert.deepEqual(panels.map((panel) => panel.open), [false, false])
    await Promise.all(panels.map(toggled))
    assert.deepEqual(remembered().sort(), ['21', '22'])
    $('[data-panels="expand"]')?.click()
    assert.deepEqual(panels.map((panel) => panel.open), [true, true])
    await Promise.all(panels.map(toggled))
    assert.deepEqual(remembered(), [])
  })

  it('closes an open dialog when a navigation starts', async (t) => {
    let { $ } = mount(
      t,
      <div id="confirm-delete" popover="auto">
        Delete this title?
      </div>,
    )
    let dialog = $('#confirm-delete') as HTMLElement
    dialog.showPopover()
    assert.ok(dialog.matches(':popover-open'))
    // Any navigation will do; a hash change stays on this page.
    location.hash = 'elsewhere'
    assert.equal(dialog.matches(':popover-open'), false)
  })

  it('suggests a progress unit that fits the type picked', async (t) => {
    let { $ } = mount(
      t,
      <form>
        <select name="type">
          <option value="game">game</option>
          <option value="manga">manga</option>
          <option value="film">film</option>
        </select>
        <input name="progress_unit" placeholder="hours" data-hints={JSON.stringify({ game: 'hours', manga: 'chapters', film: '' })} />
      </form>,
    )
    let select = $('select') as HTMLSelectElement
    let unit = $('input') as HTMLInputElement
    let pick = (type: string) => {
      select.value = type
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    pick('manga')
    assert.equal(unit.placeholder, 'chapters')
    pick('film')
    assert.equal(unit.placeholder, '')
  })
})
