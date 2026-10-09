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
import { sessionSecret } from './db.ts'
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

// Everything except the login page and browser assets needs a logged-in session.
const requireLogin: Middleware = (context, next) => {
  let { pathname } = context.url
  let isPublic = pathname === routes.login.href() || pathname.startsWith('/assets/')
  if (isPublic || (context as unknown as AppContext).session.get('userId') !== undefined) {
    return next()
  }
  return redirect(routes.login.href())
}

export const router = createRouter<AppContext>({
  middleware: [
    staticFiles('./public', { index: false }),
    cop(),
    renderMiddleware,
    sessionMiddleware,
    uploadLimit,
    formDataMiddleware,
    requireLogin,
  ],
})

router.map(routes, controller)
