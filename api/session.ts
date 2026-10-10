import { body, route, str } from './_lib/http.js'
import { KEYS, redis } from './_lib/redis.js'
import { isAuthed, login, logout } from './_lib/session.js'
import { tokenInfo } from './_lib/swiggy.js'

/**
 * GET    → {authed, swiggy: {connected, expiresAt, address}, ordering}
 * POST   {passcode} → sets the session cookie
 * DELETE → clears it
 */
export default route(['GET', 'POST', 'DELETE'], async (req, res) => {
  if (req.method === 'POST') {
    await login(req, res, str(body(req).passcode, 'passcode'))
    return { authed: true }
  }
  if (req.method === 'DELETE') { logout(req, res); return { authed: false } }
  if (!isAuthed(req)) return { authed: false }
  const t = await tokenInfo()
  const address = t ? await redis().get<{ id: string; label: string }>(KEYS.address) : null
  return {
    authed: true,
    swiggy: { connected: !!t, expiresAt: t?.expiresAt ?? null, address },
    ordering: process.env.ALLOW_CHECKOUT === 'true'
  }
})
