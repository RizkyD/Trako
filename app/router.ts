import { createCookie } from 'remix/cookie'
import { cop } from 'remix/middleware/cop'
import { formData } from 'remix/middleware/form-data'
import { render } from 'remix/middleware/render'
import { session } from 'remix/middleware/session'
import { staticFiles } from 'remix/middleware/static'
import { redirect } from 'remix/response/redirect'
import { createRouter, type Middleware, type MiddlewareContext } from 'remix/router'
import { createCookieSessionStorage } from 'remix/session-storage/cookie'

import controller from './actions/controller.tsx'
import { assets } from './assets.ts'
import { sessionSecret, sessionVersion } from './db.ts'
import { routes } from './routes.ts'

const renderMiddleware = render({ assets })
const sessionMiddleware = session(
  createCookie('__session', {
    secrets: [sessionSecret],
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  }),
  createCookieSessionStorage(),
)
// One file per form: a cover (its own, smaller limit is checked when it is
// stored) or an export file, which embeds covers and can be large.
const UPLOAD_MAX_BYTES = 200 * 1024 * 1024
const formDataMiddleware = formData({ maxFiles: 1, maxFileSize: UPLOAD_MAX_BYTES })

type AppContext = MiddlewareContext<
  [typeof renderMiddleware, typeof sessionMiddleware, typeof formDataMiddleware]
>

declare module 'remix' {
  interface RouterTypes {
    context: AppContext
  }
}

// The form parser throws when an upload breaks its limits; answer that plainly
// instead of letting it surface as a server error.
const uploadLimit: Middleware = async (_context, next) => {
  try {
    return await next()
  } catch (error) {
    if (error instanceof Error && /^Max\w+ExceededError$/.test(error.name)) {
      return new Response('File too large.', { status: 413 })
    }
    throw error
  }
}

// Everything except the login page and browser assets needs a logged-in session,
// signed in since the account last signed out everywhere or changed its password.
const requireLogin: Middleware = (context, next) => {
  let { pathname } = context.url
  if (pathname === routes.login.href() || pathname.startsWith('/assets/')) return next()
  let { session } = context as unknown as AppContext
  let userId = session.get('userId')
  if (userId === undefined) return redirect(routes.login.href())
  let version = session.get('version')
  if (version !== undefined && version === sessionVersion(Number(userId))) return next()
  // An outdated session is signed out.
  session.destroy()
  return redirect(routes.login.href())
}

// Files in public/: fonts and icons never change under the same name, so browsers
// keep them for a year. Everything else is checked with the server each time it
// is used (a 304 when unchanged), so an edited app.css or theme.js shows at once.
const keptForGood = (path: string) => path.startsWith('fonts/') || path.startsWith('icon-')

export const router = createRouter<AppContext>({
  middleware: [
    staticFiles('./public', {
      index: false,
      filter: keptForGood,
      cacheControl: 'public, max-age=31536000, immutable',
    }),
    staticFiles('./public', { index: false, cacheControl: 'no-cache' }),
    cop(),
    renderMiddleware,
    sessionMiddleware,
    uploadLimit,
    formDataMiddleware,
    requireLogin,
  ],
})

router.map(routes, controller)
