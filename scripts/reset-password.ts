// Sets a new password for an account, for when it is forgotten:
//   npm run reset-password -- <username>
// Every browser and device signed in to the account is signed out. Like the
// app, it works on DB_PATH when that is set, else data/tracker.db.
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'

import { db, resetPassword } from '../app/db.ts'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

let username = process.argv[2]
if (!username) fail('Usage: npm run reset-password -- <username>')

// On a terminal the password is not shown as it is typed: readline echoes it
// into this stream, which drops everything while `hidden` is set.
let hidden = false
let input = createInterface({
  input: process.stdin,
  output: new Writable({
    write(chunk, _encoding, done) {
      if (!hidden) process.stdout.write(chunk)
      done()
    },
  }),
  terminal: process.stdin.isTTY,
})
input.on('SIGINT', () => {
  process.stdout.write('\n')
  process.exit(130)
})
// Read through the iterator, so piped lines that arrive early are not lost.
let lines = input[Symbol.asyncIterator]()
async function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt)
  hidden = true
  let { value } = await lines.next()
  hidden = false
  if (process.stdin.isTTY) process.stdout.write('\n')
  return value ?? ''
}

let password = await ask(`New password for ${username}: `)
let again = await ask('Type it again: ')
input.close()

if (password.length < 8) fail('The password must be at least 8 characters. Nothing was changed.')
if (password !== again) fail('The two passwords differ. Nothing was changed.')
if (!resetPassword(username, password)) {
  fail(`There is no account named ${username} in ${db.location()}. Nothing was changed.`)
}
console.log(`Password changed for ${username}. It is signed out everywhere; sign in again.`)
