import * as assert from 'remix/assert'
import { beforeEach, describe, it } from 'remix/test'

import { resetPassword } from '../db.ts'
import { clientAddress } from '../rate-limit.ts'
import { router } from '../router.ts'
import { routes } from '../routes.ts'
import { cookieOf, get, post, reset, signIn } from '../test-helpers.ts'

describe('auth', () => {
  beforeEach(reset)

  it('sends visitors who are not signed in to the sign-in page', async () => {
    let anonymous = await get(routes.home.href())
    assert.equal(anonymous.status, 302)
    assert.equal(anonymous.headers.get('Location'), routes.login.href())
    let rejected = await post(routes.itemCreate.href(), { title: 'x', type: 'game', status: 'ongoing' })
    assert.equal(rejected.headers.get('Location'), routes.login.href())
  })

  it('creates the account on the first sign-in, then checks the password', async () => {
    let setup = await post(routes.loginSubmit.href(), { username: 'me', password: 'rahasia-123' })
    assert.equal(setup.headers.get('Location'), routes.home.href())
    let wrong = await post(routes.loginSubmit.href(), { username: 'me', password: 'salah-salah' })
    assert.equal(wrong.headers.get('Location'), routes.login.href())
    let login = await post(routes.loginSubmit.href(), { username: 'me', password: 'rahasia-123' })
    assert.equal(login.headers.get('Location'), routes.home.href())
    assert.equal((await get(routes.home.href(), cookieOf(login))).status, 200)
  })

  it('signs other sessions out on a password change, and every session on request', async () => {
    let home = (cookie: string) => get(routes.home.href(), cookie)
    let phone = await signIn()
    let laptop = await signIn()
    assert.equal((await home(phone)).status, 200)
    assert.equal((await home(laptop)).status, 200)

    // The browser the password is changed in stays signed in; the others are signed out.
    let changed = await post(
      routes.passwordChange.href(),
      { current_password: 'rahasia-123', new_password: 'ganti-lagi-77', confirm_password: 'ganti-lagi-77' },
      laptop,
    )
    laptop = cookieOf(changed) || laptop
    assert.match(await (await get(routes.settings.href(), laptop)).text(), /Password changed\. Other browsers/)
    assert.equal((await home(laptop)).status, 200)
    assert.equal((await home(phone)).headers.get('Location'), routes.login.href())
    phone = await signIn('me', 'ganti-lagi-77')
    assert.equal((await home(phone)).status, 200)

    // Signing out everywhere ends every session, its own too, and says so on the sign-in page.
    let settings = await (await get(routes.settings.href(), laptop)).text()
    assert.match(settings, /action="\/settings\/sign-out-everywhere"/)
    let out = await post(routes.signOutEverywhere.href(), {}, laptop)
    assert.equal(out.headers.get('Location'), routes.login.href())
    assert.match(await (await get(routes.login.href(), cookieOf(out))).text(), /role="status">Signed out everywhere/)
    for (let cookie of [laptop, phone, cookieOf(out)]) {
      assert.equal((await home(cookie)).headers.get('Location'), routes.login.href())
    }
    assert.equal((await home(await signIn('me', 'ganti-lagi-77'))).status, 200)
  })

  it('resets a forgotten password, signing every session out', async () => {
    let cookie = await signIn()
    assert.equal((await get(routes.home.href(), cookie)).status, 200)

    assert.equal(resetPassword('nobody', 'lupa-semua-1'), false)
    assert.equal(resetPassword('me', 'lupa-semua-1'), true)
    assert.equal((await get(routes.home.href(), cookie)).headers.get('Location'), routes.login.href())
    let old = await post(routes.loginSubmit.href(), { username: 'me', password: 'rahasia-123' })
    assert.equal(old.headers.get('Location'), routes.login.href())
    let fresh = await post(routes.loginSubmit.href(), { username: 'me', password: 'lupa-semua-1' })
    assert.equal(fresh.headers.get('Location'), routes.home.href())
    assert.equal((await get(routes.home.href(), cookieOf(fresh))).status, 200)
  })

  it('limits failed sign-ins per username and per client address', async (t) => {
    let attempt = (username: string, password: string, address?: string) => {
      let request = new Request('http://localhost' + routes.loginSubmit.href(), {
        method: 'POST',
        body: new URLSearchParams({ username, password }),
        redirect: 'manual',
      })
      if (address) clientAddress.set(request, address)
      return router.fetch(request)
    }
    let signedIn = (response: Response) => response.headers.get('Location') === routes.home.href()
    let fail = async (count: number, username: string, address?: string) => {
      for (let i = 0; i < count; i++) {
        let response = await attempt(username, 'salah-salah', address)
        assert.equal(response.headers.get('Location'), routes.login.href())
      }
    }
    // The first sign-in creates the account.
    assert.ok(signedIn(await attempt('me', 'rahasia-123')))

    // Nine wrong passwords, then the right one: signed in, and the count starts over,
    // so ten more wrong ones are still answered as usual.
    await fail(9, 'me')
    assert.ok(signedIn(await attempt('me', 'rahasia-123')))
    await fail(10, 'me')
    // Then even the right password is refused, on the sign-in page.
    let blocked = await attempt('me', 'rahasia-123')
    assert.equal(blocked.status, 429)
    let page = await blocked.text()
    assert.match(page, /role="alert">Too many attempts\. Try again in 15 minutes\./)
    assert.match(page, /action="\/login"/)
    // Another username is not affected.
    await fail(1, 'someone')

    // Ten failures from one address block that address, for any username.
    for (let i = 0; i < 10; i++) await fail(1, `guess${i}`, '203.0.113.9')
    assert.equal((await attempt('other', 'x', '203.0.113.9')).status, 429)
    await fail(1, 'other', '198.51.100.7')

    // Fifteen minutes later, signing in works again.
    let now = Date.now()
    t.mock.method(Date, 'now', () => now + 15 * 60_000)
    assert.ok(signedIn(await attempt('me', 'rahasia-123', '203.0.113.9')))
  })
})
