// Shared by the router tests (`*.test.ts`); not a test file itself, so the
// runner does not collect it. Each test file runs in a process of its own, with
// its own in-memory database (NODE_ENV=test), so only the tests within a file
// share state: `reset()` before each one.
import { rmSync } from 'node:fs'

import * as assert from 'remix/assert'

import { dataDir, db } from './db.ts'
import { failures } from './rate-limit.ts'
import { router } from './router.ts'
import { routes } from './routes.ts'

// reset() empties the database: only ever the in-memory one NODE_ENV=test gives.
if (process.env.NODE_ENV !== 'test') {
  throw new Error('The tests empty the database: run them with NODE_ENV=test (npm test).')
}
// The throwaway folder db.ts made for this process's covers goes when it ends.
process.on('exit', () => rmSync(dataDir, { recursive: true, force: true }))

const origin = 'http://localhost'

// Fields as pairs can repeat a name (the bulk form's ticked `id`s).
export function post(
  path: string,
  fields: Record<string, string | File> | string[][],
  cookie = '',
) {
  let pairs = Array.isArray(fields) ? (fields as [string, string][]) : Object.entries(fields)
  let body = pairs.some(([, value]) => value instanceof File) ? new FormData() : new URLSearchParams()
  for (let [name, value] of pairs) body.append(name, value as string)
  return router.fetch(
    new Request(origin + path, {
      method: 'POST',
      body,
      headers: { Cookie: cookie },
      redirect: 'manual',
    }),
  )
}

export function get(path: string, cookie = '') {
  return router.fetch(new Request(origin + path, { headers: { Cookie: cookie } }))
}

export function cookieOf(response: Response): string {
  return (response.headers.get('Set-Cookie') ?? '').split(';')[0]
}

// Signs in and returns the session cookie. With no account yet (after reset),
// the first sign-in creates it.
export async function signIn(username = 'me', password = 'rahasia-123') {
  let response = await post(routes.loginSubmit.href(), { username, password })
  assert.equal(response.headers.get('Location'), routes.home.href(), `signed in as ${username}`)
  return cookieOf(response)
}

// No account, titles, franchises or settings, and no failed sign-ins. The
// session secret stays: the session cookie was made with it.
export function reset() {
  db.exec(`DELETE FROM items; DELETE FROM franchises; DELETE FROM users;
           DELETE FROM meta WHERE key != 'session_secret'`)
  failures.clear()
}

// The titles as the export file has them.
export async function exported(cookie: string): Promise<Record<string, any>[]> {
  return JSON.parse(await (await get(routes.export.href(), cookie)).text()).items
}
