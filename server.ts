import * as http from 'node:http'
import { createRequestListener, type FetchHandler } from 'remix/node-fetch-server'

import { backupIfDue } from './app/backup.ts'
import { clientAddress } from './app/rate-limit.ts'
import { router } from './app/router.ts'

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 44100
// Every interface unless HOST names one (127.0.0.1 behind a proxy on this PC).
const host = process.env.HOST || undefined
const hmrProxyPort = process.env.HMR_PROXY_PORT
  ? Number.parseInt(process.env.HMR_PROXY_PORT, 10)
  : null
const isHmr = process.env.REMIX_NODE_HMR === '1'
// Behind a reverse proxy, its X-Forwarded-* headers give the browser's protocol,
// host and address: the session cookie is then Secure over HTTPS, and the
// sign-in limit counts the real client instead of the proxy.
const trustProxy = isHmr || process.env.TRUST_PROXY === '1'

// The router only gets the Request; the sign-in limit also needs the address.
const handler: FetchHandler = (request, client) => {
  clientAddress.set(request, client.address)
  return router.fetch(request)
}

const server = http.createServer(createRequestListener(handler, { trustProxy }))

server.listen({ port, host }, () => {
  if (isHmr) {
    import('remix/node-hmr/runtime').then((nodeHmr) => nodeHmr.emitServerReady())
  }

  console.log(`Server listening on http://${host ?? 'localhost'}:${hmrProxyPort ?? port}`)
})

// Daily backups to the folder set in Settings: shortly after start-up, then hourly.
if (process.env.NODE_ENV !== 'test') {
  setTimeout(backupIfDue, 10_000)
  setInterval(backupIfDue, 60 * 60_000)
}

let shuttingDown = false

function shutdown() {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  server.close(() => process.exit(0))
  server.closeAllConnections()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
