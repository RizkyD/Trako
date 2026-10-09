// Failed sign-ins, counted per client address and per username, in memory (a
// restart forgets them). After 10 within 15 minutes, signing in is refused until
// those 15 minutes are over; signing in clears the count.
const LIMIT = 10
const WINDOW = 15 * 60_000

// Where each request came from. server.ts notes it, as the router only gets the
// Request; requests without one (tests) are counted per username only.
export const clientAddress = new WeakMap<Request, string>()

const failures = new Map<string, { count: number; until: number }>()

function keysOf(request: Request, username: string): string[] {
  let address = clientAddress.get(request)
  return address ? [`user:${username}`, `address:${address}`] : [`user:${username}`]
}

// Whole minutes until signing in is allowed again, or 0 when it is.
export function signInWait(request: Request, username: string): number {
  let now = Date.now()
  let waits = keysOf(request, username).map((key) => {
    let entry = failures.get(key)
    return entry && entry.count >= LIMIT ? entry.until - now : 0
  })
  return Math.max(0, Math.ceil(Math.max(...waits) / 60_000))
}

export function signInFailed(request: Request, username: string): void {
  let now = Date.now()
  // ponytail: full sweep per failure keeps only the last 15 minutes' keys; fine at sign-in traffic.
  for (let [key, entry] of failures) if (entry.until <= now) failures.delete(key)
  for (let key of keysOf(request, username)) {
    let entry = failures.get(key) ?? { count: 0, until: now + WINDOW }
    entry.count++
    failures.set(key, entry)
  }
}

export function signInSucceeded(request: Request, username: string): void {
  for (let key of keysOf(request, username)) failures.delete(key)
}
