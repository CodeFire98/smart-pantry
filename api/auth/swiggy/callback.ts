import type { VercelRequest, VercelResponse } from '@vercel/node'
import { HttpError } from '../../_lib/http.js'
import { isAuthed } from '../../_lib/session.js'
import { finishAuth } from '../../_lib/swiggy.js'

/** Swiggy redirects here with ?code&state. Exchanges the code and stores the encrypted token, then returns to the app. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  const back = (hash: string) => res.redirect(302, `/#${hash}`)
  if (!isAuthed(req)) return back('swiggy=login')
  const { code, state, error } = req.query as Record<string, string | undefined>
  if (error) return back(`swiggy=error&msg=${encodeURIComponent('Swiggy login was cancelled.')}`)
  if (!code || !state) return back(`swiggy=error&msg=${encodeURIComponent('Swiggy didn’t send a login code.')}`)
  try {
    await finishAuth(code, state)
    back('swiggy=connected')
  } catch (e) {
    back(`swiggy=error&msg=${encodeURIComponent(e instanceof HttpError ? e.message : 'Couldn’t finish the Swiggy login.')}`)
  }
}
