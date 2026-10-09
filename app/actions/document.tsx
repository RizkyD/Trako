import { statSync } from 'node:fs'

import type { Handle, RemixNode } from 'remix/component'
import { ImportMap } from 'remix/component/server'

import { scriptEntry } from '../assets.ts'

// The URL of a file in public/ that carries its modification time, so an edited
// app.css or theme.js is a new URL that neither the browser's cache nor the
// service worker's (public/sw.js) has seen.
function versioned(file: string) {
  let { mtimeMs } = statSync(new URL(`../../public/${file}`, import.meta.url))
  return `/${file}?v=${Math.round(mtimeMs).toString(36)}`
}

export interface DocumentProps {
  children?: RemixNode
  head?: RemixNode
  title?: string
}

export function Document(handle: Handle<DocumentProps>) {
  return () => {
    let { children, head, title = 'Trako' } = handle.props
    let { href, importMap, preloads } = scriptEntry

    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="color-scheme" content="light dark" />
          <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
          <link rel="apple-touch-icon" href="/icon-512-maskable.png" />
          <link rel="manifest" href="/manifest.webmanifest" />
          <meta name="theme-color" content="#ff4f9f" media="(prefers-color-scheme: light)" />
          <meta name="theme-color" content="#ff73b6" media="(prefers-color-scheme: dark)" />
          {/* The body text and the display font, both needed for the first paint. */}
          <link
            rel="preload"
            href="/fonts/m-plus-rounded-1c-500-latin.woff2"
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />
          <link
            rel="preload"
            href="/fonts/mochiy-pop-one-400-latin.woff2"
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />
          <link rel="stylesheet" href={versioned('app.css')} />
          <script src={versioned('theme.js')}></script>
          <title>{title}</title>
          {head}
          <ImportMap value={importMap} />
          {preloads.map((preloadHref) => (
            <link key={preloadHref} rel="modulepreload" href={preloadHref} />
          ))}
          <script type="module" src={href}></script>
        </head>
        <body>{children}</body>
      </html>
    )
  }
}
