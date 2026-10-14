import * as assert from 'remix/assert'
import { render } from 'remix/component/test'
import { describe, it, type TestContext } from 'remix/test'

import { FranchiseSelect } from './public/franchise-select.tsx'
import { ImageInput } from './public/image-input.tsx'
import { ListFilters } from './public/list-filters.tsx'
import { SearchBox } from './public/search-box.tsx'
import { ThemePicker } from './public/theme-toggle.tsx'
import { TitleLookup } from './public/title-lookup.tsx'

// Mounts a component for one test, unmounted when it ends.
function mount(t: TestContext, node: Parameters<typeof render>[0]) {
  let result = render(node)
  t.after(result.cleanup)
  return result
}

// Types into a field as a keystroke would: new value, then an input event.
function type(field: HTMLInputElement, text: string) {
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

// Stops a form's submissions, which would navigate the test away, and keeps the
// query each one would have asked for.
function submissions(form: HTMLFormElement) {
  let queries: string[] = []
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    queries.push(new URLSearchParams([...new FormData(form)] as string[][]).toString())
  })
  return queries
}

// Waits for a component's async work (a fetch, decoding a picture) to show.
async function until(check: () => unknown) {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.ok(check(), 'timed out')
}

describe('SearchBox', () => {
  it('submits the search once, 200 ms after the last keystroke, with the other filters', async (t) => {
    let timers = t.useFakeTimers()
    let { $, act } = mount(t, <SearchBox action="/" q="" hidden={{ status: 'finished' }} />)
    let input = $('input[type="search"]') as HTMLInputElement
    let queries = submissions($('form') as HTMLFormElement)

    await act(() => type(input, 'h'))
    timers.advance(150)
    await act(() => type(input, 'ha'))
    timers.advance(199)
    assert.deepEqual(queries, [])
    timers.advance(1)
    assert.deepEqual(queries, ['status=finished&q=ha'])
    timers.advance(1000)
    assert.equal(queries.length, 1)
  })

  it('hands focus back to the field once the list it asked for is in', async (t) => {
    let timers = t.useFakeTimers()
    let { $, act } = mount(t, <SearchBox action="/" q="" hidden={{}} />)
    let input = $('input[type="search"]') as HTMLInputElement
    submissions($('form') as HTMLFormElement)
    input.focus()
    await act(() => type(input, 'ys'))
    timers.advance(200)
    // The browser moves focus to the page when a navigation ends.
    input.blur()
    assert.notEqual(document.activeElement, input)
    ;(window as unknown as { navigation: EventTarget }).navigation.dispatchEvent(new Event('navigatesuccess'))
    assert.equal(document.activeElement, input)
  })
})

describe('FranchiseSelect', () => {
  // The edit form's franchise field, as pages.tsx renders it for these franchises.
  let field = (t: TestContext, value = '') => {
    let result = mount(
      t,
      <FranchiseSelect id="franchise" names={['Persona', 'Trails', 'Ys']} value={value} pattern="Persona|Trails|Ys" />,
    )
    let input = result.$('input') as HTMLInputElement
    let options = () => [...result.$$('[role="option"]')].map((option) => option.textContent)
    let highlighted = () => result.$('[role="option"].active')?.textContent
    let open = () => input.getAttribute('aria-expanded') === 'true'
    let press = async (key: string) => {
      let event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      await result.act(() => input.dispatchEvent(event))
      return event
    }
    // The events themselves: focus() and blur() fire none while the browser
    // window is in the background.
    let focus = () => result.act(() => input.dispatchEvent(new FocusEvent('focus')))
    let blur = () => result.act(() => input.dispatchEvent(new FocusEvent('blur')))
    return { ...result, input, options, highlighted, open, press, focus, blur }
  }

  it('opens the whole list on focus, with the current name highlighted', async (t) => {
    let { options, highlighted, open, focus } = field(t, 'Trails')
    assert.equal(open(), false)
    await focus()
    assert.ok(open())
    assert.deepEqual(options(), ['No franchise', 'Persona', 'Trails', 'Ys'])
    assert.equal(highlighted(), 'Trails')
  })

  it('narrows the list while typing, and Enter picks the highlighted name', async (t) => {
    let { $, act, input, options, highlighted, open, press, focus } = field(t)
    await focus()
    await act(() => type(input, 'A'))
    assert.deepEqual(options(), ['No franchise', 'Persona', 'Trails'])
    assert.equal(highlighted(), 'Persona')
    await press('ArrowDown')
    assert.equal(highlighted(), 'Trails')
    let enter = await press('Enter')
    assert.ok(enter.defaultPrevented, 'Enter picks instead of submitting the form')
    assert.equal(input.value, 'Trails')
    assert.equal(open(), false)
    // Nothing matching: only "No franchise", and a line saying so.
    await act(() => type(input, 'zz'))
    assert.deepEqual(options(), ['No franchise'])
    assert.equal($('li.none')?.textContent, 'No matching franchise')
  })

  it('closes on Escape', async (t) => {
    let { $, open, press, focus } = field(t)
    await focus()
    assert.ok(open())
    let escape = await press('Escape')
    assert.ok(escape.defaultPrevented)
    assert.equal(open(), false)
    assert.equal($('[role="listbox"]'), null)
  })

  it('snaps typed text to the stored spelling on blur', async (t) => {
    let { act, input, open, focus, blur } = field(t)
    await focus()
    await act(() => type(input, 'persona '))
    await blur()
    assert.equal(input.value, 'Persona')
    assert.equal(open(), false)
    assert.ok(input.checkValidity())
  })

  it('leaves a name that is no franchise as typed, and invalid', async (t) => {
    let { act, input, focus, blur } = field(t)
    await focus()
    await act(() => type(input, 'Persona 6'))
    await blur()
    assert.equal(input.value, 'Persona 6')
    assert.equal(input.checkValidity(), false)
    // Empty is fine: no franchise.
    await act(() => type(input, ''))
    assert.ok(input.checkValidity())
  })
})

describe('ThemePicker', () => {
  let forget = () => {
    localStorage.removeItem('theme')
    delete document.documentElement.dataset.theme
  }
  let picker = async (t: TestContext) => {
    let { $$, act } = mount(t, <ThemePicker />)
    // The stored choice is read once the component is in the page.
    await act(() => {})
    let buttons = () => [...$$('button')]
    let pressed = () => buttons().filter((button) => button.getAttribute('aria-pressed') === 'true').map((button) => button.textContent)
    let choose = (label: string) => act(() => buttons().find((button) => button.textContent?.endsWith(label))?.click())
    return { pressed, choose }
  }

  it('applies and remembers Light or Dark; System clears both', async (t) => {
    forget()
    t.after(forget)
    let { pressed, choose } = await picker(t)
    assert.deepEqual(pressed(), ['System'])
    await choose('Dark')
    assert.equal(document.documentElement.dataset.theme, 'dark')
    assert.equal(localStorage.getItem('theme'), 'dark')
    assert.deepEqual(pressed(), ['☾ Dark'])
    await choose('Light')
    assert.equal(document.documentElement.dataset.theme, 'light')
    assert.equal(localStorage.getItem('theme'), 'light')
    await choose('System')
    assert.equal(document.documentElement.dataset.theme, undefined)
    assert.equal(localStorage.getItem('theme'), null)
    assert.deepEqual(pressed(), ['System'])
  })

  it('shows the choice stored earlier', async (t) => {
    forget()
    t.after(forget)
    localStorage.setItem('theme', 'dark')
    let { pressed } = await picker(t)
    assert.deepEqual(pressed(), ['☾ Dark'])
  })
})

describe('ListFilters', () => {
  it('submits as soon as an option is picked, along with the other filters', async (t) => {
    let { $, act } = mount(
      t,
      <ListFilters action="/" platforms={['PSP', 'Windows']} platform="" rating="" hidden={{ status: 'finished' }} />,
    )
    let form = $('form') as HTMLFormElement
    let queries = submissions(form)
    let pick = (name: string, value: string) =>
      act(() => {
        let select = form.elements.namedItem(name) as HTMLSelectElement
        select.value = value
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
    await pick('platform', 'Windows')
    await pick('rating', '8')
    assert.deepEqual(queries, ['status=finished&platform=Windows&rating=', 'status=finished&platform=Windows&rating=8'])
  })

  it('shows the platform picked, in any case, even one no title has any more', async (t) => {
    let picked = (platform: string) => {
      let { $ } = mount(t, <ListFilters action="/" platforms={['PSP', 'Windows']} platform={platform} rating="7" hidden={{}} />)
      let select = (name: string) => ($(`select[name="${name}"]`) as HTMLSelectElement).value
      return [select('platform'), select('rating')]
    }
    assert.deepEqual(picked('windows'), ['Windows', '7'])
    assert.deepEqual(picked('Amiga'), ['Amiga', '7'])
  })
})

describe('TitleLookup', () => {
  const FROM_ANILIST = {
    source: 'anilist',
    title: 'Frieren',
    released: '2023-09-29',
    platforms: 'Crunchyroll',
    description: 'An elf mage outlives her party.',
    cover_url: 'https://s4.anilist.co/frieren.png',
    progress_total: 28,
    progress_unit: 'episodes',
    tags: 'Fantasy',
  }
  // The add form around the title field; the platforms are filled in already.
  let form = async (t: TestContext, reply: () => Response) => {
    let asked: string[] = []
    t.mock.method(window, 'fetch', async (input: RequestInfo | URL) => {
      asked.push(String(input))
      return reply()
    })
    let result = mount(
      t,
      <form>
        <TitleLookup id="title" value="" href="/lookup" />
        <select name="type">
          <option value="anime">anime</option>
        </select>
        <input name="released" />
        <input name="platforms" value="Switch" />
        <textarea name="description" />
        <input name="progress_total" />
        <input name="progress_unit" />
        <input name="tags" />
      </form>,
    )
    // The button shows once the page has JavaScript.
    await result.act(() => {})
    let button = () =>
      [...result.$$('button')].find((entry) => /Fetch details|Searching/.test(entry.textContent ?? '')) as HTMLButtonElement
    let search = async (title: string) => {
      await result.act(() => type(result.$('#title') as HTMLInputElement, title))
      await result.act(() => button().click())
      await until(() => button().textContent === 'Fetch details')
    }
    let value = (name: string) => ((result.$('form') as HTMLFormElement).elements.namedItem(name) as HTMLInputElement).value
    return { ...result, asked, button, search, value }
  }

  it('lists the matches, and fills only the empty fields with the one picked, cover included', async (t) => {
    let { $, $$, act, container, asked, button, search, value } = await form(t, () =>
      Response.json([FROM_ANILIST, { ...FROM_ANILIST, source: 'wikipedia', title: 'Frieren (manga)', released: '2020' }]),
    )
    assert.ok(button().disabled, 'nothing to look up yet')
    await search('Frieren')
    assert.deepEqual(asked, ['/lookup?q=Frieren&type=anime'])
    let matches = () => [...$$('[aria-label="Matches"] button')]
    assert.deepEqual(matches().map((match) => match.textContent), ['FrierenAniList · 2023', 'Frieren (manga)Wikipedia · 2020'])

    await act(() => matches()[0].click())
    assert.deepEqual(
      ['released', 'platforms', 'description', 'progress_total', 'progress_unit', 'tags'].map(value),
      ['2023-09-29', 'Switch', 'An elf mage outlives her party.', '28', 'episodes', 'Fantasy'],
    )
    assert.equal(value('cover_url'), 'https://s4.anilist.co/frieren.png')
    assert.match(container.textContent ?? '', /Cover from AniList/)
    assert.equal($('[aria-label="Matches"]'), null)
  })

  it('says when nothing was found', async (t) => {
    let { container, search } = await form(t, () => Response.json([]))
    await search('Nonexistent')
    assert.match(container.textContent ?? '', /Nothing found\./)
  })

  it('says when the lookup failed', async (t) => {
    let { container, button, search } = await form(t, () => Response.json({ error: 'Lookup failed' }, { status: 502 }))
    await search('Frieren')
    assert.match(container.textContent ?? '', /Lookup failed\. Try again in a moment\./)
    assert.equal(button().disabled, false)
  })
})

describe('ImageInput', () => {
  let input = (t: TestContext) => {
    let { $ } = mount(
      t,
      <ImageInput name="cover" accept="image/jpeg,image/png,image/webp,image/gif" maxSide={1000} maxBytes={5 * 1024 * 1024} />,
    )
    let field = $('input') as HTMLInputElement
    let note = $('small') as HTMLElement
    let pick = async (file: File) => {
      let transfer = new DataTransfer()
      transfer.items.add(file)
      field.files = transfer.files
      field.dispatchEvent(new Event('change', { bubbles: true }))
      await until(() => note.textContent)
    }
    return { field, note, pick }
  }

  it('shrinks a big picture to a JPEG of at most 1000 pixels, and says by how much', async (t) => {
    let { field, note, pick } = input(t)
    let canvas = document.createElement('canvas')
    canvas.width = 3000
    canvas.height = 4500
    let context = canvas.getContext('2d')!
    context.fillStyle = '#ff4f9f'
    context.fillRect(0, 0, canvas.width, canvas.height)
    let poster = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95))
    await pick(new File([poster!], 'poster.jpg', { type: 'image/jpeg' }))

    let upload = field.files![0]
    assert.equal(upload.type, 'image/jpeg')
    assert.ok(upload.size < poster!.size)
    let image = await createImageBitmap(upload)
    assert.deepEqual([image.width, image.height], [667, 1000])
    assert.match(note.textContent ?? '', /^poster\.jpg · [\d.]+ [KM]B → [\d.]+ KB$/)
    assert.equal(note.className, 'file-note')
  })

  it('warns about a file that is not a picture', async (t) => {
    let { note, pick } = input(t)
    await pick(new File(['hello'], 'notes.txt', { type: 'text/plain' }))
    assert.equal(note.textContent, 'notes.txt · not a JPG, PNG, WebP or GIF image')
    assert.equal(note.className, 'file-note warn')
  })
})
