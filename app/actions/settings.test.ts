import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as assert from 'remix/assert'
import { beforeEach, describe, it } from 'remix/test'

import { today } from '../db.ts'
import { routes } from '../routes.ts'
import { cookieOf, get, post, reset, signIn } from '../test-helpers.ts'

describe('settings', () => {
  let cookie = ''
  beforeEach(async () => {
    reset()
    cookie = await signIn()
  })
  let settings = async () => (await get(routes.settings.href(), cookie)).text()
  // Posts a settings form and returns the settings page it goes back to, with
  // the message the post left in the session.
  let send = async (path: string, fields: Record<string, string | File>) => {
    let response = await post(path, fields, cookie)
    cookie = cookieOf(response) || cookie
    return settings()
  }

  it('changes the password, given the current one and a matching confirmation', async () => {
    let change = (fields: Record<string, string>) => send(routes.passwordChange.href(), fields)
    let fresh = { new_password: 'baru-sekali-9', confirm_password: 'baru-sekali-9' }
    assert.match(await change({ current_password: 'salah-salah', ...fresh }), /current password is wrong/)
    assert.match(await change({ current_password: 'rahasia-123', ...fresh, confirm_password: 'beda-sekali-9' }), /do not match/)
    assert.match(
      await change({ current_password: 'rahasia-123', new_password: 'pendek', confirm_password: 'pendek' }),
      /at least 8 characters/,
    )
    assert.match(await change({ current_password: 'rahasia-123', ...fresh }), /Password changed/)

    // Still signed in; the old password no longer works and the new one does.
    assert.equal((await get(routes.home.href(), cookie)).status, 200)
    let oldLogin = await post(routes.loginSubmit.href(), { username: 'me', password: 'rahasia-123' })
    assert.equal(oldLogin.headers.get('Location'), routes.login.href())
    let newLogin = await post(routes.loginSubmit.href(), { username: 'me', password: 'baru-sekali-9' })
    assert.equal(newLogin.headers.get('Location'), routes.home.href())
    assert.equal((await post(routes.passwordChange.href(), fresh)).headers.get('Location'), routes.login.href())
  })

  it('shows a profile photo on every page, and deletes its file once removed', async () => {
    let photo = (fields: Record<string, string | File>) => send(routes.avatarChange.href(), fields)
    assert.doesNotMatch(await settings(), /<img[^>]*class="avatar"/)
    assert.match(await settings(), /<input name="avatar" type="file"[^>]*required/)
    let notImage = new File(['x'], 'a.txt', { type: 'text/plain' })
    assert.match(await photo({ avatar: notImage }), /Choose a JPG, PNG, WebP or GIF/)
    let png = new File([new Uint8Array([137, 80, 78, 71])], 'me.png', { type: 'image/png' })
    assert.match(await photo({ avatar: png }), /Profile photo updated/)
    // In the sidebar.
    let withPhoto = await (await get(routes.home.href(), cookie)).text()
    let photoPath = /<img[^>]*src="(\/covers\/[^"]+)"[^>]*class="avatar"/.exec(withPhoto)?.[1]
    assert.ok(photoPath)
    assert.equal((await get(photoPath, cookie)).headers.get('Content-Type'), 'image/png')
    assert.match(await photo({ remove: 'on' }), /Profile photo removed/)
    assert.equal((await get(photoPath, cookie)).status, 404)
    assert.doesNotMatch(await settings(), /<img[^>]*class="avatar"/)
  })

  it('changes the username, given the password; then only the new name signs in', async () => {
    let rename = (fields: Record<string, string>) => send(routes.usernameChange.href(), fields)
    assert.match(await settings(), /name="username"[^>]*value="me"/)
    assert.match(await rename({ username: 'aku', current_password: 'salah-salah' }), /password is wrong/)
    assert.match(await rename({ username: '  ', current_password: 'rahasia-123' }), /cannot be empty/)
    let renamed = await rename({ username: 'aku', current_password: 'rahasia-123' })
    assert.match(renamed, /Username changed to aku/)
    assert.match(renamed, /name="username"[^>]*value="aku"/)
    let oldName = await post(routes.loginSubmit.href(), { username: 'me', password: 'rahasia-123' })
    assert.equal(oldName.headers.get('Location'), routes.login.href())
    let newName = await post(routes.loginSubmit.href(), { username: 'aku', password: 'rahasia-123' })
    assert.equal(newName.headers.get('Location'), routes.home.href())
  })

  it('saves the backup folder and backs up on request', async (t) => {
    let folder = mkdtempSync(join(tmpdir(), 'trako-backups-'))
    t.after(() => rmSync(folder, { recursive: true, force: true }))
    let save = (fields: Record<string, string>) => send(routes.backups.href(), fields)

    // Bad folders and counts are refused, and nothing is saved.
    assert.match(await save({ folder: 'backups', keep: '14' }), /must be a full path/)
    assert.match(await save({ folder: join(folder, 'missing'), keep: '14' }), /does not exist/)
    assert.match(await save({ folder, keep: '0' }), /Keep at least 1 backup/)
    let refused = await save({ folder: '', keep: '14', now: 'on' })
    assert.match(refused, /Type the backup folder first/)
    assert.match(refused, /name="folder"[^>]*value=""/)

    let saved = await save({ folder, keep: '3' })
    assert.match(saved, /Backup settings saved/)
    assert.ok(saved.includes(`value="${folder}"`))
    assert.match(saved, /name="keep"[^>]*value="3"/)
    assert.match(saved, /No backups in this folder yet/)

    // Back up now writes today's file and says where.
    let backedUp = await save({ folder, keep: '3', now: 'on' })
    let file = join(folder, `trako-${today()}.json`)
    assert.ok(backedUp.includes(`Backed up to ${file}`))
    assert.match(backedUp, /Last backup: [^<]+ \(1 file\)/)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).app, 'trako')

    // An empty folder turns automatic backups off.
    assert.match(await save({ folder: '', keep: '3' }), /Automatic backups are off/)
  })
})
