import { clientEntry, on } from 'remix/component'
import type { Handle } from 'remix/component'

interface ImageInputProps {
  name: string
  accept: string
  // A bigger picture is scaled down until its longest side is this many pixels.
  maxSide: number
  // The largest file the server takes.
  maxBytes: number
  required?: boolean
}

// Pictures over this size are re-encoded even when their pixels already fit.
const SHRINK_OVER = 1024 * 1024

const size = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

// Scales a picture down to fit maxSide and re-encodes it, when it is bigger than
// that or than 1 MB, or of a type the server does not take: as PNG when it was
// one and stays under 1 MB, otherwise as JPEG. GIFs are kept as they are, since
// they may be animated. Returns null when the browser cannot read the picture.
async function shrink(file: File, maxSide: number, accepted: boolean) {
  let image = await createImageBitmap(file).catch(() => null)
  if (!image) return null
  let { width, height } = image
  let scale = Math.min(1, maxSide / Math.max(width, height))
  if (file.type === 'image/gif' || (accepted && scale === 1 && file.size <= SHRINK_OVER)) {
    image.close()
    return { file, width, height }
  }
  let canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  let context = canvas.getContext('2d')!
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  image.close()
  let encode = (type: string, quality?: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
  let blob = file.type === 'image/png' ? await encode('image/png') : null
  if (!blob || blob.size > SHRINK_OVER) {
    // JPEG has no transparency: see-through parts turn white rather than black.
    context.globalCompositeOperation = 'destination-over'
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    blob = await encode('image/jpeg', 0.85)
  }
  if (!blob) return { file, width, height }
  let name = `${file.name.replace(/\.[^.]*$/, '')}.${blob.type === 'image/png' ? 'png' : 'jpg'}`
  return {
    file: new File([blob], name, { type: blob.type }),
    width: canvas.width,
    height: canvas.height,
  }
}

// The file input for covers and the profile photo. In the browser a picked
// picture is shrunk before it is uploaded (see shrink), and the line under the
// input says what was picked, with a warning when the server will refuse it.
// Without JavaScript it is a plain file input; the server checks the file anyway.
export const ImageInput = clientEntry(
  import.meta.url,
  function ImageInput(handle: Handle<ImageInputProps>) {
    let note = ''
    let warn = false

    return () => {
      let { name, accept, maxSide, maxBytes, required } = handle.props
      return (
        <>
          <input
            name={name}
            type="file"
            accept={accept}
            required={required}
            mix={on('change', async (event, signal) => {
              let input = event.currentTarget
              let file = input.files?.[0]
              note = ''
              warn = false
              if (file) {
                let accepted = accept.split(',').includes(file.type)
                let result = await shrink(file, maxSide, accepted)
                if (signal.aborted) return
                let upload = result?.file ?? file
                let detail: string
                if (!result) {
                  detail = accepted ? size(file.size) : 'not a JPG, PNG, WebP or GIF image'
                } else if (upload === file) {
                  detail = `${result.width} × ${result.height} · ${size(file.size)}`
                } else {
                  detail = `${size(file.size)} → ${size(upload.size)}`
                  // The shrunk file replaces the picked one in the form.
                  let transfer = new DataTransfer()
                  transfer.items.add(upload)
                  input.files = transfer.files
                }
                let over = upload.size > maxBytes
                warn = over || (!result && !accepted)
                note = [file.name, detail, over && `over the ${maxBytes / 1024 / 1024} MB limit`]
                  .filter(Boolean)
                  .join(' · ')
              }
              handle.update()
            })}
          />
          <small class={warn ? 'file-note warn' : 'file-note'} aria-live="polite">
            {note}
          </small>
        </>
      )
    }
  },
)
