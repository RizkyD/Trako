import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { routes } from '../routes.ts'
import { get } from '../test-helpers.ts'

// Nothing here signs in or changes data, so there is nothing to reset.
describe('assets', () => {
  let served = async (path: string, type: string) => {
    let response = await get(path)
    assert.equal(response.status, 200, path)
    assert.equal(response.headers.get('Content-Type')?.split(';')[0], type, path)
    return response
  }

  it('serves its own fonts, no Google Fonts, kept for a year', async () => {
    // The fonts pages preload and app.css names are all served here.
    let page = await (await get(routes.login.href())).text()
    assert.doesNotMatch(page, /googleapis|gstatic/)
    let preloads = [...page.matchAll(/<link rel="preload" href="([^"]+)" as="font"/g)]
    assert.equal(preloads.length, 2)
    for (let [, href] of preloads) await served(href, 'font/woff2')
    let css = /<link rel="stylesheet" href="(\/app\.css\?v=\w+)"/.exec(page)?.[1] ?? ''
    let fonts = [...(await (await served(css, 'text/css')).text()).matchAll(/url\('([^']+)'\)/g)]
    assert.equal(fonts.length, 14)
    for (let [, href] of fonts) await served(href, 'font/woff2')
    // Fonts and icons are kept for a year; everything else is checked each time.
    assert.match((await get(fonts[0][1])).headers.get('Cache-Control') ?? '', /immutable/)
    assert.equal((await get(css)).headers.get('Cache-Control'), 'no-cache')
  })

  it('serves the web app manifest, its icons and the service worker the pages register', async () => {
    let page = await (await get(routes.login.href())).text()
    assert.match(page, /<link rel="manifest" href="\/manifest\.webmanifest"/)
    let manifest = await (await served('/manifest.webmanifest', 'application/manifest+json')).json()
    assert.deepEqual([manifest.name, manifest.start_url, manifest.display], ['Trako', '/', 'standalone'])
    for (let icon of manifest.icons) await served(icon.src, 'image/png')
    assert.equal(manifest.icons.length, 3)
    await served('/sw.js', 'text/javascript')
  })
})
