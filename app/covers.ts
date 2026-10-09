import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { dataDir } from './db.ts'

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
// ponytail: files are stored as given; resize on upload if the grid gets slow.
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
