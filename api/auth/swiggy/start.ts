import type { VercelRequest, VercelResponse } from '@vercel/node'
import { HttpError } from '../../_lib/http.js'
import { isAuthed } from '../../_lib/session.js'
import { startAuth } from '../../_lib/swiggy.js'

/** Redirects to Swiggy's phone + OTP login. Only for a logged-in app session. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (!isAuthed(req)) return res.redirect(302, '/#swiggy=login')
  try {
    res.redirect(302, await startAuth(req))
  } catch (e) {
    const msg = e instanceof HttpError ? e.message : 'Couldn’t start the Swiggy login.'
    res.redirect(302, `/#swiggy=error&msg=${encodeURIComponent(msg)}`)
  }
}
