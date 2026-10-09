import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { dataDir } from './db.ts'
import { USER_AGENT } from './lookup.ts'

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}
export const COVER_ACCEPT = Object.values(MIME).join(',')
export const COVER_MAX_BYTES = 5 * 1024 * 1024

const dir = join(dataDir, 'covers')
mkdirSync(dir, { recursive: true })

// Stores cover bytes under a generated name. Returns null when the extension is
// not an accepted image type or the image is over the size limit.
// ponytail: files are stored as given. The upload forms shrink pictures in the
// browser first (actions/public/image-input.tsx); downloaded and imported covers
// are not shrunk: resize here if the grid gets slow.
export async function writeCover(bytes: Uint8Array, extension: string): Promise<string | null> {
  if (!(extension in MIME) || bytes.byteLength > COVER_MAX_BYTES) return null
  let name = `${randomUUID()}.${extension}`
  await writeFile(join(dir, name), bytes)
  return name
}

// Stores a cover uploaded through a form. Returns null when the form carried no
// file and false when the file is not an acceptable image.
export async function saveCover(value: FormDataEntryValue | null): Promise<string | null | false> {
  if (!(value instanceof File) || value.size === 0) return null
  let extension = Object.keys(MIME).find((key) => MIME[key] === value.type) ?? ''
  return (await writeCover(new Uint8Array(await value.arrayBuffer()), extension)) ?? false
}

// The only hosts covers are downloaded from: Wikipedia's and AniList's image
// servers (where "Fetch details" finds them) and Steam's.
const COVER_HOSTS = [
  'upload.wikimedia.org',
  'thumb.wikimedia.org',
  's4.anilist.co',
  'img.anili.st',
  'cdn.cloudflare.steamstatic.com',
]

// Downloads an image from one of COVER_HOSTS over https, checking every redirect
// before following it, reading no more than COVER_MAX_BYTES, within 10 seconds.
// Returns null on any failure.
export async function downloadImage(
  address: string,
): Promise<{ bytes: Uint8Array; extension: string } | null> {
  try {
    let signal = AbortSignal.timeout(10_000)
    let url = new URL(address)
    for (let hops = 0; hops < 5; hops++) {
      if (url.protocol !== 'https:' || !COVER_HOSTS.includes(url.host)) return null
      let response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'manual', signal })
      let location = response.headers.get('Location')
      if (response.status >= 300 && response.status < 400 && location) {
        url = new URL(location, url)
        continue
      }
      let type = response.headers.get('Content-Type')?.split(';')[0].trim()
      let extension = Object.keys(MIME).find((key) => MIME[key] === type)
      if (!response.ok || !response.body || !extension) return null
      if (Number(response.headers.get('Content-Length')) > COVER_MAX_BYTES) return null
      // The length can be missing or wrong: count while reading, too.
      let reader = response.body.getReader()
      let chunks: Uint8Array[] = []
      for (let size = 0; ; ) {
        let chunk = await reader.read()
        if (chunk.done) return { bytes: Buffer.concat(chunks), extension }
        size += chunk.value.byteLength
        if (size > COVER_MAX_BYTES) {
          await reader.cancel()
          return null
        }
        chunks.push(chunk.value)
      }
    }
  } catch {
    // Not a URL, unreachable, timed out: no cover.
  }
  return null
}

// Downloads a cover and stores it. Returns null when that fails.
export async function fetchCover(address: string): Promise<string | null> {
  let image = await downloadImage(address)
  return image && writeCover(image.bytes, image.extension)
}

export async function deleteCover(name: string | null): Promise<void> {
  if (name) await rm(join(dir, name), { force: true })
}

// Reads a stored cover, or null when the name is malformed or the file is gone.
export async function readCover(name: string): Promise<{ bytes: Buffer; extension: string } | null> {
  // Only names shaped like the ones writeCover generates are ever read from disk.
  let extension = /^[\w-]+\.(\w+)$/.exec(name)?.[1] ?? ''
  if (!(extension in MIME)) return null
  try {
    return { bytes: await readFile(join(dir, name)), extension }
  } catch {
    return null
  }
}

export async function coverResponse(name: string): Promise<Response> {
  let cover = await readCover(name)
  if (!cover) return new Response('Not Found', { status: 404 })
  return new Response(new Uint8Array(cover.bytes), {
    headers: {
      'Content-Type': MIME[cover.extension],
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
